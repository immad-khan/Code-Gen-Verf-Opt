"""Unit tests for tivr.schemas (gate_passed, complete, to_dict)."""
import json

import pytest

from tivr.schemas import (
    ADVISORY, BLOCKING, CORRECTNESS_TECHNIQUES, AssertionValues, Diagnosis,
    Finding, Location, MappedFinding, TechniqueStatus, VerificationReport,
)


def _all_pass() -> dict:
    return {t: TechniqueStatus("pass") for t in CORRECTNESS_TECHNIQUES}


def _functional_finding() -> MappedFinding:
    return MappedFinding(
        technique="tests", severity=BLOCKING, signal="functional:logic",
        message="2 assertions failed", evidence="assert f(1) == 2",
        location=Location("test_solution.py", 3), test_id="test_solution.py::test_case",
        occurrences=2, values=[AssertionValues("1", "3", "2")],
        category="C.1", rule_id="R18", confidence=0.9)


def _advisory_finding() -> Finding:
    return Finding(technique="quality", severity=ADVISORY, signal="radon:cc",
                   message="cyclomatic complexity C", location=Location("solution.py"))


def test_gate_passes_with_no_findings_and_complete_techniques():
    r = VerificationReport(techniques=_all_pass(), tests_passed=3)
    assert r.complete()
    assert r.gate_passed()


def test_advisory_findings_do_not_affect_gate():
    r = VerificationReport(techniques=_all_pass(), advisory=[_advisory_finding()])
    assert r.gate_passed()


def test_correctness_finding_fails_gate():
    t = _all_pass()
    t["tests"] = TechniqueStatus("fail")
    r = VerificationReport(techniques=t, correctness=[_functional_finding()])
    assert r.complete()
    assert not r.gate_passed()


def test_skipped_upstream_counts_as_complete():
    t = {"syntax": TechniqueStatus("fail"), "imports": TechniqueStatus("skipped_upstream"),
         "tests": TechniqueStatus("skipped_upstream"), "runtime": TechniqueStatus("skipped_upstream")}
    r = VerificationReport(techniques=t)
    assert r.complete()


@pytest.mark.parametrize("missing", CORRECTNESS_TECHNIQUES)
def test_missing_technique_is_incomplete_and_fails_gate(missing):
    t = _all_pass()
    del t[missing]
    r = VerificationReport(techniques=t)
    assert not r.complete()
    assert r.incomplete_techniques() == [missing]
    assert not r.gate_passed()


def test_error_status_is_incomplete_and_fails_gate():
    t = _all_pass()
    t["tests"] = TechniqueStatus("error", details="harness crashed")
    r = VerificationReport(techniques=t)
    assert t["tests"].complete is False
    assert not r.gate_passed()


def test_invalid_severity_rejected():
    with pytest.raises(ValueError):
        Finding(technique="types", severity="major", signal="mypy:arg-type", message="x")


def test_advisory_cannot_carry_category():
    with pytest.raises(ValueError):
        MappedFinding(technique="security", severity=ADVISORY, signal="semgrep:x",
                      message="x", category="C.4")


def test_error_status_cannot_be_complete():
    with pytest.raises(ValueError):
        TechniqueStatus("error", complete=True)


def test_to_dict_is_strict_json_and_includes_gate_fields():
    t = _all_pass()
    t["tests"] = TechniqueStatus("fail", details="1 failed")
    f = _functional_finding()
    f.confidence = float("nan")
    r = VerificationReport(
        suite="visible", techniques=t, correctness=[f], advisory=[_advisory_finding()],
        diagnoses=[Diagnosis("C.1", "C", "Logic error", 11, confidence=float("inf"),
                             repair_hint="h", signals=["functional:logic"], rule_ids=["R18"])],
        tests_passed=1, tests_failed=2)
    d = r.to_dict()
    text = json.dumps(d, allow_nan=False)  # raises on NaN/Infinity
    back = json.loads(text)
    assert back["gate_passed"] is False
    assert back["complete"] is True
    assert back["incomplete_techniques"] == []
    assert back["suite"] == "visible"
    assert back["techniques"]["tests"] == {"status": "fail", "complete": True, "details": "1 failed"}
    c = back["correctness"][0]
    assert c["category"] == "C.1" and c["confidence"] is None
    assert c["location"] == {"file": "test_solution.py", "line": 3}
    assert c["values"] == [{"input": "1", "actual": "3", "expected": "2"}]
    assert back["advisory"][0]["severity"] == "advisory"
    assert "category" not in back["advisory"][0]
    assert back["diagnoses"][0]["confidence"] is None
    assert back["tests_failed"] == 2
