"""Unit tests for tivr.prompts (rendering, generation prompts, Dou feedback, repair modes)."""
import pytest

from tivr.prompts import (
    NO_EVIDENCE, REPAIR_MODES, WITHHELD_EVIDENCE, TemplateError, build_repair_prompt,
    dou_feedback, generation_prompt, lesson_from, render,
)
from tivr.schemas import (
    ADVISORY, BLOCKING, CORRECTNESS_TECHNIQUES, Diagnosis, Finding, Location,
    MappedFinding, TechniqueStatus, VerificationReport,
)
from tivr.taxonomy_def import load_definition

DEFN = load_definition()
TASK = {"task_id": "T/0", "prompt": "def f(x):\n    \"\"\"Return {x} doubled; see {solution}.\"\"\"\n"}
CODE = "def f(x):\n    return y\n"
ADVISORY_MSG = "ADVISORY-SENTINEL radon complexity"
EVIDENCE = "Traceback (most recent call last):\nNameError: name 'y' is not defined"


def _runtime_finding(evidence: str = EVIDENCE) -> MappedFinding:
    return MappedFinding(technique="runtime", severity=BLOCKING, signal="runtime:NameError",
                         message="name 'y' is not defined", evidence=evidence,
                         exception="NameError", location=Location("solution.py", 2),
                         category="B.2", rule_id="R10", confidence=0.9)


def _functional_finding(i: int = 0) -> MappedFinding:
    return MappedFinding(technique="tests", severity=BLOCKING, signal="functional:logic",
                         message=f"assertion {i} failed", evidence=f"assert f({i}) == {2 * i}",
                         category="C.1", rule_id="R18", confidence=0.7)


def _diag(cat: str = "B.2") -> Diagnosis:
    c = DEFN.categories[cat]
    return Diagnosis(category=cat, primary=c.primary, secondary=c.name, priority=c.priority,
                     confidence=0.9, repair_hint=c.repair_hint, evidence_summary="NameError y")


def _report(findings, diagnoses=()) -> VerificationReport:
    return VerificationReport(
        suite="hidden",
        techniques={t: TechniqueStatus("fail") for t in CORRECTNESS_TECHNIQUES},
        correctness=list(findings),
        advisory=[Finding(technique="quality", severity=ADVISORY, signal="radon:cc",
                          message=ADVISORY_MSG, evidence=ADVISORY_MSG)],
        diagnoses=list(diagnoses), tests_failed=1)


def _build(mode, report=None, iteration=1, lessons=()):
    report = report or _report([_runtime_finding()], [_diag()])
    return build_repair_prompt(mode, TASK, CODE, report, iteration, 2, list(lessons))


def _all_category_names_and_hints():
    out = []
    for c in DEFN.categories.values():
        out += [c.name, c.repair_hint]
    return out + [DEFN.unmapped.name, DEFN.unmapped.repair_hint]


# ---- rendering ----------------------------------------------------------

def test_dou_generation_is_exact_and_leaves_braces_intact():
    expected = ("Please provide a self-contained Python script that solves the following "
                "problem in a markdown code block:\n\n" + TASK["prompt"])
    assert generation_prompt("dou", TASK) == expected
    assert generation_prompt(None, TASK) == expected


def test_tivr_generation_uses_tivr_template():
    out = generation_prompt("tivr", TASK)
    assert out.startswith("You are an expert Python developer. Solve the task below.")
    assert TASK["prompt"].strip() in out


def test_invalid_generation_style_rejected():
    with pytest.raises(ValueError):
        generation_prompt("other", TASK)


def test_render_missing_variable_raises():
    with pytest.raises(TemplateError):
        render("dou_generation", {})
    with pytest.raises(TemplateError):
        render("no_such_template", {})


def test_render_does_not_rescan_substituted_values():
    out = render("guidance_line", {"repair_hint": "{repair_hint} and {other}"})
    assert out == "  Guidance: {repair_hint} and {other}"


# ---- Dou feedback -------------------------------------------------------

def test_dou_feedback_rules():
    fb = DEFN.dou_feedback
    assert dou_feedback(_report([_functional_finding()])) == fb["functional"]
    timeout = MappedFinding(technique="tests", severity=BLOCKING, signal="timeout",
                            message="timed out", evidence="Timeout >60s", category="B.5")
    assert dou_feedback(_report([_functional_finding(), timeout])) == fb["timeout"]
    assert dou_feedback(_report([_functional_finding(), _runtime_finding()])) == EVIDENCE
    no_code = MappedFinding(technique="syntax", severity=BLOCKING, signal="no_code_output",
                            message="no code", category="A.1")
    assert dou_feedback(_report([no_code])) == fb["no_code"]


def test_dou_feedback_joins_first_three_error_reports():
    findings = [_runtime_finding(f"E{i}") for i in range(5)]
    assert dou_feedback(_report(findings)) == "E0\n\nE1\n\nE2"


# ---- repair modes ---------------------------------------------------------

def test_dou_critique_has_checklist_and_no_taxonomy_output():
    out = _build("dou", iteration=2, lessons=["* lesson one"])
    for item in DEFN.checklist:
        assert item in out
    assert DEFN.checklist_text() in out
    assert TASK["prompt"] in out and CODE in out and EVIDENCE in out
    for text in _all_category_names_and_hints():
        assert text not in out
    assert "confidence" not in out.lower()
    assert "0.90" not in out
    assert "lesson one" not in out
    assert "analyze the causes of errors" in out


def test_dou_no_bt_equals_dou_without_checklist():
    dou = _build("dou")
    no_bt = _build("dou_no_bt")
    for item in DEFN.checklist:
        assert item.strip() not in no_bt
    assert dou.replace(DEFN.checklist_text(), "") == no_bt


def test_generic_has_evidence_only_from_at_most_three_findings():
    report = _report([_functional_finding(i) for i in range(5)], [_diag("C.1")])
    out = _build("generic", report=report)
    assert all(f"assert f({i})" in out for i in range(3))
    assert "assert f(3)" not in out
    for text in _all_category_names_and_hints() + list(DEFN.checklist):
        assert text not in out
    assert "confidence" not in out.lower()


def test_evidence_only_omits_taxonomy():
    out = _build("evidence_only")
    assert EVIDENCE in out and "* runtime:NameError [solution.py:2]:" in out
    for text in _all_category_names_and_hints():
        assert text not in out
    assert "confidence" not in out.lower()


def test_taxonomy_only_has_category_and_hint_but_no_evidence():
    out = _build("taxonomy_only")
    c = DEFN.categories["B.2"]
    assert f"* Category: Runtime Bug -> {c.name} (confidence 0.90)" in out
    assert f"  Guidance: {c.repair_hint}" in out
    assert WITHHELD_EVIDENCE in out
    assert EVIDENCE not in out and "name 'y' is not defined" not in out
    assert "runtime:NameError" not in out


def test_full_includes_everything_and_caps_evidence():
    report = _report([_runtime_finding(f"EVID-{i}") for i in range(5)], [_diag()])
    out = _build("full", report=report)
    assert DEFN.categories["B.2"].repair_hint in out
    assert all(f"EVID-{i}" in out for i in range(3)) and "EVID-3" not in out


def test_lessons_only_in_full_and_only_from_iteration_two():
    lessons = ["* L-one", "* L-two", "* L-three"]
    header = DEFN.prompts["lessons_header"].text
    assert header not in _build("full", iteration=1, lessons=lessons)
    out = _build("full", iteration=2, lessons=lessons)
    assert header + "* L-two\n* L-three\n" in out and "L-one" not in out
    for mode in REPAIR_MODES:
        if mode != "full":
            text = _build(mode, iteration=2, lessons=lessons)
            assert "L-two" not in text and header not in text


def test_advisory_never_appears_in_any_mode():
    for mode in REPAIR_MODES:
        assert "ADVISORY-SENTINEL" not in _build(mode, iteration=2, lessons=["* x"])


def test_empty_evidence_fallback_and_invalid_modes():
    out = build_repair_prompt("evidence_only", TASK, CODE, _report([]), 1, 2, [])
    assert NO_EVIDENCE in out
    for bad in ("intervenor", "dou_intervenor", "bogus"):
        with pytest.raises(ValueError):
            _build(bad)


def test_lesson_from_uses_template_with_bullet():
    out = lesson_from(_report([_runtime_finding()], [_diag()]), 1)
    assert out == ("* Iteration 1: fix attempt still fails with Runtime Bug -> Definition missing "
                   "(NameError y). A different fix strategy is required.")
