"""
TIVR — Taxonomy-guided Iterative Verification and Repair.
schemas.py — canonical data structures shared by every stage.

Design rules (design.md §2 "Data structures"):
* Everything the verifier learns is a ``Finding``. Correctness findings
  (syntax, imports, tests, runtime) are ``blocking``; findings from the
  optional mypy/radon/semgrep techniques are ``advisory`` and never carry a
  taxonomy category (Req. 20.1, 20.2).
* The correctness gate depends only on correctness findings and on the four
  correctness techniques having returned a result (Req. 19.5, 19.7).
* ``to_dict`` output is strict JSON: snake_case keys, no NaN/Infinity
  (non-finite floats become ``None``).
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any

# ---- severities -------------------------------------------------------
BLOCKING = "blocking"   # correctness finding; gates the repair loop
ADVISORY = "advisory"   # types/quality/security; reported only, never mapped
SEVERITIES = (BLOCKING, ADVISORY)

# ---- techniques -------------------------------------------------------
CORRECTNESS_TECHNIQUES = ("syntax", "imports", "tests", "runtime")
ADVISORY_TECHNIQUES = ("types", "quality", "security")

# ---- technique statuses -----------------------------------------------
STATUS_PASS = "pass"
STATUS_FAIL = "fail"
STATUS_SKIPPED_UPSTREAM = "skipped_upstream"  # fail-fast after syntax/import; complete
STATUS_NO_TESTS = "no_tests"
STATUS_ERROR = "error"                        # harness crash / timeout; incomplete
TECHNIQUE_STATUSES = (STATUS_PASS, STATUS_FAIL, STATUS_SKIPPED_UPSTREAM,
                      STATUS_NO_TESTS, STATUS_ERROR)

# ---- suites -----------------------------------------------------------
SUITES = ("hidden", "visible", "none", "project")

# ---- primary states ---------------------------------------------------
UNMAPPED = "UNMAPPED"


class PrimaryState:
    """Primary_State values of a candidate on a suite."""
    A = "A"        # syntax
    B = "B"        # runtime
    C = "C"        # functional (also UNMAPPED-only failures)
    PASS = "PASS"
    ALL = ("A", "B", "C", "PASS")


@dataclass
class Location:
    file: str
    line: int | None = None


@dataclass
class AssertionValues:
    """Values of one failing suite assertion, as ``to_source`` text.

    ``None`` means the value could not be extracted.
    """
    input: str | None = None
    actual: str | None = None
    expected: str | None = None


@dataclass
class Finding:
    technique: str                  # syntax|imports|tests|runtime|types|quality|security
    severity: str                   # "blocking" | "advisory"
    signal: str                     # enriched signal or advisory signal
    message: str                    # one line
    evidence: str = ""              # interpreter report / failing assertion text (<= 40 lines)
    exception: str | None = None    # exact class name of outermost exception
    location: Location | None = None
    test_id: str | None = None
    occurrences: int = 1            # grouped failing tests sharing signal+message
    values: list[AssertionValues] = field(default_factory=list)  # functional only

    def __post_init__(self) -> None:
        if self.severity not in SEVERITIES:
            raise ValueError(
                f"severity must be one of {SEVERITIES}, got {self.severity!r}")

    @property
    def is_blocking(self) -> bool:
        return self.severity == BLOCKING


@dataclass
class MappedFinding(Finding):
    category: str | None = None     # "A.1".."C.4" | "UNMAPPED" | None (advisory)
    rule_id: str | None = None
    confidence: float | None = None

    def __post_init__(self) -> None:
        super().__post_init__()
        # Req. 20.2: advisory findings never carry a taxonomy category.
        if self.severity == ADVISORY and self.category is not None:
            raise ValueError("advisory findings cannot carry a taxonomy category")


@dataclass
class TechniqueStatus:
    status: str                     # pass|fail|skipped_upstream|no_tests|error
    complete: bool | None = None    # derived from status when omitted
    details: str = ""

    def __post_init__(self) -> None:
        if self.status not in TECHNIQUE_STATUSES:
            raise ValueError(
                f"status must be one of {TECHNIQUE_STATUSES}, got {self.status!r}")
        if self.complete is None:
            self.complete = self.status != STATUS_ERROR
        elif self.status == STATUS_ERROR and self.complete:
            raise ValueError("a technique with status 'error' cannot be complete")


@dataclass
class Diagnosis:
    """One diagnosis per assigned category (or UNMAPPED)."""
    category: str                   # "A.1".."C.4" | "UNMAPPED"
    primary: str | None             # "A" | "B" | "C"; None for UNMAPPED
    secondary: str | None           # category name; None for UNMAPPED
    priority: int                   # lower = higher priority
    confidence: float | None = None
    repair_hint: str | None = None
    evidence_summary: str = ""      # one line tying the diagnosis to evidence
    signals: list[str] = field(default_factory=list)
    rule_ids: list[str] = field(default_factory=list)


@dataclass
class VerificationReport:
    suite: str = "hidden"           # "hidden" | "visible" | "none" | "project"
    techniques: dict[str, TechniqueStatus] = field(default_factory=dict)
    correctness: list[MappedFinding] = field(default_factory=list)
    advisory: list[Finding] = field(default_factory=list)
    diagnoses: list[Diagnosis] = field(default_factory=list)  # sorted by priority
    tests_passed: int = 0
    tests_failed: int = 0

    def incomplete_techniques(self) -> list[str]:
        """Correctness techniques that are missing or did not return a result."""
        return [t for t in CORRECTNESS_TECHNIQUES
                if t not in self.techniques or not self.techniques[t].complete]

    def complete(self) -> bool:
        """All four correctness techniques returned a result (Req. 19.7)."""
        return not self.incomplete_techniques()

    def gate_passed(self) -> bool:
        """Zero correctness findings and a complete verification (Req. 19.5).

        Advisory findings never influence the gate (Req. 20.3, 20.6).
        """
        return not self.correctness and self.complete()

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["gate_passed"] = self.gate_passed()
        d["complete"] = self.complete()
        d["incomplete_techniques"] = self.incomplete_techniques()
        return _json_safe(d)


def _json_safe(obj: Any) -> Any:
    """Recursively replace non-finite floats with None and tuples with lists."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    return obj
