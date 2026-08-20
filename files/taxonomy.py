"""
taxonomy.py — Dou et al. bug taxonomy + the verified-signal -> category mapper.

THIS FILE IS THE PAPER'S NOVELTY. Dou et al. ask the LLM to self-critique
using taxonomy knowledge; TIVR instead DETERMINES the category from
verified execution evidence and hands the model both the category and the
proof. That directly attacks the feedback-quality bottleneck (Olausson
et al., ICLR 2024).

Taxonomy synchronized with Dou et al. (Sci China Inf Sci 2026):
- 3 Primary Categories (Type A: Syntax Bug, Type B: Runtime Bug, Type C: Functional Bug)
- 10 Secondary Categories (A.1 - A.3, B.1 - B.5, C.1 - C.4)
"""
from __future__ import annotations
import re
from schemas import Finding, TaxonomyDiagnosis, VerificationReport, BLOCKING

TAXONOMY: dict[str, dict] = {
    # --- Primary: Type A: Syntax Bug ---
    "A.1": dict(primary="Type A: Syntax Bug", secondary="A.1 Incomplete syntax structure",
                repair_hint="The generated code includes an open or partially written syntax element (unmatched brackets, unclosed quotes, missing colon). Regenerate the full, closed code block."),
    "A.2": dict(primary="Type A: Syntax Bug", secondary="A.2 Incorrect indentation",
                repair_hint="Python relies on indentation to define block scope. Fix inconsistent or invalid indentation spaces without changing code logic."),
    "A.3": dict(primary="Type A: Syntax Bug", secondary="A.3 Library import error",
                repair_hint="A module import is missing or placed inside a scope where it is not allowed (e.g. star import inside function). Add proper top-level imports."),

    # --- Primary: Type B: Runtime Bug ---
    "B.1": dict(primary="Type B: Runtime Bug", secondary="B.1 API misuse",
                repair_hint="An attribute, method, or operation was called on an incompatible type or non-existent attribute (e.g. AttributeError, inappropriate type usage). Verify object type and correct API calls."),
    "B.2": dict(primary="Type B: Runtime Bug", secondary="B.2 Definition missing",
                repair_hint="A variable or function is referenced before definition or misspelled (NameError/UnboundLocalError). Ensure all names are initialized and scoped properly."),
    "B.3": dict(primary="Type B: Runtime Bug", secondary="B.3 Incorrect boundary condition check",
                repair_hint="Edge check is missing or flawed (e.g., ZeroDivisionError on empty list, IndexError/KeyError). Insert bounds, non-empty, or zero guards before accessing indices or arithmetic operations."),
    "B.4": dict(primary="Type B: Runtime Bug", secondary="B.4 Incorrect argument",
                repair_hint="Function call arguments mismatch expected count, types, or order. Adjust signature and parameter passing."),
    "B.5": dict(primary="Type B: Runtime Bug", secondary="B.5 Minors",
                repair_hint="Execution timed out or raised custom exceptions. Ensure loop termination conditions and handle unexpected branch errors."),

    # --- Primary: Type C: Functional Bug ---
    "C.1": dict(primary="Type C: Functional Bug", secondary="C.1 Misunderstanding and logic error",
                repair_hint="The logic or specification was misunderstood, leading to incorrect assertion outputs. Re-examine the problem specification sentence by sentence and fix the algorithmic logic."),
    "C.2": dict(primary="Type C: Functional Bug", secondary="C.2 Hallucination",
                repair_hint="The code generates syntactically plausible constructs that do not address the problem requirements. Re-align implementation strictly with specification."),
    "C.3": dict(primary="Type C: Functional Bug", secondary="C.3 Input/output format error",
                repair_hint="Return or argument formatting, data types, precision, or order mismatch requirements (e.g. int vs float, list vs tuple). Cast output to the required format."),
    "C.4": dict(primary="Type C: Functional Bug", secondary="C.4 Minors",
                repair_hint="Sub-optimal algorithm, incorrect variable initialization, or infinite loops causing partial test failure or non-termination. Fix initialization values or optimize algorithm."),
}

# Structural & Syntax errors first, Runtime next, Functional errors last
PRIORITY = [
    "A.1", "A.2", "A.3",
    "B.2", "B.1", "B.4", "B.3", "B.5",
    "C.1", "C.2", "C.3", "C.4"
]


# ---------------------------------------------------------------------
# Mapping rules: (predicate over Finding, taxonomy_id, confidence)
# Evaluated top-down; first match per finding wins.
# ---------------------------------------------------------------------
def _rules():
    return [
        (lambda f: f.signal == "SyntaxError:truncated",             "A.1", 0.95),
        (lambda f: "IndentationError" in f.signal
                   or "TabError" in f.signal,                       "A.2", 0.95),
        (lambda f: f.technique == "syntax",                         "A.1", 0.90),
        (lambda f: f.signal == "ModuleNotFoundError"
                   or f.technique == "imports",                     "A.3", 0.90),
        (lambda f: "NameError" in f.signal
                   or "UnboundLocalError" in f.signal,              "B.2", 0.90),
        (lambda f: "AttributeError" in f.signal
                   or "TypeError" in f.signal,                      "B.1", 0.85),
        (lambda f: re.search(r"(Index|Key|Value|ZeroDivision|Overflow)Error",
                             f.signal) is not None,                 "B.3", 0.85),
        (lambda f: f.signal == "Timeout"
                   or "RecursionError" in f.signal,                 "B.5", 0.85),
        (lambda f: f.signal.startswith("test_failure"),             "C.1", 0.60),
    ]


def map_report(report: VerificationReport) -> None:
    """Fill report.diagnoses and report.repair_priority in place."""
    blocking = report.blocking()
    hits: dict[str, TaxonomyDiagnosis] = {}
    for f in blocking:
        for pred, tid, conf in _rules():
            if pred(f):
                f.taxonomy_id = tid
                d = hits.get(tid)
                if d is None:
                    t = TAXONOMY[tid]
                    hits[tid] = TaxonomyDiagnosis(
                        taxonomy_id=tid, primary=t["primary"],
                        secondary=t["secondary"], confidence=conf,
                        evidence_summary=f.message,
                        repair_hint=t["repair_hint"],
                        source_signals=[f.signal])
                else:
                    d.source_signals.append(f.signal)
                    d.confidence = min(0.99, d.confidence + 0.05)
                break

    # --- Functional refinement heuristics (assertion failures) ----
    c1 = hits.get("C.1")
    if c1 is not None:
        total = report.metrics.get("tests_passed", 0) + \
                report.metrics.get("tests_failed", 0)
        failed = report.metrics.get("tests_failed", 0)
        format_err = any(re.search(r"format|type|cast|float|int|str|precision|tuple|list",
                                   s, re.I) for s in c1.source_signals)
        if format_err:
            _reclassify(hits, "C.1", "C.3", 0.75)   # Output format mismatch
        elif total > 0 and failed / total >= 0.8:
            _reclassify(hits, "C.1", "C.1", 0.80)

    report.diagnoses = sorted(hits.values(),
                              key=lambda d: PRIORITY.index(d.taxonomy_id))
    report.repair_priority = [d.taxonomy_id for d in report.diagnoses]


def _reclassify(hits: dict, old: str, new: str, conf: float) -> None:
    if old not in hits:
        return
    d = hits.pop(old)
    t = TAXONOMY[new]
    d.taxonomy_id, d.primary, d.secondary = new, t["primary"], t["secondary"]
    d.repair_hint, d.confidence = t["repair_hint"], conf
    hits[new] = d
