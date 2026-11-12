"""
prepare_humaneval.py — script to convert EvalPlus HumanEval+ benchmark into data/humaneval_plus.jsonl.
"""
from __future__ import annotations
import json
import re
from pathlib import Path
from evalplus.data import get_human_eval_plus


def extract_docstring_tests(prompt: str, entry_point: str) -> str:
    """Extract doctest assertions (>>> func(...)) from the task prompt docstring."""
    doctests = []
    lines = prompt.splitlines()
    for i, line in enumerate(lines):
        line_str = line.strip()
        if line_str.startswith(">>>"):
            expr = line_str[3:].strip()
            # If the next line is the expected output (and not another >>> or end of docstring)
            if i + 1 < len(lines):
                expected = lines[i + 1].strip()
                if expected and not expected.startswith(">>>") and not expected.startswith('"""') and not expected.startswith("'''"):
                    doctests.append(f"assert {expr} == {expected}")
                else:
                    doctests.append(f"assert bool({expr})")
            else:
                doctests.append(f"assert bool({expr})")
    
    if not doctests:
        return f"def test_{entry_point}_visible():\n    pass"

    test_lines = [f"from solution import {entry_point}", f"def test_{entry_point}_visible():"]
    for dt in doctests:
        test_lines.append(f"    {dt}")
    return "\n".join(test_lines)


def build_pytest_suite(task_id: str, entry_point: str, test_code: str, base_inputs: list, plus_inputs: list, atol: float) -> str:
    """Build complete pytest suite from base_input and plus_input."""
    sanitized_id = task_id.replace("/", "_")
    lines = [
        "import math",
        "from solution import *",
        f"from solution import {entry_point}",
        "",
        f"def test_{sanitized_id}_suite():",
    ]
    
    # Standard check(candidate) execution
    lines.append("    # Base EvalPlus test assertions")
    lines.append("    " + test_code.replace("\n", "\n    "))
    lines.append(f"    check({entry_point})")
    
    # Extended plus_inputs execution
    if plus_inputs:
        lines.append("\n    # Plus extended test inputs")
        lines.append(f"    plus_inputs = {repr(plus_inputs[:100])}")  # Cap at top 100 extended test cases for execution efficiency
        lines.append("    for inp in plus_inputs:")
        lines.append("        if isinstance(inp, (list, tuple)):")
        lines.append(f"            {entry_point}(*inp)")
        lines.append("        else:")
        lines.append(f"            {entry_point}(inp)")

    return "\n".join(lines)


def main():
    data_dir = Path("data")
    data_dir.mkdir(parents=True, exist_ok=True)
    out_file = data_dir / "humaneval_plus.jsonl"

    problems = get_human_eval_plus()
    records = []

    for task_id, p in problems.items():
        entry_point = p["entry_point"]
        prompt = p["prompt"]
        canonical = p["prompt"] + p["canonical_solution"]
        
        visible_tests = extract_docstring_tests(prompt, entry_point)
        hidden_tests = build_pytest_suite(
            task_id, entry_point, p["test"],
            p.get("base_input", []), p.get("plus_input", []), p.get("atol", 1e-6)
        )

        record = {
            "task_id": task_id,
            "prompt": prompt,
            "entry_point": entry_point,
            "canonical_solution": canonical,
            "visible_tests": visible_tests,
            "hidden_tests": hidden_tests,
        }
        records.append(record)

    with open(out_file, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")

    print(f"Successfully exported {len(records)} HumanEval+ tasks to {out_file}")


if __name__ == "__main__":
    main()
