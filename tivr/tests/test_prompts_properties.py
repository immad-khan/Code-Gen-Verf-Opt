"""Property-based tests for tivr.prompts.

Feature: paper-aligned-repair-tool

Property 21: Single-pass template rendering is exact.
**Validates: Requirements 2.6, 11.1, 11.4**
For any variable values (braces, ``{solution}``/``{prompt}``-like substrings,
regex back-references, newlines, unicode), ``render`` equals an independently
computed split-and-join of the template on its *declared* placeholders:
substituted values appear verbatim and are never rescanned, undeclared
placeholders stay literal. The Dou generation prompt is Dou's published prefix
followed by the task prompt verbatim, and ``dou_no_bt`` equals ``dou_critique``
rendered with an empty checklist (``dou`` with the full checklist).

Property 22: Repair-mode content isolation.
**Validates: Requirements 11.2, 11.5, 11.6, 11.7, 11.8, 11.12, 22.5**
For any report whose correctness findings, diagnoses (category names, hints,
confidences), advisory findings and lessons carry unique marker strings, each
Repair_Mode prompt contains exactly the element kinds its design row allows
and never contains an advisory marker.

Oracles are written from the spec text, not from the code under test.
"""
from __future__ import annotations

import dataclasses
from types import SimpleNamespace

from hypothesis import given, note, settings
from hypothesis import strategies as st

from tivr.prompts import REPAIR_MODES, build_repair_prompt, dou_feedback, generation_prompt, render
from tivr.schemas import (
    ADVISORY, BLOCKING, Diagnosis, Finding, Location, MappedFinding, VerificationReport,
)
from tivr.taxonomy_def import PromptTemplate, load_definition

SETTINGS = settings(max_examples=200, deadline=None)

DEFN = load_definition()

# Dou et al.'s published generation prompt prefix, character for character (Req. 2.6).
DOU_PREFIX = ("Please provide a self-contained Python script that solves the following "
              "problem in a markdown code block:\n\n")


# ---- independent rendering oracle -------------------------------------------

def oracle_render(text: str, values: dict[str, str]) -> str:
    """Left-to-right split-and-join of ``text`` on the literal ``{name}`` tokens of
    the declared names. Values are inserted as opaque strings (never rescanned)."""
    tokens = {"{" + name + "}": value for name, value in values.items()}
    out: list[str] = []
    i = 0
    while True:
        best: tuple[int, str] | None = None
        for tok in tokens:
            j = text.find(tok, i)
            if j != -1 and (best is None or j < best[0]):
                best = (j, tok)
        if best is None:
            out.append(text[i:])
            return "".join(out)
        j, tok = best
        out.append(text[i:j])
        out.append(tokens[tok])
        i = j + len(tok)


# ---- strategies ---------------------------------------------------------------

TRICKY = ["{solution}", "{prompt}", "{error log}", "{checklist}", "{Programming problem}",
          "{spec}", "{code}", "{", "}", "{}", "{{", "}}", "\\1", "\\g<0>", "\\n", "$1",
          "\n", "\r\n", "é", "中文", "🙂", "\x00"]
VALUE_TEXT = st.lists(
    st.one_of(st.text(max_size=12), st.sampled_from(TRICKY)), max_size=8).map("".join)

NAME_ALPHABET = "abcdefgXYZ _-é中1"
NAMES = st.text(alphabet=NAME_ALPHABET, min_size=1, max_size=8)
LITERAL = st.text(alphabet="ab {}\n\r:é中", max_size=10)


@st.composite
def custom_templates(draw):
    """(text, declared names, undeclared names) with arbitrary interleaving."""
    declared = draw(st.lists(NAMES, min_size=0, max_size=4, unique=True))
    undeclared = draw(st.lists(NAMES.filter(lambda n: n not in declared), max_size=3, unique=True))
    seg_choices = [LITERAL]
    if declared:
        seg_choices.append(st.sampled_from(declared).map(lambda n: "{" + n + "}"))
        seg_choices.append(st.sampled_from(declared).map(lambda n: "{{" + n + "}}"))
    if undeclared:
        seg_choices.append(st.sampled_from(undeclared).map(lambda n: "{" + n + "}"))
    segments = draw(st.lists(st.one_of(*seg_choices), max_size=10))
    return "".join(segments), declared, undeclared


# ---- Property 21 --------------------------------------------------------------

@SETTINGS
@given(tpl=custom_templates(), data=st.data())
def test_p21_render_equals_split_and_join_on_custom_templates(tpl, data):
    text, declared, undeclared = tpl
    values = {name: data.draw(VALUE_TEXT, label=f"value[{name}]") for name in declared}
    defn = dataclasses.replace(
        DEFN, prompts={"t": PromptTemplate(name="t", variables=tuple(declared), text=text)})
    # Extra (undeclared) supplied variables must not be substituted either.
    supplied = dict(values, **{n: "SHOULD-NOT-APPEAR" for n in undeclared})
    out = render("t", supplied, defn)
    note(f"template={text!r} values={values!r}")
    assert out == oracle_render(text, values)
    for name in undeclared:
        if "{" + name + "}" in text:
            assert "{" + name + "}" in out
    if "SHOULD-NOT-APPEAR" not in text and not any("SHOULD-NOT-APPEAR" in v for v in values.values()):
        assert "SHOULD-NOT-APPEAR" not in out


@SETTINGS
@given(template_id=st.sampled_from(sorted(DEFN.prompts)), data=st.data())
def test_p21_render_equals_split_and_join_on_shipped_templates(template_id, data):
    tpl = DEFN.prompts[template_id]
    values = {name: data.draw(VALUE_TEXT, label=f"value[{name}]") for name in tpl.variables}
    assert render(template_id, values) == oracle_render(tpl.text, values)


@SETTINGS
@given(problem=VALUE_TEXT, form=st.sampled_from(["str", "mapping", "object"]),
       style=st.sampled_from([None, "dou"]))
def test_p21_dou_generation_is_prefix_plus_verbatim_problem(problem, form, style):
    task = {"str": problem, "mapping": {"task_id": "T/0", "prompt": problem},
            "object": SimpleNamespace(task_id="T/0", prompt=problem)}[form]
    assert generation_prompt(style, task) == DOU_PREFIX + problem


# ---- report strategies (shared by 21 and 22) -----------------------------------

ERROR_STAGES = ("syntax", "import", "collection", "runtime")
SIGNALS = {
    "syntax:SyntaxError": "syntax", "syntax:IndentationError": "syntax",
    "import:ModuleNotFoundError": "imports", "collection:ImportError": "tests",
    "runtime:NameError": "runtime", "runtime:TypeError": "runtime",
    "functional:logic": "tests", "functional:format": "tests",
    "timeout": "tests", "no_code_output": "syntax",
}
AUTO_CATEGORIES = [c.id for c in DEFN.categories.values() if c.primary in ("A", "B", "C")]
PRIMARY_NAMES = [DEFN.primary_types[p].name for p in ("A", "B", "C")]

# Task/code alphabet cannot spell any marker («...»), primary name, or "confidence".
SAFE_TEXT = st.text(alphabet="abxyz _(){}:=\n0123456789é中", max_size=40)


def evid(i): return f"«EVID{i}»"
def msg(i): return f"«MSG{i}»"
def loc(i): return f"«LOC{i}»"
def cat(j): return f"«CAT{j}»"
def hint(j): return f"«HINT{j}»"
def adv(a): return f"«ADV{a}»"
def lesson(n): return f"* «LES{n}»"


@st.composite
def reports(draw):
    specs = draw(st.lists(st.tuples(st.sampled_from(sorted(SIGNALS)), st.booleans(),
                                    st.booleans(), st.one_of(st.none(), st.integers(1, 99))),
                          max_size=6))
    correctness = [
        MappedFinding(technique=SIGNALS[sig], severity=BLOCKING, signal=sig, message=msg(i),
                      evidence=evid(i) if has_ev else "",
                      location=Location(loc(i), line) if has_loc else None,
                      category=draw(st.sampled_from(AUTO_CATEGORIES)), rule_id="R00",
                      confidence=0.5)
        for i, (sig, has_ev, has_loc, line) in enumerate(specs)]
    diag_specs = draw(st.lists(st.tuples(st.sampled_from(AUTO_CATEGORIES),
                                         st.one_of(st.none(), st.floats(0, 1))), max_size=4))
    diagnoses = [
        Diagnosis(category=cid, primary=DEFN.categories[cid].primary, secondary=cat(j),
                  priority=DEFN.categories[cid].priority, confidence=conf,
                  repair_hint=hint(j), evidence_summary=f"«SUM{j}»")
        for j, (cid, conf) in enumerate(diag_specs)]
    n_adv = draw(st.integers(1, 3))
    advisory = [Finding(technique="quality", severity=ADVISORY, signal=f"radon:{adv(a)}",
                        message=adv(a), evidence=adv(a), location=Location(adv(a), 1))
                for a in range(n_adv)]
    report = VerificationReport(suite="hidden", correctness=correctness, advisory=advisory,
                                diagnoses=diagnoses, tests_failed=len(correctness))
    return report, specs


def _dou_values(task, code, report, checklist):
    return {"prompt": task, "solution": code, "error log": dou_feedback(report),
            "checklist": checklist}


@SETTINGS
@given(task=VALUE_TEXT, code=VALUE_TEXT, rep=reports(), iteration=st.integers(1, 4),
       k=st.integers(1, 3), n_lessons=st.integers(0, 4))
def test_p21_dou_and_dou_no_bt_render_exactly(task, code, rep, iteration, k, n_lessons):
    report, _ = rep
    lessons = [lesson(n) for n in range(n_lessons)]
    text = DEFN.prompts["dou_critique"].text
    dou = build_repair_prompt("dou", task, code, report, iteration, k, lessons)
    no_bt = build_repair_prompt("dou_no_bt", task, code, report, iteration, k, lessons)
    assert dou == oracle_render(text, _dou_values(task, code, report, DEFN.checklist_text()))
    assert no_bt == oracle_render(text, _dou_values(task, code, report, ""))


# ---- Property 22 ----------------------------------------------------------------

def _expected_dou_feedback_parts(specs):
    """(included texts, excluded markers) per the Dou_Feedback rule (design §3)."""
    all_markers = [m(i) for i in range(len(specs)) for m in (evid, msg, loc)]
    if any(sig == "timeout" for sig, *_ in specs):
        return [DEFN.dou_feedback["timeout"]], all_markers
    errors = [i for i, (sig, *_) in enumerate(specs)
              if sig == "no_code_output" or sig.split(":", 1)[0] in ERROR_STAGES]
    if not errors:
        return [DEFN.dou_feedback["functional"]], all_markers
    included: list[str] = []
    for i in errors[:3]:
        sig, has_ev, *_ = specs[i]
        if has_ev:
            included.append(evid(i))
        elif sig == "no_code_output":
            included.append(DEFN.dou_feedback["no_code"])
        else:
            included.append(msg(i))
    excluded = [m for m in all_markers if m not in included]
    return included, excluded


def _assert_no_taxonomy(out: str):
    assert "«CAT" not in out and "«HINT" not in out
    assert "(confidence " not in out and "confidence" not in out.lower()
    for name in PRIMARY_NAMES:
        assert name not in out


def _assert_no_checklist(out: str):
    for item in DEFN.checklist:
        assert item.strip() not in out


@SETTINGS
@given(task=SAFE_TEXT, code=SAFE_TEXT, rep=reports(), iteration=st.integers(1, 4),
       k=st.integers(1, 3), n_lessons=st.integers(0, 4), mode=st.sampled_from(REPAIR_MODES))
def test_p22_repair_mode_content_isolation(task, code, rep, iteration, k, n_lessons, mode):
    report, specs = rep
    lessons = [lesson(n) for n in range(n_lessons)]
    out = build_repair_prompt(mode, task, code, report, iteration, k, lessons)
    note(f"mode={mode} iteration={iteration} specs={specs}\n--- prompt ---\n{out}")
    n = len(specs)

    # Advisory findings never reach any prompt (11.12, 22.5).
    assert "«ADV" not in out

    if mode in ("dou", "dou_no_bt"):
        assert task in out and code in out
        included, excluded = _expected_dou_feedback_parts(specs)
        for text in included:
            assert text in out
        for marker in excluded:
            assert marker not in out
        _assert_no_taxonomy(out)
        assert "«LES" not in out
        if mode == "dou":
            assert DEFN.checklist_text() in out          # all 10, verbatim, in order (11.1)
        else:
            _assert_no_checklist(out)                    # 11.4
        return

    # Non-Dou modes never carry the checklist.
    _assert_no_checklist(out)
    assert task.strip() in out and code.strip() in out

    if mode == "generic":                                # 11.5
        for i, (_, has_ev, _, _) in enumerate(specs[:3]):
            assert (evid(i) if has_ev else msg(i)) in out
        for i in range(3, n):
            assert evid(i) not in out and msg(i) not in out
        _assert_no_taxonomy(out)
        assert "«LES" not in out
        return

    if mode in ("evidence_only", "full"):                # 11.6, 11.8: evidence of <= 3 findings
        for i, (_, has_ev, has_loc, _) in enumerate(specs[:3]):
            assert msg(i) in out
            assert (evid(i) in out) == has_ev
            assert (loc(i) in out) == has_loc
        for i in range(3, n):
            assert evid(i) not in out and msg(i) not in out and loc(i) not in out
    else:                                                # taxonomy_only: no execution evidence (11.7)
        for i in range(n):
            assert evid(i) not in out and msg(i) not in out and loc(i) not in out

    if mode == "evidence_only":
        _assert_no_taxonomy(out)
    else:                                                # taxonomy_only / full: category + hint
        for j, diag in enumerate(report.diagnoses):
            conf = "n/a" if diag.confidence is None else f"{diag.confidence:.2f}"
            assert cat(j) in out and hint(j) in out
            assert f"{cat(j)} (confidence {conf})" in out
            assert DEFN.primary_types[diag.primary].name in out

    header = DEFN.prompts["lessons_header"].text
    if mode == "full" and iteration >= 2 and lessons:    # 11.8: <= 2 most recent lessons
        recent = lessons[-2:]
        for les in recent:
            assert les in out
        for les in lessons[:-2]:
            assert les not in out
        assert header in out
    else:
        assert "«LES" not in out and header not in out
