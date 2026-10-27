"""Unit tests for the rule-based TaxonomyMapper (tivr/taxonomy.py).

Covers first-match evaluation, advisory findings, UNMAPPED fallback,
diagnosis ordering, and primary_state (design.md §1 rules, §2 mapper).
"""
from __future__ import annotations

import dataclasses

import pytest

from tivr.schemas import (
    ADVISORY,
    BLOCKING,
    CORRECTNESS_TECHNIQUES,
    UNMAPPED,
    Finding,
    MappedFinding,
    TechniqueStatus,
    VerificationReport,
)
from tivr.taxonomy import TaxonomyMapper, map_report, primary_state
from tivr.taxonomy_def import TaxonomyDefinition, load_definition

B4_MESSAGE = "f() takes 1 positional argument but 2 were given"


@pytest.fixture(scope="module")
def definition() -> TaxonomyDefinition:
    return load_definition()


@pytest.fixture(scope="module")
def mapper(definition: TaxonomyDefinition) -> TaxonomyMapper:
    return TaxonomyMapper(definition)


def _f(signal: str, message: str = "msg", technique: str = "runtime",
       severity: str = BLOCKING) -> Finding:
    return Finding(technique=technique, severity=severity, signal=signal, message=message)


def _report(*findings: Finding, complete: bool = True) -> VerificationReport:
    status = "fail" if findings else "pass"
    techniques = {t: TechniqueStatus(status if complete else "error")
                  for t in CORRECTNESS_TECHNIQUES}
    return VerificationReport(techniques=techniques, correctness=list(findings))


# ---- map_finding ----------------------------------------------------

@pytest.mark.parametrize("finding, expected", [
    (_f("no_code_output", technique="syntax"), "A.1"),
    (_f("syntax:IndentationError", "unexpected indent", "syntax"), "A.2"),
    (_f("syntax:SyntaxError", "import * only allowed at module level", "syntax"), "A.3"),
    (_f("syntax:SyntaxError", "'(' was never closed", "syntax"), "A.1"),
    (_f("runtime:ValueError:llm_defined"), "B.5"),
    (_f("runtime:NameError:stdlib_unbound", "name 'math' is not defined"), "A.3"),
    (_f("runtime:NameError", "name 'x' is not defined"), "B.2"),
    (_f("runtime:TypeError", B4_MESSAGE), "B.4"),
    (_f("runtime:TypeError", "unsupported operand type(s)"), "B.1"),
    (_f("runtime:IndexError", "list index out of range"), "B.3"),
    (_f("timeout", technique="tests"), "B.5"),
    (_f("functional:format", technique="tests"), "C.3"),
    (_f("functional:logic", technique="tests"), "C.1"),
])
def test_map_finding_assigns_expected_category(mapper: TaxonomyMapper,
                                               finding: Finding, expected: str) -> None:
    m = mapper.map_finding(finding)
    assert isinstance(m, MappedFinding)
    assert m.category == expected
    assert m.rule_id is not None and m.confidence is not None
    # The original finding data is carried over unchanged.
    assert (m.signal, m.message, m.technique) == (finding.signal, finding.message, finding.technique)


def test_first_matching_rule_wins(definition: TaxonomyDefinition) -> None:
    f = _f("runtime:TypeError", B4_MESSAGE)
    matching = [r for r in definition.rules if r.matches(f.technique, f.signal, f.message)]
    assert len(matching) >= 2, "fixture must match several rules"

    m = TaxonomyMapper(definition).map_finding(f)
    assert (m.category, m.rule_id, m.confidence) == (
        matching[0].category, matching[0].id, matching[0].confidence)

    reversed_defn = dataclasses.replace(definition, rules=tuple(reversed(definition.rules)))
    m_rev = TaxonomyMapper(reversed_defn).map_finding(f)
    assert (m_rev.category, m_rev.rule_id) == (matching[-1].category, matching[-1].id)
    assert m_rev.category != m.category


def test_advisory_finding_gets_no_category(mapper: TaxonomyMapper) -> None:
    # Even a signal that would match a rule must stay uncategorised when advisory.
    m = mapper.map_finding(_f("timeout", technique="types", severity=ADVISORY))
    assert m.category is None and m.rule_id is None and m.confidence is None


@pytest.mark.parametrize("signal, message", [
    ("runtime:UnicodeDecodeError", "invalid start byte"),
    ("runtime:AssertionError", "raised inside candidate"),
    ("syntax:SyntaxError", "invalid syntax"),
    ("collection:unknown", "no identifiable exception"),
])
def test_unmatched_blocking_finding_is_unmapped(mapper: TaxonomyMapper,
                                                signal: str, message: str) -> None:
    m = mapper.map_finding(_f(signal, message))
    assert m.category == UNMAPPED
    assert m.rule_id is None and m.confidence is None
    assert m.signal == signal


# ---- map_report / diagnoses ----------------------------------------

def test_map_report_diagnoses_sorted_with_unmapped_last(definition: TaxonomyDefinition) -> None:
    report = _report(
        _f("runtime:UnicodeDecodeError", "bad byte"),
        _f("functional:logic", "assert failed", "tests"),
        _f("runtime:IndexError", "list index out of range"),
        _f("runtime:IndexError", "list index out of range"),
        _f("syntax:IndentationError", "unexpected indent", "syntax"),
    )
    map_report(report, definition)

    cats = [d.category for d in report.diagnoses]
    assert cats == ["A.2", "B.3", "C.1", UNMAPPED]
    assert [d.priority for d in report.diagnoses] == sorted(d.priority for d in report.diagnoses)
    # All findings stay visible and mapped.
    assert len(report.correctness) == 5
    assert all(isinstance(f, MappedFinding) for f in report.correctness)

    b3 = report.diagnoses[1]
    assert b3.primary == "B" and b3.secondary == definition.categories["B.3"].name
    assert b3.repair_hint == definition.categories["B.3"].repair_hint
    assert b3.signals == ["runtime:IndexError"] and len(b3.rule_ids) == 1

    un = report.diagnoses[-1]
    assert un.primary is None and un.secondary is None
    assert un.priority == definition.unmapped.priority
    assert un.signals == ["runtime:UnicodeDecodeError"]


def test_map_report_ignores_advisory(definition: TaxonomyDefinition) -> None:
    report = _report(_f("runtime:KeyError", "'k'"))
    report.advisory.append(_f("mypy:arg-type", technique="types", severity=ADVISORY))
    map_report(report, definition)
    assert [d.category for d in report.diagnoses] == ["B.3"]
    assert len(report.advisory) == 1


# ---- primary_state --------------------------------------------------

def test_primary_state_pass(definition: TaxonomyDefinition) -> None:
    report = _report()
    report.advisory.append(_f("semgrep:x", technique="security", severity=ADVISORY))
    assert primary_state(report, definition) == ("PASS", False)


def test_primary_state_highest_priority(definition: TaxonomyDefinition) -> None:
    report = _report(_f("functional:logic", technique="tests"),
                     _f("runtime:AttributeError", "no attribute 'x'"),
                     _f("runtime:UnicodeDecodeError"))
    map_report(report, definition)
    assert primary_state(report, definition) == ("B", False)


def test_primary_state_unmapped_only_is_c(definition: TaxonomyDefinition) -> None:
    report = _report(_f("runtime:RuntimeError", "boom"))
    map_report(report, definition)
    assert primary_state(report, definition) == ("C", True)


def test_primary_state_maps_unmapped_report_on_the_fly(definition: TaxonomyDefinition) -> None:
    report = _report(_f("syntax:TabError", "inconsistent use of tabs", "syntax"))
    assert primary_state(report, definition) == ("A", False)


def test_primary_state_incomplete_without_findings(definition: TaxonomyDefinition) -> None:
    report = _report(complete=False)
    assert not report.gate_passed()
    assert primary_state(report, definition) == ("C", True)
