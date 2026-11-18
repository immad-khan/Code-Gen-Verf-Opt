"""
independent_checks.py — Independent Checks Engine
Runs 3 advisory checks (warnings only, never changes verdict or locked tests):
1. Prompt examples: extracts examples from user prompt, runs them as extra tests labeled "from prompt".
2. Fuzz check: Hypothesis testing derived from signature type hints. Flags unexpected exceptions,
   wrong return types, and timeouts. Shows count of inputs tried.
3. Optional second solution: compares solution 1 vs solution 2 outputs on test & fuzz inputs to find disagreements.
"""
from __future__ import annotations
import ast
import json
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

try:
    import hypothesis
    from hypothesis import given, settings, strategies as st
    HAS_HYPOTHESIS = True
except ImportError:
    HAS_HYPOTHESIS = False


# ─────────────────────────────────────────────────────────────────────────────
# 1. Prompt Examples Extraction & Evaluation
# ─────────────────────────────────────────────────────────────────────────────

def extract_prompt_examples(prompt: str, func_name: str) -> List[Dict[str, str]]:
    """
    Extracts (call_str, expected_str) examples from the prompt text.
    Handles doctests, 'Input: ... Output: ...', and 'func(...) == ...' patterns.
    """
    examples: List[Dict[str, str]] = []
    if not prompt or not func_name:
        return examples

    # 1. Doctest pattern: >>> func(args) \n expected
    doctest_pattern = re.compile(
        rf">>>\s*({re.escape(func_name)}\s*\([^)]*\))\s*\n\s*([^\n>]+)",
        re.MULTILINE
    )
    for m in doctest_pattern.finditer(prompt):
        call_expr = m.group(1).strip()
        expected = m.group(2).strip()
        examples.append({
            "example": f"{call_expr} -> {expected}",
            "input": call_expr,
            "expected": expected
        })

    # 2. Leetcode / Markdown pattern:
    # Example ...: Input: ... Output: ...
    ex_block_pattern = re.compile(
        r"(?:Example\s*\d*:?|Sample Input:?)\s*(?:Input|args):\s*([^\n]+)\s*\n\s*(?:Output|result|returns?):\s*([^\n]+)",
        re.IGNORECASE | re.MULTILINE
    )
    for m in ex_block_pattern.finditer(prompt):
        raw_in = m.group(1).strip()
        raw_out = m.group(2).strip()
        # Build call: func_name(raw_in) if not already function call
        call_expr = raw_in if raw_in.startswith(f"{func_name}(") else f"{func_name}({raw_in})"
        examples.append({
            "example": f"{call_expr} -> {raw_out}",
            "input": call_expr,
            "expected": raw_out
        })

    # 3. Direct equality / arrow pattern: func(args) == expected or func(args) -> expected
    eq_pattern = re.compile(
        rf"({re.escape(func_name)}\s*\([^)]*\))\s*(?:==|->)\s*([^\n,;\)]+)",
        re.MULTILINE
    )
    for m in eq_pattern.finditer(prompt):
        call_expr = m.group(1).strip()
        expected = m.group(2).strip()
        # Avoid signatures like func(a: int) -> int
        if ":" in call_expr or "def " in call_expr:
            continue
        try:
            parsed = ast.parse(call_expr)
            if not any(isinstance(n, ast.Call) for n in ast.walk(parsed)):
                continue
        except Exception:
            continue

        if not any(e["input"] == call_expr for e in examples):
            examples.append({
                "example": f"{call_expr} == {expected}",
                "input": call_expr,
                "expected": expected
            })

    return examples


def run_prompt_examples(func_obj: Any, examples: List[Dict[str, str]]) -> Dict[str, Any]:
    """Runs extracted prompt examples against the function object."""
    results: List[Dict[str, Any]] = []
    warnings: List[str] = []
    passed_count = 0
    failed_count = 0

    for ex in examples:
        call_str = ex["input"]
        expected_str = ex["expected"]
        item: Dict[str, Any] = {
            "example": ex["example"],
            "input": call_str,
            "expected": expected_str,
            "actual": "",
            "passed": False,
            "error": None
        }

        try:
            # Safely evaluate function call in environment where func_obj is available
            eval_env = {func_obj.__name__: func_obj}
            actual_val = eval(call_str, {"__builtins__": __builtins__}, eval_env)
            item["actual"] = repr(actual_val)

            # Parse expected value
            try:
                expected_val = eval(expected_str, {"__builtins__": __builtins__}, {})
                matches = (actual_val == expected_val)
            except Exception:
                matches = (str(actual_val).strip() == expected_str.strip() or
                           repr(actual_val).strip() == expected_str.strip())

            if matches:
                item["passed"] = True
                passed_count += 1
            else:
                item["passed"] = False
                failed_count += 1
                warnings.append(
                    f"[from prompt] Example mismatch: '{call_str}' produced {item['actual']}, expected {expected_str}"
                )
        except Exception as e:
            item["passed"] = False
            item["error"] = f"{type(e).__name__}: {e}"
            item["actual"] = f"<Raised {type(e).__name__}>"
            failed_count += 1
            warnings.append(
                f"[from prompt] Example execution failed for '{call_str}': {type(e).__name__}: {e}"
            )

        results.append(item)

    return {
        "executed": len(examples) > 0,
        "totalExamples": len(examples),
        "passedExamples": passed_count,
        "failedExamples": failed_count,
        "examples": results,
        "warnings": warnings
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. Fuzz Check via Hypothesis
# ─────────────────────────────────────────────────────────────────────────────

def get_strategy_for_type(type_hint: str) -> Optional[Any]:
    """Maps a Python type hint string to a Hypothesis strategy. Returns None if unsupported."""
    if not HAS_HYPOTHESIS:
        return None
    th = type_hint.strip()

    if th in ("int", "int | None", "Optional[int]"):
        return st.integers(min_value=-10000, max_value=10000)
    if th in ("float", "float | None", "Optional[float]"):
        return st.floats(min_value=-1e5, max_value=1e5, allow_nan=False, allow_infinity=False)
    if th in ("str", "str | None", "Optional[str]"):
        return st.text(max_size=50)
    if th in ("bool", "bool | None"):
        return st.booleans()
    if th in ("list[int]", "List[int]"):
        return st.lists(st.integers(min_value=-1000, max_value=1000), max_size=30)
    if th in ("list[float]", "List[float]"):
        return st.lists(st.floats(min_value=-1e4, max_value=1e4, allow_nan=False, allow_infinity=False), max_size=30)
    if th in ("list[str]", "List[str]"):
        return st.lists(st.text(max_size=20), max_size=20)
    if th in ("dict[str, int]", "Dict[str, int]"):
        return st.dictionaries(st.text(max_size=10), st.integers(min_value=-1000, max_value=1000), max_size=15)
    if th in ("tuple[int, ...]", "Tuple[int, ...]"):
        return st.tuples(st.integers(), st.integers())

    # Unsupported or complex type hint
    return None


def extract_signature_info(func_obj: Any, signature_str: Optional[str] = None) -> Tuple[Dict[str, str], Optional[str]]:
    """Extracts parameter type hints and return type hint from signature or function annotations."""
    param_types: Dict[str, str] = {}
    return_type: Optional[str] = None

    # Try inspect/annotations first
    import inspect
    try:
        sig = inspect.signature(func_obj)
        for name, param in sig.parameters.items():
            if param.annotation is not inspect.Parameter.empty:
                param_types[name] = getattr(param.annotation, "__name__", str(param.annotation))
            else:
                param_types[name] = "int" # default fallback
        if sig.return_annotation is not inspect.Signature.empty:
            return_type = getattr(sig.return_annotation, "__name__", str(sig.return_annotation))
    except Exception:
        pass

    # If signature string was provided, parse via ast
    if signature_str and not param_types:
        try:
            tree = ast.parse(f"{signature_str.strip().rstrip(':')}: pass")
            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    for arg in node.args.args:
                        arg_name = arg.arg
                        if arg.annotation:
                            param_types[arg_name] = ast.unparse(arg.annotation)
                        else:
                            param_types[arg_name] = "int"
                    if node.returns:
                        return_type = ast.unparse(node.returns)
                    break
        except Exception:
            pass

    return param_types, return_type


def extract_allowed_exceptions(prompt: str, docstring: str) -> List[str]:
    """Finds expected exception types explicitly mentioned in prompt or docstring."""
    allowed = ["AssertionError"] # Assertion checks inside solution
    combined = f"{prompt}\n{docstring}".lower()
    for exc in ["valueerror", "typeerror", "keyerror", "indexerror", "zerodivisionerror", "runtimeerror"]:
        if f"raise {exc}" in combined or f"raises {exc}" in combined or f"raise a {exc}" in combined:
            allowed.append(exc.capitalize())
            if exc == "valueerror": allowed.append("ValueError")
            if exc == "typeerror": allowed.append("TypeError")
            if exc == "zerodivisionerror": allowed.append("ZeroDivisionError")
    return allowed


def run_fuzz_check(func_obj: Any, prompt: str, docstring: str, signature_str: Optional[str] = None) -> Dict[str, Any]:
    """Runs Hypothesis fuzz check on func_obj according to signature type hints."""
    if not HAS_HYPOTHESIS:
        return {
            "executed": False,
            "inputsTried": 0,
            "hasUnexpectedException": False,
            "hasWrongReturnType": False,
            "hasTimeout": False,
            "failureDetails": "Hypothesis library is not available in environment.",
            "warnings": ["Hypothesis not installed in environment."]
        }

    param_types, return_type = extract_signature_info(func_obj, signature_str)
    allowed_exceptions = extract_allowed_exceptions(prompt, docstring)

    # Build strategies
    strategies_dict: Dict[str, Any] = {}
    skipped_types: List[str] = []

    for name, th in param_types.items():
        strat = get_strategy_for_type(th)
        if strat is not None:
            strategies_dict[name] = strat
        else:
            skipped_types.append(f"{name}: {th}")

    if not strategies_dict:
        # Fallback to basic integer strategies
        for name in param_types:
            strategies_dict[name] = st.integers(min_value=-1000, max_value=1000)

    inputs_tried = 0
    unexpected_exceptions: List[str] = []
    wrong_returns: List[str] = []
    timeouts: List[str] = []
    warnings: List[str] = []

    if skipped_types:
        warnings.append(f"Fuzzing skipped unsupported parameter types: {', '.join(skipped_types)}")

    # We run up to 50 generated inputs using hypothesis
    def fuzz_target(**kwargs):
        nonlocal inputs_tried
        inputs_tried += 1
        t0 = time.perf_counter()
        try:
            res = func_obj(**kwargs)
            duration = (time.perf_counter() - t0) * 1000
            if duration > 500: # 500 ms per input
                timeouts.append(f"Input {kwargs} took {duration:.1f}ms (>500ms timeout threshold)")

            # Check return type if annotated
            if return_type and return_type in ("int", "float", "str", "bool", "list", "dict"):
                expected_cls = {"int": int, "float": (int, float), "str": str, "bool": bool, "list": list, "dict": dict}[return_type]
                if not isinstance(res, expected_cls):
                    wrong_returns.append(f"On input {kwargs}: expected return type '{return_type}', got '{type(res).__name__}' ({repr(res)})")

        except Exception as e:
            exc_name = type(e).__name__
            if exc_name not in allowed_exceptions and not any(a.lower() == exc_name.lower() for a in allowed_exceptions):
                unexpected_exceptions.append(f"Unexpected {exc_name} on input {kwargs}: {e}")

    try:
        decorated = given(**strategies_dict)(
            settings(max_examples=50, deadline=1000, database=None)(fuzz_target)
        )
        decorated()
    except Exception as harness_err:
        pass

    has_unexpected_exc = len(unexpected_exceptions) > 0
    has_wrong_return = len(wrong_returns) > 0
    has_timeout = len(timeouts) > 0

    for err in unexpected_exceptions[:3]:
        warnings.append(f"[fuzz check] {err}")
    for err in wrong_returns[:3]:
        warnings.append(f"[fuzz check] {err}")
    for err in timeouts[:2]:
        warnings.append(f"[fuzz check] {err}")

    details = []
    if inputs_tried > 0:
        details.append(f"Tried {inputs_tried} inputs via Hypothesis")
    if not (has_unexpected_exc or has_wrong_return or has_timeout):
        details.append("0 anomalies detected")
    else:
        if has_unexpected_exc: details.append(f"{len(unexpected_exceptions)} unexpected exception(s)")
        if has_wrong_return: details.append(f"{len(wrong_returns)} wrong return type(s)")
        if has_timeout: details.append(f"{len(timeouts)} timeout(s)")

    return {
        "executed": True,
        "inputsTried": inputs_tried,
        "hasUnexpectedException": has_unexpected_exc,
        "hasWrongReturnType": has_wrong_return,
        "hasTimeout": has_timeout,
        "failureDetails": "; ".join(details),
        "warnings": warnings
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. Optional Second Solution (Differential Testing / Disagreements)
# ─────────────────────────────────────────────────────────────────────────────

def run_differential_testing(
    func1: Any,
    func2: Any,
    test_inputs: List[Tuple[Any, ...]],
    secondary_model_name: str
) -> Dict[str, Any]:
    """
    Runs both func1 and func2 across test_inputs and checks for disagreements.
    """
    disagreements: List[Dict[str, str]] = []
    warnings: List[str] = []
    inputs_tested = 0

    for args in test_inputs:
        inputs_tested += 1
        out1, err1 = None, None
        out2, err2 = None, None

        try:
            out1 = func1(*args) if isinstance(args, (tuple, list)) else func1(args)
        except Exception as e:
            err1 = f"<{type(e).__name__}>"

        try:
            out2 = func2(*args) if isinstance(args, (tuple, list)) else func2(args)
        except Exception as e:
            err2 = f"<{type(e).__name__}>"

        val1 = repr(out1) if err1 is None else err1
        val2 = repr(out2) if err2 is None else err2

        if val1 != val2:
            arg_repr = repr(args)
            disagreements.append({
                "input": arg_repr,
                "solution1Output": val1,
                "solution2Output": val2
            })
            warnings.append(
                f"[second solution] Disagreement on input {arg_repr}: "
                f"primary returned {val1}, {secondary_model_name} returned {val2}"
            )

    return {
        "enabled": True,
        "executed": True,
        "secondaryModel": secondary_model_name,
        "totalInputsTested": inputs_tested,
        "disagreementCount": len(disagreements),
        "disagreements": disagreements,
        "warnings": warnings
    }


# ─────────────────────────────────────────────────────────────────────────────
# CLI Entrypoint for Execution by Backend
# ─────────────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing input JSON configuration path"}))
        sys.exit(1)

    config_path = sys.argv[1]
    with open(config_path, "r", encoding="utf-8-sig") as f:
        config = json.load(f)

    prompt = config.get("prompt", "")
    solution_code = config.get("solutionCode", "")
    solution2_code = config.get("solution2Code")
    signature_str = config.get("signature")
    func_name = config.get("funcName", "solution")
    secondary_model = config.get("secondaryModel", "Secondary Model")

    # Write solution to local temp namespace and import
    loc_sol: Dict[str, Any] = {}
    try:
        exec(compile(solution_code, "solution.py", "exec"), loc_sol)
    except Exception as e:
        print(json.dumps({
            "promptExamples": {"executed": False, "warnings": [f"Could not load solution.py: {e}"]},
            "fuzzCheck": {"executed": False, "warnings": [f"Could not load solution.py: {e}"]},
            "secondSolution": {"enabled": False, "executed": False, "warnings": []},
            "allWarnings": [f"Solution syntax/load error: {e}"]
        }))
        return

    # Find the function object
    func_obj = loc_sol.get(func_name)
    if not callable(func_obj):
        # Find first callable
        for k, v in loc_sol.items():
            if callable(v) and not k.startswith("_"):
                func_obj = v
                func_name = k
                break

    if not callable(func_obj):
        print(json.dumps({
            "promptExamples": {"executed": False, "warnings": ["No callable function found in solution.py"]},
            "fuzzCheck": {"executed": False, "warnings": ["No callable function found in solution.py"]},
            "secondSolution": {"enabled": False, "executed": False, "warnings": []},
            "allWarnings": ["No callable function found in solution."]
        }))
        return

    docstring = inspect_doc = inspect_str = getattr(func_obj, "__doc__", "") or ""

    # 1. Check 1: Prompt Examples
    examples = extract_prompt_examples(prompt, func_name)
    prompt_res = run_prompt_examples(func_obj, examples)

    # 2. Check 2: Fuzz Check
    fuzz_res = run_fuzz_check(func_obj, prompt, docstring, signature_str)

    # 3. Check 3: Optional Second Solution
    second_res = {"enabled": False, "executed": False, "secondaryModel": None, "totalInputsTested": 0, "disagreementCount": 0, "disagreements": [], "warnings": []}
    if solution2_code and solution2_code.strip():
        loc_sol2: Dict[str, Any] = {}
        try:
            exec(compile(solution2_code, "solution2.py", "exec"), loc_sol2)
            func_obj2 = loc_sol2.get(func_name)
            if callable(func_obj2):
                # Collect inputs to test
                sample_inputs: List[Any] = []
                for ex in examples:
                    try:
                        # Extract args inside func_name(...)
                        call_expr = ex["input"]
                        tree = ast.parse(call_expr)
                        for node in ast.walk(tree):
                            if isinstance(node, ast.Call):
                                args_vals = [ast.literal_eval(a) for a in node.args]
                                sample_inputs.append(tuple(args_vals) if len(args_vals) > 1 else (args_vals[0] if args_vals else ()))
                                break
                    except Exception:
                        pass

                # Add some standard input probes
                if not sample_inputs:
                    sample_inputs = [(0,), (1,), (-1,), (10,), (100,)]

                second_res = run_differential_testing(func_obj, func_obj2, sample_inputs, secondary_model)
        except Exception as e:
            second_res = {
                "enabled": True,
                "executed": False,
                "secondaryModel": secondary_model,
                "warnings": [f"Could not load secondary solution: {e}"]
            }

    all_warnings = (
        prompt_res.get("warnings", []) +
        fuzz_res.get("warnings", []) +
        second_res.get("warnings", [])
    )

    output = {
        "promptExamples": prompt_res,
        "fuzzCheck": fuzz_res,
        "secondSolution": second_res,
        "allWarnings": all_warnings
    }

    print(json.dumps(output))

if __name__ == "__main__":
    main()
