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
from .schemas import Finding, TaxonomyDiagnosis, VerificationReport, BLOCKING

TAXONOMY: dict[str, dict] = {
    # --- Primary: Type A: Syntax Bug ---
    "A.1": dict(primary="Type A: Syntax Bug", secondary="A.1 Incomplete syntax structure",
                repair_hint="Syntax error detected at line(s). Unmatched delimiters (parentheses, brackets, braces) or missing colons/quotes detected. Complete all open code structures and output a syntactically valid block."),
    "A.2": dict(primary="Type A: Syntax Bug", secondary="A.2 Incorrect indentation",
                repair_hint="Indentation error detected. Check block nesting (if/for/def) and ensure consistent 4-space indentation across all lines without altering code logic."),
    "A.3": dict(primary="Type A: Syntax Bug", secondary="A.3 Library import error",
                repair_hint="Module import failure or forbidden scope import (e.g. star import inside function). Move standard/valid imports to the top level of the file and remove non-existent modules."),

    # --- Primary: Type B: Runtime Bug ---
    "B.1": dict(primary="Type B: Runtime Bug", secondary="B.1 API misuse",
                repair_hint="AttributeError or inappropriate operation on type. Verify object types before calling methods (e.g. dict vs list methods), and replace hallucinated APIs with standard library calls."),
    "B.2": dict(primary="Type B: Runtime Bug", secondary="B.2 Definition missing",
                repair_hint="NameError / UnboundLocalError: a variable, parameter, or helper function is referenced before assignment or misspelled. Check scoping and ensure initialization before use."),
    "B.3": dict(primary="Type B: Runtime Bug", secondary="B.3 Incorrect boundary condition check",
                repair_hint="Boundary execution crash (IndexError, KeyError, ValueError, ZeroDivisionError). Add explicit guards for empty inputs, zero denominators, and index ranges before access."),
    "B.4": dict(primary="Type B: Runtime Bug", secondary="B.4 Incorrect argument",
                repair_hint="TypeError in function call: argument count, positional/keyword mismatch, or expected parameter types. Adjust the function call arguments to match the definition signature."),
    "B.5": dict(primary="Type B: Runtime Bug", secondary="B.5 Minors",
                repair_hint="Runtime exception or execution timeout (e.g. RecursionError / Infinite loop). Add base case checks or loop exit conditions to ensure timely execution."),

    # --- Primary: Type C: Functional Bug ---
    "C.1": dict(primary="Type C: Functional Bug", secondary="C.1 Misunderstanding and logic error",
                repair_hint="Functional assertion failure: algorithm misinterprets the core problem specification. Re-read the task constraints, trace expected vs actual values in evidence, and fix the core algorithm logic."),
    "C.2": dict(primary="Type C: Functional Bug", secondary="C.2 Hallucination",
                repair_hint="Code satisfies syntax but completely strays from problem goals (hallucinated problem transformation). Re-align the algorithm strictly with the problem prompt requirements."),
    "C.3": dict(primary="Type C: Functional Bug", secondary="C.3 Input/output format error",
                repair_hint="Return value or data structure mismatch (e.g., returning float instead of int, list instead of tuple, or wrong string formatting). Explicitly cast the return value to match the expected return type."),
    "C.4": dict(primary="Type C: Functional Bug", secondary="C.4 Minors",
                repair_hint="Minor algorithmic flaw or off-by-one error causing isolated test failures. Adjust boundary constants (e.g., `<` vs `<=`, initial accumulator values)."),
}

# Strict paper severity ordering: Syntax bugs (A.1-A.3) -> Runtime bugs (B.1-B.5) -> Functional bugs (C.1-C.4)
PRIORITY = [
    "A.1", "A.2", "A.3",
    "B.1", "B.2", "B.3", "B.4", "B.5",
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
