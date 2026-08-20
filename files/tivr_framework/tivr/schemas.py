"""
TIVR — Taxonomy-guided Iterative Verification and Repair.
schemas.py — canonical data structures shared by every stage.

Design rule: EVERYTHING the verifier learns is expressed as a Finding.
The taxonomy mapper consumes Findings and produces TaxonomyDiagnosis
objects. The feedback composer consumes both. Nothing downstream ever
re-parses raw tool output — that keeps the pipeline testable.
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
import json
import time

# ---- severity levels -------------------------------------------------
# blocking : code cannot be considered correct (syntax fail, import fail,
#            failing test, runtime crash). Gates the repair loop.
# major    : strong signal of latent defects (mypy type errors,
#            semgrep ERROR-severity). Reported; does NOT gate pass@1,
#            so results stay comparable with Dou et al.
# advisory : quality/maintainability signals (radon grade < B, MI < 65,
#            semgrep WARNING/INFO, low comment ratio). Reported only.
BLOCKING = "blocking"
MAJOR = "major"
ADVISORY = "advisory"

VERDICT_PASS = "PASS"
VERDICT_PASS_WARN = "PASS_WITH_WARNINGS"
VERDICT_FAIL = "FAIL"


@dataclass
class Finding:
    technique: str            # syntax|imports|tests|runtime|types|quality|security
    severity: str             # blocking|major|advisory
    signal: str               # machine-readable, e.g. "SyntaxError",
                              # "ModuleNotFoundError", "test_failure:test_edge",
                              # "mypy:arg-type", "semgrep:python.lang..."
    message: str              # one-line human/LLM-readable summary
    evidence: str = ""        # trimmed raw evidence (traceback tail, failing
                              # assert with expected vs actual, rule snippet)
    location: str = ""        # "solution.py:12" when known
    taxonomy_id: str = ""     # filled by the taxonomy mapper


@dataclass
class TaxonomyDiagnosis:
    taxonomy_id: str          # e.g. "R2" (see taxonomy.py)
    primary: str              # Dou et al. primary category name
    secondary: str            # Dou et al. secondary category name
    confidence: float         # 0..1 heuristic confidence of the mapping
    evidence_summary: str     # one line tying the diagnosis to evidence
    repair_hint: str          # category-specific guidance for the repairer
    source_signals: list[str] = field(default_factory=list)


@dataclass
class VerificationReport:
    verdict: str                                   # PASS|PASS_WITH_WARNINGS|FAIL
    iteration: int
    findings: list[Finding] = field(default_factory=list)
    diagnoses: list[TaxonomyDiagnosis] = field(default_factory=list)
    repair_priority: list[str] = field(default_factory=list)  # ordered taxonomy_ids
    metrics: dict = field(default_factory=dict)    # cc_worst, cc_rank, mi, mi_rank,
                                                   # loc, comment_ratio, api_count,
                                                   # tests_passed, tests_failed
    timing: dict = field(default_factory=dict)     # seconds per stage
    created_at: float = field(default_factory=time.time)

    # The repair loop iterates ONLY on correctness (comparable to Dou et al.).
    def passes_correctness_gate(self) -> bool:
        return not any(f.severity == BLOCKING for f in self.findings)

    def blocking(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == BLOCKING]

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self, **kw) -> str:
        return json.dumps(self.to_dict(), indent=2, **kw)


def compute_verdict(findings: list[Finding]) -> str:
    sev = {f.severity for f in findings}
    if BLOCKING in sev:
        return VERDICT_FAIL
    if MAJOR in sev or ADVISORY in sev:
        return VERDICT_PASS_WARN
    return VERDICT_PASS
