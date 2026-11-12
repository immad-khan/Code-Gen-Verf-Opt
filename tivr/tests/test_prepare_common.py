"""Tests for tivr/scripts/prepare_common.py (Requirements 3.1, 3.2, 3.3, 3.9, 4.5)."""
from __future__ import annotations

import json
import math

import pytest

from tivr.equivalence import from_source
from tivr.scripts.prepare_common import (
    Case,
    CanonicalRunner,
    OmittedInput,
    SuiteFailure,
    atomic_write_text,
    build_case_suite,
    collect_cases,
    report_path_for,
    skipped_path_for,
    validate_suites,
    write_jsonl_atomic,
    write_report,
    write_skipped,
)
from tivr.verifier import ProjectVerifier

ADD = "def add(x, y):\n    return x + y\n"
SPIN = "def spin(x):\n    while x:\n        pass\n    return x\n"


# ---------------------------------------------------------------- runner ---

def test_runner_ok_returns_serialized_output():
    with CanonicalRunner(ADD, "add") as runner:
        result = runner.run((1, 2))
        assert result.status == "ok"
        assert from_source(result.value_source) == 3
        assert from_source(runner.run(([1], [2])).value_source) == [1, 2]
        assert runner.starts == 1  # persistent worker


def test_runner_deep_copies_each_input():
    program = "def grow(xs):\n    xs.append(len(xs))\n    return xs\n"
    args = ([0],)
    with CanonicalRunner(program, "grow") as runner:
        first = runner.run(args)
        second = runner.run(args)
    assert first.value_source == second.value_source == "[0, 1]"
    assert args == ([0],)


def test_runner_reports_exception_and_keeps_worker():
    program = "def inv(x):\n    return 1 // x\n"
    with CanonicalRunner(program, "inv") as runner:
        failed = runner.run((0,))
        assert failed.status == "exception"
        assert failed.exception == "ZeroDivisionError"
        assert runner.run((1,)).value_source == "1"
        assert runner.starts == 1


def test_runner_timeout_kills_and_restarts_worker():
    with CanonicalRunner(SPIN, "spin", timeout_s=1.0) as runner:
        timed_out = runner.run((1,))
        assert timed_out.status == "timeout"
        recovered = runner.run((0,))
        assert recovered.status == "ok"
        assert recovered.value_source == "0"
        assert runner.starts == 2


def test_runner_unserializable_output_and_input():
    program = "def make(kind):\n    return object() if kind else [1.5, float('nan')]\n"
    with CanonicalRunner(program, "make") as runner:
        bad = runner.run((True,))
        assert bad.status == "unserializable"
        assert bad.detail.startswith("output")
        good = runner.run((False,))
        assert good.status == "ok"
        value = from_source(good.value_source)
        assert value[0] == 1.5 and math.isnan(value[1])
        bad_input = runner.run((object(),))
        assert bad_input.status == "unserializable"
        assert bad_input.detail.startswith("input")


def test_runner_program_output_does_not_corrupt_protocol():
    program = "def echo(x):\n    print('noise', x)\n    return x\n"
    with CanonicalRunner(program, "echo") as runner:
        assert runner.run(("a",)).value_source == "'a'"


def test_runner_missing_entry_point_fails_every_input():
    with CanonicalRunner(ADD, "missing") as runner:
        first = runner.run((1, 2))
        second = runner.run((3, 4))
    assert first.status == second.status == "exception"
    assert first.exception == "AttributeError"


def test_collect_cases_omits_failing_inputs():
    program = "def inv(x):\n    return 1 // x\n"
    with CanonicalRunner(program, "inv") as runner:
        collected = collect_cases(runner, [[1], [0], [object()], [2]])
    assert collected.cases == [Case("(1,)", "1"), Case("(2,)", "0")]
    assert collected.input_indices == [0, 3]
    assert [(o.index, o.status) for o in collected.omitted] == [
        (1, "exception"), (2, "unserializable")]
    assert collected.omitted[0].detail.startswith("ZeroDivisionError")


# ----------------------------------------------------------------- suites ---

SORT_PROGRAM = "def sort_desc(xs):\n    xs.sort(reverse=True)\n    return xs\n"
WRONG_SORT = "def sort_desc(xs):\n    return sorted(xs)\n"


@pytest.fixture(scope="module")
def sort_suite() -> tuple[str, int]:
    inputs = [[[3, 1, 2]], [[5, 4]], [[1, 2, 3, 4]]]
    with CanonicalRunner(SORT_PROGRAM, "sort_desc") as runner:
        cases = collect_cases(runner, inputs).cases
    return build_case_suite("sort_desc", cases, 0.0, suite_name="hidden"), len(cases)


def test_suite_is_self_contained_and_checks_outputs(sort_suite):
    source, count = sort_suite
    compile(source, "test_solution.py", "exec")
    assert "from solution import sort_desc" in source
    assert "def _tivr_check(" in source
    assert "assert bool(" not in source
    # (args tuple, expected) pairs inlined as to_source text
    assert "    (([3, 1, 2],), [3, 2, 1])," in source
    assert count == 3


def test_suite_passes_canonical_and_fails_wrong_candidate(sort_suite):
    source, count = sort_suite
    verifier = ProjectVerifier(test_timeout_s=60)
    canonical = verifier.verify_candidate(SORT_PROGRAM, source, suite="hidden")
    assert canonical.gate_passed()
    assert canonical.tests_passed == count and canonical.tests_failed == 0
    wrong = verifier.verify_candidate(WRONG_SORT, source, suite="hidden")
    assert not wrong.gate_passed()
    assert wrong.tests_failed >= 1


def test_suite_atol_tolerates_small_float_error():
    cases = [Case.from_values((2.0,), 1.0), Case.from_values((8.0,), 3.0)]
    source = build_case_suite("log2", cases, 0.01, suite_name="hidden")
    verifier = ProjectVerifier(test_timeout_s=60)
    close = "def log2(x):\n    import math\n    return math.log2(x) + 0.005\n"
    far = "def log2(x):\n    import math\n    return math.log2(x) + 0.5\n"
    assert verifier.verify_candidate(close, source).gate_passed()
    assert not verifier.verify_candidate(far, source).gate_passed()


def test_build_case_suite_rejects_bad_arguments():
    with pytest.raises(ValueError):
        build_case_suite("not an identifier", [], 0.0, suite_name="hidden")
    with pytest.raises(ValueError):
        build_case_suite("f", [], -1.0, suite_name="hidden")
    with pytest.raises(ValueError):
        build_case_suite("f", [], float("nan"), suite_name="hidden")


def test_validate_suites_reports_failing_task_and_suite(sort_suite):
    source, _ = sort_suite
    visible = build_case_suite("sort_desc", [Case.from_values(([2, 1],), [2, 1])], 0.0,
                               suite_name="visible")
    records = [
        {"task_id": "T/0", "canonical_solution": SORT_PROGRAM,
         "visible_tests": visible, "hidden_tests": source},
        {"task_id": "T/1", "canonical_solution": WRONG_SORT,
         "visible_tests": visible, "hidden_tests": source},
    ]
    failures = validate_suites(records, timeout_s=60, max_workers=2)
    assert [(f.task_id, f.suite) for f in failures] == [("T/1", "visible"), ("T/1", "hidden")]
    assert all(f.reason for f in failures)


# ---------------------------------------------------------------- writers ---

def test_atomic_write_replaces_and_preserves_on_error(tmp_path):
    out = tmp_path / "data.jsonl"
    write_jsonl_atomic(out, [{"task_id": "a"}, {"task_id": "b"}])
    assert [json.loads(line)["task_id"] for line in out.read_text("utf-8").splitlines()] \
        == ["a", "b"]
    with pytest.raises(ValueError):
        write_jsonl_atomic(out, [{"task_id": "c", "atol": float("nan")}])
    atomic_write_text(tmp_path / "other.txt", "x")
    with pytest.raises(TypeError):
        atomic_write_text(out, None)  # type: ignore[arg-type]
    assert [json.loads(line)["task_id"] for line in out.read_text("utf-8").splitlines()] \
        == ["a", "b"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["data.jsonl", "other.txt"]


def test_report_files(tmp_path):
    out = tmp_path / "humaneval_plus.jsonl"
    assert report_path_for(out) == tmp_path / "humaneval_plus.jsonl.report.json"
    assert skipped_path_for(out) == tmp_path / "humaneval_plus.jsonl.skipped.json"
    write_report(report_path_for(out), {
        "tasks_prepared": 2,
        "omitted_inputs": {"T/0": [OmittedInput(3, "timeout", "exceeded 10 s")]},
        "canonical_failures": [SuiteFailure("T/1", "hidden", "test:assertion")],
    })
    report = json.loads(report_path_for(out).read_text("utf-8"))
    assert report["omitted_inputs"]["T/0"][0] == {
        "index": 3, "status": "timeout", "detail": "exceeded 10 s"}
    assert report["canonical_failures"][0]["suite"] == "hidden"
    write_skipped(skipped_path_for(out), [{"id": 4, "reason": "missing field prompt"}])
    assert json.loads(skipped_path_for(out).read_text("utf-8")) == [
        {"id": 4, "reason": "missing field prompt"}]
    assert not out.exists()
