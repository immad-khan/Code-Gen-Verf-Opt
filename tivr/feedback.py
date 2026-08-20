"""
feedback.py — turns a VerificationReport into the repair prompt.
"""
from __future__ import annotations
import re
from .schemas import VerificationReport

MAX_EVIDENCE_ITEMS = 3

GENERATE_TEMPLATE = """You are an expert Python developer. Solve the task below.

## Task
{spec}

Output the complete solution as a single Python code block. No explanations.
"""

REPAIR_TEMPLATE = """You are an expert Python developer fixing your own code.

## Task
{spec}

## Current code (iteration {iteration} of {budget})
```python
{code}
```

## Verified bug diagnosis
{diagnosis_block}

## Evidence from execution
{evidence_block}
{history_block}
## Instructions
Fix ONLY the diagnosed bugs. Keep the required function signature(s).
Output the complete corrected program as a single Python code block. No explanations.
"""


def compose_generation_prompt(spec: str) -> str:
    return GENERATE_TEMPLATE.format(spec=spec.strip())


def compose_repair_prompt(spec: str, code: str, report: VerificationReport,
                          iteration: int, budget: int,
                          history: list[str] | None = None,
                          feedback_mode: str = "full") -> str:
    if feedback_mode == "generic":
        ev = "\n\n".join(f.evidence or f.message
                         for f in report.blocking()[:MAX_EVIDENCE_ITEMS])
        return (f"You wrote this code for the task:\n\n## Task\n{spec}\n\n"
                f"```python\n{code}\n```\n\nThe tests failed with:\n{ev}\n\n"
                "Fix the code. Output a single Python code block.")

    diag_lines, ev_lines = [], []
    for d in report.diagnoses:
        diag_lines.append(f"* Category: {d.primary} -> {d.secondary} "
                          f"(confidence {d.confidence:.2f})")
        if feedback_mode != "evidence_only":
            diag_lines.append(f"  Guidance: {d.repair_hint}")
    if feedback_mode == "evidence_only":
        diag_lines = ["* (see evidence below)"]

    if feedback_mode != "taxonomy_only":
        for f in report.blocking()[:MAX_EVIDENCE_ITEMS]:
            loc = f" [{f.location}]" if f.location else ""
            ev_lines.append(f"* {f.signal}{loc}: {f.message}")
            if f.evidence:
                ev_lines.append("```\n" + f.evidence + "\n```")
    else:
        ev_lines = ["(withheld in this configuration)"]

    hist = ""
    if history:
        hist = ("## Lessons from previous repair attempts\n"
                + "\n".join(f"* {h}" for h in history[-2:]) + "\n\n")

    return REPAIR_TEMPLATE.format(
        spec=spec.strip(), code=code.strip(), iteration=iteration,
        budget=budget,
        diagnosis_block="\n".join(diag_lines) or "* No diagnosis produced.",
        evidence_block="\n".join(ev_lines) or "* No evidence captured.",
        history_block=hist)


def lesson_from(report: VerificationReport, iteration: int) -> str:
    """One-line episodic memory carried into the next iteration."""
    if not report.diagnoses:
        return f"Iteration {iteration}: verification still failing."
    d = report.diagnoses[0]
    return (f"Iteration {iteration}: fix attempt still fails with "
            f"{d.primary} -> {d.secondary} ({d.evidence_summary}). "
            f"A different fix strategy is required.")


CODE_BLOCK_RE = re.compile(r"```(?:python)?\s*\n(.*?)```", re.S)


def extract_code(llm_text: str) -> str:
    """Pull the last fenced code block; fall back to the raw text."""
    blocks = CODE_BLOCK_RE.findall(llm_text)
    return (blocks[-1] if blocks else llm_text).strip()
