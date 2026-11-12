"""Property-based tests for Primary_State derivation (tivr/taxonomy.py).

Property 7: Primary_State depends only on correctness findings.

The oracle is independent of the loader and of ``TaxonomyMapper``: it reads
category priorities, primary types, the UNMAPPED entry and the ordered rules
straight from ``shared/taxonomy.v1.json`` and evaluates first-match rules
itself. Expected semantics:

* ``("PASS", False)`` iff the gate passes: zero correctness findings and all
  four correctness techniques returned a result (status present, not error).
* otherwise the primary type of the lowest-priority-number category among the
  correctness findings (UNMAPPED never wins);
* UNMAPPED-only failures, and incomplete verifications with no findings, are
  ``("C", True)``.
* Advisory findings (and advisory technique statuses) never change the result.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from hypothesis import HealthCheck, event, given, settings
from hypothesis import strategies as st

from tivr.schemas import (
    ADVISORY,
    ADVISORY_TECHNIQUES,
    BLOCKING,
    CORRECTNESS_TECHNIQUES,
    STATUS_ERROR,
    TECHNIQUE_STATUSES,
    Finding,
    MappedFinding,
    TechniqueStatus,
    VerificationReport,
)
from tivr.taxonomy import primary_state
from tivr.taxonomy_def import TaxonomyDefinition, load_definition

_SETTINGS = settings(
    max_examples=200,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow],
)

DEFINITION: TaxonomyDefinition = load_definition()
RAW: dict[str, Any] = json.loads(Path(DEFINITION.path).read_text(encoding="utf-8"))
RAW_RULES: list[dict[str, Any]] = RAW["rules"]
RAW_PRIORITY: dict[str, int] = {c["id"]: c["priority"] for c in RAW["categories"]}
RAW_PRIMARY: dict[str, str] = {c["id"]: c["primary"] for c in RAW["categories"]}
UNMAPPED_ID: str = RAW["unmapped"]["id"]
UNMAPPED_STATE: str = RAW["unmapped"]["primary_state"]
CATEGORY_IDS: list[str] = list(RAW_PRIORITY)


# ---------------------------------------------------------------------------
# Independent oracle
# ---------------------------------------------------------------------------

def _reference_category(f: Finding) -> str:
    """First-match category of a blocking finding over the raw JSON rules."""
    for r in RAW_RULES:
        m = r["match"]
        allowed = m.get("technique")
        if allowed is not None and f.technique not in allowed:
            continue
        sig = m.get("signal")
        if sig is not None and re.match(r"\A(?:" + sig + r")\Z", f.signal) is None:
            continue
        msg = m.get("message")
        if msg is not None:
            flags = re.IGNORECASE if m.get("ignore_case") else 0
            if re.search(msg, f.message, flags) is None:
                continue
        return r["category"]
    return UNMAPPED_ID


def _oracle_complete(techniques: dict[str, TechniqueStatus]) -> bool:
    return all(t in techniques and techniques[t].status != STATUS_ERROR
               for t in CORRECTNESS_TECHNIQUES)


def _oracle(report: VerificationReport) -> tuple[str, bool]:
    if not report.correctness and _oracle_complete(report.techniques):
        return "PASS", False
    cats = []
    for f in report.correctness:
        cat = getattr(f, "category", None)
        cats.append(cat if cat is not None else _reference_category(f))
    real = [c for c in cats if c != UNMAPPED_ID]
    if not real:
        return UNMAPPED_STATE, True
    best = min(real, key=lambda c: RAW_PRIORITY[c])
    return RAW_PRIMARY[best], False


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_RULES_WITH_SIGNAL = [r for r in RAW_RULES if "signal" in r["match"]]
_TEXT = st.text(max_size=20)


@st.composite
def _enriched(draw: st.DrawFn) -> tuple[str, str]:
    """(signal, message): mostly drawn from one rule's own patterns, else random."""
    if draw(st.integers(0, 3)) == 0:
        signal = draw(st.one_of(
            st.sampled_from(["functional:logic", "timeout", "no_code_output",
                             "runtime:Weird", "zzz:unknown"]),
            _TEXT))
        return signal, draw(_TEXT)
    m = draw(st.sampled_from(_RULES_WITH_SIGNAL))["match"]
    signal = draw(st.from_regex(m["signal"], fullmatch=True))
    if "message" in m and draw(st.integers(0, 4)) > 0:
        message = draw(st.from_regex(m["message"]))
        if m.get("ignore_case") and draw(st.booleans()):
            message = message.upper()
    else:
        message = draw(_TEXT)
    return signal, message


@st.composite
def _correctness_finding(draw: st.DrawFn) -> Finding:
    technique = draw(st.sampled_from(CORRECTNESS_TECHNIQUES))
    signal, message = draw(_enriched())
    kind = draw(st.integers(0, 2))
    if kind == 0:
        # Already mapped with an explicit category (any of A.1-C.4 or UNMAPPED).
        category = draw(st.sampled_from(CATEGORY_IDS + [UNMAPPED_ID, UNMAPPED_ID]))
        return MappedFinding(technique=technique, severity=BLOCKING, signal=signal,
                             message=message, category=category)
    if kind == 1:
        # MappedFinding not yet categorised: primary_state must map it via the rules.
        return MappedFinding(technique=technique, severity=BLOCKING, signal=signal,
                             message=message)
    # Plain unmapped Finding.
    return Finding(technique=technique, severity=BLOCKING, signal=signal, message=message)


@st.composite
def _advisory_finding(draw: st.DrawFn) -> Finding:
    # Advisory findings may even carry signals that would map to A/B categories.
    signal, message = draw(_enriched())
    technique = draw(st.sampled_from(ADVISORY_TECHNIQUES + CORRECTNESS_TECHNIQUES))
    cls = draw(st.sampled_from([Finding, MappedFinding]))
    return cls(technique=technique, severity=ADVISORY, signal=signal, message=message)


@st.composite
def _techniques(draw: st.DrawFn, names: tuple[str, ...]) -> dict[str, TechniqueStatus]:
    out: dict[str, TechniqueStatus] = {}
    for t in names:
        # Biased towards complete verifications so PASS is reachable often.
        choice = draw(st.integers(0, 9))
        if choice == 0:
            continue                                 # missing -> incomplete
        if choice == 1:
            out[t] = TechniqueStatus(STATUS_ERROR)   # error -> incomplete
        else:
            out[t] = TechniqueStatus(draw(st.sampled_from(
                [s for s in TECHNIQUE_STATUSES if s != STATUS_ERROR])))
    return out


@st.composite
def _reports(draw: st.DrawFn) -> VerificationReport:
    techniques = draw(_techniques(CORRECTNESS_TECHNIQUES))
    techniques.update(draw(_techniques(ADVISORY_TECHNIQUES)))
    correctness = draw(st.one_of(
        st.just([]),
        st.lists(_correctness_finding(), min_size=1, max_size=6)))
    advisory = draw(st.lists(_advisory_finding(), max_size=4))
    return VerificationReport(suite=draw(st.sampled_from(["hidden", "visible", "none", "project"])),
                              techniques=techniques, correctness=correctness,
                              advisory=advisory)


def _with_advisory(report: VerificationReport, advisory: list[Finding],
                   advisory_statuses: dict[str, TechniqueStatus]) -> VerificationReport:
    techniques = {t: s for t, s in report.techniques.items() if t in CORRECTNESS_TECHNIQUES}
    techniques.update(advisory_statuses)
    return VerificationReport(suite=report.suite, techniques=techniques,
                              correctness=list(report.correctness), advisory=advisory)


# ---------------------------------------------------------------------------
# Property 7
# ---------------------------------------------------------------------------

def test_oracle_inputs_from_definition_json() -> None:
    """UNMAPPED ranks below every category and resolves to C (Req. 15.4)."""
    assert UNMAPPED_STATE == "C"
    assert RAW["unmapped"]["priority"] > max(RAW_PRIORITY.values())
    assert sorted(CATEGORY_IDS) == sorted(DEFINITION.categories)


@_SETTINGS
@given(report=_reports(),
       other_advisory=st.lists(_advisory_finding(), max_size=4),
       other_statuses=_techniques(ADVISORY_TECHNIQUES))
def test_primary_state_depends_only_on_correctness_findings(
        report: VerificationReport, other_advisory: list[Finding],
        other_statuses: dict[str, TechniqueStatus]) -> None:
    """**Validates: Requirements 15.4, 20.3, 21.2**"""
    expected = _oracle(report)
    result = primary_state(report, DEFINITION)
    assert result == expected

    state, unmapped_as_c = result
    event(f"state={state} unmapped_as_c={unmapped_as_c}")
    # PASS iff the gate passes (gate itself checked against the oracle).
    oracle_gate = not report.correctness and _oracle_complete(report.techniques)
    assert report.gate_passed() == oracle_gate
    assert (state == "PASS") == report.gate_passed()
    if unmapped_as_c:
        assert state == "C"

    # Default-definition call path agrees with the explicit definition.
    assert primary_state(report) == expected

    # Advisory findings and advisory technique statuses never change the result:
    # removed, replaced, or added on top of the existing ones.
    for adv in ([], other_advisory, report.advisory + other_advisory):
        for statuses in ({}, other_statuses):
            variant = _with_advisory(report, adv, statuses)
            assert primary_state(variant, DEFINITION) == expected
            assert variant.gate_passed() == report.gate_passed()


@_SETTINGS
@given(findings=st.lists(_correctness_finding(), min_size=1, max_size=6),
       advisory=st.lists(_advisory_finding(), max_size=4))
def test_changing_advisory_findings_never_changes_state(
        findings: list[Finding], advisory: list[Finding]) -> None:
    """**Validates: Requirements 15.4, 20.3, 21.2**

    Complete verification: state is the primary of the highest-priority
    non-UNMAPPED category, or ("C", True) when only UNMAPPED findings exist.
    """
    techniques = {t: TechniqueStatus("fail") for t in CORRECTNESS_TECHNIQUES}
    base = VerificationReport(techniques=techniques, correctness=findings)
    expected = _oracle(base)
    assert expected[0] != "PASS"
    assert primary_state(base, DEFINITION) == expected
    loud = VerificationReport(techniques=dict(techniques), correctness=list(findings),
                              advisory=advisory)
    assert primary_state(loud, DEFINITION) == expected


def test_examples() -> None:
    """Pinned examples of Primary_State derivation."""
    complete = {t: TechniqueStatus("pass") for t in CORRECTNESS_TECHNIQUES}

    def mf(cat: str) -> MappedFinding:
        return MappedFinding(technique="tests", severity=BLOCKING, signal="x",
                             message="m", category=cat)

    adv = [Finding(technique="security", severity=ADVISORY, signal="security:B101", message="m")]
    assert primary_state(VerificationReport(techniques=complete, advisory=adv)) == ("PASS", False)
    assert primary_state(VerificationReport(techniques=complete,
                                            correctness=[mf("C.1"), mf("B.4")])) == ("B", False)
    assert primary_state(VerificationReport(techniques=complete,
                                            correctness=[mf(UNMAPPED_ID), mf("A.3")])) == ("A", False)
    assert primary_state(VerificationReport(techniques=complete,
                                            correctness=[mf(UNMAPPED_ID)])) == ("C", True)
    incomplete = dict(complete, runtime=TechniqueStatus(STATUS_ERROR))
    assert primary_state(VerificationReport(techniques=incomplete)) == ("C", True)
    assert primary_state(VerificationReport(techniques={})) == ("C", True)
