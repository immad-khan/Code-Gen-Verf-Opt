"""
taxonomy.py — Dou et al. bug taxonomy + the verified-signal -> category mapper.

THIS FILE IS THE PAPER'S NOVELTY. Dou et al. ask the LLM to self-critique
using taxonomy knowledge; TIVR instead DETERMINES the category from
verified execution evidence and hands the model both the category and the
proof. That directly attacks the feedback-quality bottleneck (Olausson
et al., ICLR 2024).

######################################################################
# !! VERIFY BEFORE ANY EXPERIMENT !!
# The primary/secondary names below are a best-effort reconstruction.
# Open Dou et al. (Sci China Inf Sci 2026), find the taxonomy
# figure/table (3 primary, 10 secondary categories) and replace every
# `primary` and `secondary` string with the paper's EXACT wording.
# Only the display strings need editing — IDs and mapping rules stand.
######################################################################
"""
from __future__ import annotations
import re
from schemas import Finding, TaxonomyDiagnosis, VerificationReport, BLOCKING

TAXONOMY: dict[str, dict] = {
    # --- Primary: Syntax errors ---
    "S1": dict(primary="Syntax Error", secondary="Syntax rule violation",
               repair_hint="The code violates Python grammar at the reported "
               "line. Fix the exact construct (brackets, colons, indentation) "
               "without changing the algorithm."),
    "S2": dict(primary="Syntax Error", secondary="Incomplete generation",
               repair_hint="The code was cut off before completion. Regenerate "
               "the FULL program, ensuring every function, block and string "
               "is closed."),
    # --- Primary: Runtime errors ---
    "R1": dict(primary="Runtime Error", secondary="Undefined name / reference",
               repair_hint="A variable or function is used before definition "
               "or misspelled. Define it or correct the name; check scoping."),
    "R2": dict(primary="Runtime Error", secondary="API misuse / hallucinated API",
               repair_hint="The code calls a module, function or attribute "
               "that does not exist or is used with a wrong contract. Replace "
               "it with a REAL API (prefer the standard library). Do not "
               "invent names."),
    "R3": dict(primary="Runtime Error", secondary="Type mismatch",
               repair_hint="An operation receives an incompatible type. Trace "
               "the value's type from creation to the failing line and insert "
               "the correct conversion or fix the operation."),
    "R4": dict(primary="Runtime Error", secondary="Invalid value / index / key",
               repair_hint="An index, key or value is out of range or invalid "
               "(IndexError/KeyError/ValueError/ZeroDivisionError). Add the "
               "missing bounds/None/zero guard at the failing access."),
    # --- Primary: Functional errors ---
    "F1": dict(primary="Functional Error", secondary="Misunderstood requirement",
               repair_hint="The output disagrees with the specification on "
               "MOST tests, so the approach itself misreads the task. Re-read "
               "the specification sentence by sentence, restate the "
               "requirement, then re-implement."),
    "F2": dict(primary="Functional Error", secondary="Logic error",
               repair_hint="The algorithm is close but produces wrong output "
               "on some inputs. Compare expected vs actual in the evidence, "
               "locate the incorrect operation/condition, and fix ONLY that."),
    "F3": dict(primary="Functional Error", secondary="Missing edge case",
               repair_hint="Base cases fail only at boundaries (empty input, "
               "single element, zero/negative, duplicates, max size). Add "
               "explicit handling for the boundary shown in the evidence."),
    "F4": dict(primary="Functional Error", secondary="Performance / non-termination",
               repair_hint="The code exceeds time limits (infinite loop or "
               "wrong complexity class). Check loop exit conditions and "
               "replace the algorithm with a lower-complexity one."),
}

# Repair order when several categories co-occur: structural problems first,
# semantics last — fixing logic inside syntactically broken code is wasted.
PRIORITY = ["S2", "S1", "R2", "R1", "R3", "R4", "F4", "F1", "F2", "F3"]


# ---------------------------------------------------------------------
# Mapping rules: (predicate over Finding, taxonomy_id, confidence)
# Evaluated top-down; first match per finding wins.
# ---------------------------------------------------------------------
def _rules():
    return [
        (lambda f: f.signal == "SyntaxError:truncated",             "S2", 0.95),
        (lambda f: f.technique == "syntax",                         "S1", 0.95),
        (lambda f: f.signal == "ModuleNotFoundError",               "R2", 0.90),
        (lambda f: "AttributeError" in f.signal
                   or "ImportError" in f.signal,                    "R2", 0.80),
        (lambda f: "NameError" in f.signal
                   or "UnboundLocalError" in f.signal,              "R1", 0.90),
        (lambda f: "TypeError" in f.signal,                         "R3", 0.85),
        (lambda f: re.search(r"(Index|Key|Value|ZeroDivision|Overflow)Error",
                             f.signal) is not None,                 "R4", 0.85),
        (lambda f: f.signal == "Timeout"
                   or "RecursionError" in f.signal,                 "F4", 0.85),
        (lambda f: f.signal.startswith("test_failure"),             "F2", 0.60),
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

    # --- Functional refinement heuristics (only assertion failures) ----
    f2 = hits.get("F2")
    if f2 is not None:
        total = report.metrics.get("tests_passed", 0) + \
                report.metrics.get("tests_failed", 0)
        failed = report.metrics.get("tests_failed", 0)
        edgey = any(re.search(r"edge|empty|zero|single|bound|negative|large",
                              s, re.I) for s in f2.source_signals)
        if total > 0 and failed / total >= 0.8:
            _reclassify(hits, "F2", "F1", 0.65)   # nearly everything fails
        elif edgey and failed / max(total, 1) <= 0.4:
            _reclassify(hits, "F2", "F3", 0.70)   # only boundary tests fail

    report.diagnoses = sorted(hits.values(),
                              key=lambda d: PRIORITY.index(d.taxonomy_id))
    report.repair_priority = [d.taxonomy_id for d in report.diagnoses]


def _reclassify(hits: dict, old: str, new: str, conf: float) -> None:
    d = hits.pop(old)
    t = TAXONOMY[new]
    d.taxonomy_id, d.primary, d.secondary = new, t["primary"], t["secondary"]
    d.repair_hint, d.confidence = t["repair_hint"], conf
    hits[new] = d
