#!/usr/bin/env python3
"""
Validates 100% of the canonical solutions across all 1163 benchmark problems:
- HumanEval+ (164)
- MBPP+ (399)
- APPS+ (600: 200 Introductory, 200 Interview, 200 Competition)
"""

import sys
import io
import json
import time
import importlib
import traceback

def validate_humaneval_plus(path="data/humaneval_plus.jsonl"):
    print("--> Validating HumanEval+ (164 problems)...")
    passed = 0
    failed = 0
    failures = []

    with open(path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            if not line.strip(): continue
            prob = json.loads(line)
            task_id = prob["task_id"]
            entry_point = prob["entry_point"]
            canonical = prob["prompt"] + prob["canonical_solution"]
            test_code = prob["test"]
            
            # Combine solution and test
            full_code = f"{canonical}\n\n{test_code}\n\ncheck({entry_point})\n"
            ns = {}
            try:
                exec(full_code, ns)
                passed += 1
            except Exception as e:
                failed += 1
                failures.append((task_id, str(e)))

    print(f"    HumanEval+ Results: {passed} PASSED, {failed} FAILED out of {passed + failed}")
    return passed, failed, failures

def validate_mbpp_plus(path="data/mbpp_plus.jsonl"):
    print("--> Validating MBPP+ (399 problems)...")
    passed = 0
    failed = 0
    failures = []

    with open(path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            if not line.strip(): continue
            cleaned = line.replace("-Infinity", "null").replace("Infinity", "null").replace("NaN", "null")
            prob = json.loads(cleaned)
            task_id = prob["task_id"]
            code = prob["canonical_solution"]
            assertion = prob.get("assertion", "")

            # Combine code and assertions
            test_body = f"import math\n{code}\n\n{assertion}\n"
            ns = {}
            try:
                exec(test_body, ns)
                passed += 1
            except Exception as e:
                failed += 1
                failures.append((task_id, str(e)))

    print(f"    MBPP+ Results: {passed} PASSED, {failed} FAILED out of {passed + failed}")
    return passed, failed, failures

def validate_apps_plus(path="data/apps_plus_selected.jsonl"):
    print("--> Validating APPS+ (600 problems: 200 Intro, 200 Interview, 200 Competition)...")
    counts = {"introductory": {"pass": 0, "fail": 0}, "interview": {"pass": 0, "fail": 0}, "competition": {"pass": 0, "fail": 0}}
    failures = []

    with open(path, "r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            if not line.strip(): continue
            prob = json.loads(line)
            prob_id = prob["problem_id"]
            diff = prob["difficulty"]
            canonical = prob["canonical_solution"]
            inputs = prob.get("inputs", [])
            outputs = prob.get("outputs", [])
            starter = prob.get("starter_code", "")

            is_fn_call = inputs and isinstance(inputs[0], list)

            ns = {}
            try:
                exec(canonical, ns)
            except Exception as e:
                counts[diff]["fail"] += 1
                failures.append((prob_id, diff, f"Syntax/Import error in canonical: {e}"))
                continue

            fn_name = None
            if "def " in starter:
                fn_name = starter.split("def ")[1].split("(")[0].strip()
            elif "def " in canonical:
                fn_name = canonical.split("def ")[1].split("(")[0].strip()

            if not fn_name or fn_name not in ns:
                funcs = [k for k, v in ns.items() if callable(v) and not k.startswith("__")]
                if funcs:
                    fn_name = funcs[-1]

            fn = ns.get(fn_name) if fn_name else None
            prob_ok = True
            err_msg = ""

            for i, (inp, out) in enumerate(zip(inputs, outputs)):
                try:
                    if is_fn_call:
                        parsed_args = [eval(arg) if isinstance(arg, str) else arg for arg in inp]
                        res = fn(*parsed_args)
                        target = out[0] if isinstance(out, list) and len(out) == 1 else out
                        if isinstance(target, str):
                            try:
                                target = eval(target)
                            except Exception:
                                pass
                        if res != target:
                            prob_ok = False
                            err_msg = f"Test {i} mismatch: got {res!r}, expected {target!r}"
                            break
                    else:
                        old_stdin = sys.stdin
                        old_stdout = sys.stdout
                        sys.stdin = io.StringIO(inp if isinstance(inp, str) else "\n".join(map(str, inp)) + "\n")
                        sys.stdout = io.StringIO()
                        try:
                            if fn is not None:
                                fn()
                            else:
                                exec(canonical, dict(__name__="__main__"))
                            actual_out = sys.stdout.getvalue()
                        finally:
                            sys.stdin = old_stdin
                            sys.stdout = old_stdout

                        expected_out = out if isinstance(out, str) else "\n".join(map(str, out))
                        if actual_out.strip() != expected_out.strip():
                            prob_ok = False
                            err_msg = f"Test {i} stdout mismatch: got {actual_out.strip()!r}, expected {expected_out.strip()!r}"
                            break
                except Exception as e:
                    prob_ok = False
                    err_msg = f"Test {i} raised exception: {e}"
                    break

            if prob_ok:
                counts[diff]["pass"] += 1
            else:
                counts[diff]["fail"] += 1
                failures.append((prob_id, diff, err_msg))

    print(f"    APPS+ Introductory: {counts['introductory']['pass']} PASSED, {counts['introductory']['fail']} FAILED")
    print(f"    APPS+ Interview:    {counts['interview']['pass']} PASSED, {counts['interview']['fail']} FAILED")
    print(f"    APPS+ Competition:  {counts['competition']['pass']} PASSED, {counts['competition']['fail']} FAILED")
    total_apps_pass = sum(c["pass"] for c in counts.values())
    total_apps_fail = sum(c["fail"] for c in counts.values())
    print(f"    APPS+ Total:        {total_apps_pass} PASSED, {total_apps_fail} FAILED out of {total_apps_pass + total_apps_fail}")

    return counts, failures

if __name__ == "__main__":
    t0 = time.time()
    he_pass, he_fail, he_fails = validate_humaneval_plus()
    mb_pass, mb_fail, mb_fails = validate_mbpp_plus()
    ap_counts, ap_fails = validate_apps_plus()

    total_pass = he_pass + mb_pass + sum(c["pass"] for c in ap_counts.values())
    total_fail = he_fail + mb_fail + sum(c["fail"] for c in ap_counts.values())
    total_all = total_pass + total_fail

    elapsed = time.time() - t0
    print("\n" + "=" * 60)
    print(" 🏁 CANONICAL VALIDATION SUMMARY (ALL 1163 PROBLEMS)")
    print("=" * 60)
    print(f"HumanEval+ (164):          {he_pass} / 164 PASSED ({(he_pass/164*100):.1f}%)")
    print(f"MBPP+ (399):                {mb_pass} / 399 PASSED ({(mb_pass/399*100):.1f}%)")
    print(f"APPS+ Introductory (200):   {ap_counts['introductory']['pass']} / 200 PASSED ({(ap_counts['introductory']['pass']/200*100):.1f}%)")
    print(f"APPS+ Interview (200):      {ap_counts['interview']['pass']} / 200 PASSED ({(ap_counts['interview']['pass']/200*100):.1f}%)")
    print(f"APPS+ Competition (200):    {ap_counts['competition']['pass']} / 200 PASSED ({(ap_counts['competition']['pass']/200*100):.1f}%)")
    print(f"APPS+ Total (600):          {sum(c['pass'] for c in ap_counts.values())} / 600 PASSED ({(sum(c['pass'] for c in ap_counts.values())/600*100):.1f}%)")
    print("-" * 60)
    print(f"TOTAL BENCHMARK (1163):     {total_pass} / {total_all} PASSED ({(total_pass/total_all*100):.1f}%)")
    print(f"Elapsed Time:               {elapsed:.2f} seconds")
    print("=" * 60)
