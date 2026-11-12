"""
prepare_mbpp.py — script to convert EvalPlus MBPP+ benchmark into data/mbpp_plus.jsonl.
"""
from __future__ import annotations
import json
from pathlib import Path
from evalplus.data import get_mbpp_plus


def build_visible_tests(entry_point: str, assertion: str) -> str:
    """Extract visible assertions from MBPP task definition."""
    lines = [
        "from solution import *",
        f"from solution import {entry_point}",
        "",
        f"def test_{entry_point}_visible():",
    ]
    if assertion.strip():
        for line in assertion.strip().splitlines():
            lines.append(f"    {line.strip()}")
    else:
        lines.append("    pass")
    return "\n".join(lines)


def build_hidden_tests(task_id: str, entry_point: str, assertion: str, base_inputs: list, plus_inputs: list) -> str:
    """Build complete hidden pytest suite combining base assertion + plus extended inputs."""
    sanitized_id = task_id.replace("/", "_")
    lines = [
        "import math",
        "from solution import *",
        f"from solution import {entry_point}",
        "",
        f"def test_{sanitized_id}_hidden():",
    ]
    # Base assertion check
    if assertion.strip():
        for l in assertion.strip().splitlines():
            lines.append(f"    {l.strip()}")
            
    # Extended plus inputs check
    if plus_inputs:
        lines.append(f"    plus_inputs = {repr(plus_inputs[:100])}")
        lines.append("    for inp in plus_inputs:")
        lines.append("        if isinstance(inp, (list, tuple)):")
        lines.append(f"            {entry_point}(*inp)")
        lines.append("        else:")
        lines.append(f"            {entry_point}(inp)")
        
    return "\n".join(lines)


def main():
    data_dir = Path("data")
    data_dir.mkdir(parents=True, exist_ok=True)
    out_file = data_dir / "mbpp_plus.jsonl"

    problems = get_mbpp_plus()
    records = []

    for task_id, p in problems.items():
        entry_point = p["entry_point"]
        prompt = p["prompt"]
        canonical = p["canonical_solution"]
        assertion = p.get("assertion", "")

        visible_tests = build_visible_tests(entry_point, assertion)
        hidden_tests = build_hidden_tests(task_id, entry_point, assertion, p.get("base_input", []), p.get("plus_input", []))

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

    print(f"Successfully exported {len(records)} MBPP+ tasks to {out_file}")


if __name__ == "__main__":
    main()
