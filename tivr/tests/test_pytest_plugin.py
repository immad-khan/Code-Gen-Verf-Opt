"""Tests for ``tivr/pytest_plugin.py`` (Requirements 8.7, 9.8, 9.9, 10.5).

Each scenario writes ``solution.py`` + ``test_solution.py`` into a temp dir and
runs pytest in a subprocess exactly as the verifier does
(``-p tivr.pytest_plugin`` with ``PYTHONPATH=<repo root>``), then inspects the
JSON report.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import textwrap
from pathlib import Path
from typing import Any, Optional

import pytest

from tivr.equivalence import SUITE_HELPER_SOURCE, from_source

REPO_ROOT = Path(__file__).resolve().parents[2]


def _run_pytest(project: Path, report: Optional[Path]) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.pop("PYTEST_ADDOPTS", None)
    env.pop("PYTEST_PLUGINS", None)
    env["PYTHONPATH"] = str(REPO_ROOT)
    if report is None:
        env.pop("TIVR_PYTEST_REPORT", None)
    else:
        env["TIVR_PYTEST_REPORT"] = str(report)
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider",
         "-p", "tivr.pytest_plugin", "--tb=short", str(project)],
        cwd=project, env=env, capture_output=True, text=True, timeout=120,
    )


def _project(root: Path, solution: str, tests: str) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "solution.py").write_text(textwrap.dedent(solution), encoding="utf-8")
    (root / "test_solution.py").write_text(textwrap.dedent(tests), encoding="utf-8")
    return root


def _report(project: Path) -> dict[str, Any]:
    report_path = project.parent / f"{project.name}-report.json"
    proc = _run_pytest(project, report_path)
    assert report_path.exists(), proc.stdout + proc.stderr
    return json.loads(report_path.read_text(encoding="utf-8"))


SOLUTION = """\
class BadInput(ValueError):
    pass


def add(a, b):
    return a + b + 1


def one_arg(x):
    return x


def guarded(x):
    assert x > 0, "x must be positive"
    return x


def custom(x):
    raise BadInput("bad input: %r" % (x,))


def pairs():
    return (1, 2)
"""

TESTS = (
    "from solution import add, one_arg, guarded, custom, pairs\n\n"
    + SUITE_HELPER_SOURCE
    + """

def test_functional_assert():
    assert add(1, 2) == 3


def test_tuple_vs_list():
    assert pairs() == [1, 2]


def test_helper_check():
    args = (2, 2)
    _tivr_check(add(*args), 4, 0, 5, args)


def test_type_error():
    one_arg(1, 2)


def test_assert_in_candidate():
    guarded(-1)


def test_custom_exception():
    custom(3)


def test_passes():
    assert one_arg(7) == 7
"""
)


@pytest.fixture(scope="module")
def runtime_report(tmp_path_factory: pytest.TempPathFactory) -> dict[str, dict[str, Any]]:
    project = _project(tmp_path_factory.mktemp("runtime") / "proj", SOLUTION, TESTS)
    data = _report(project)
    assert data["exitstatus"] == 1
    assert data["collection_errors"] == []
    return {entry["nodeid"].split("::")[-1]: entry for entry in data["tests"]}


def test_functional_assert_records_operands(runtime_report):
    entry = runtime_report["test_functional_assert"]
    assert entry["outcome"] == "failed" and entry["when"] == "call"
    exc = entry["exception"]
    assert exc["type"] == "AssertionError" and exc["module"] == "builtins"
    assert exc["from_suite_assert"] is True
    assert exc["raised_in"] == "test_solution.py"
    assert "assert" in exc["longrepr"]
    assert entry["compare"] == {"op": "==", "actual": "4", "expected": "3"}


def test_compare_values_round_trip_through_from_source(runtime_report):
    compare = runtime_report["test_tuple_vs_list"]["compare"]
    assert from_source(compare["actual"]) == (1, 2)
    assert from_source(compare["expected"]) == [1, 2]


def test_helper_check_records_tivr_values(runtime_report):
    entry = runtime_report["test_helper_check"]
    exc = entry["exception"]
    assert exc["type"] == "AssertionError"
    assert exc["from_suite_assert"] is True
    assert exc["raised_in"] == "test_solution.py"
    assert "compare" not in entry
    assert entry["tivr_values"] == {"case": 5, "input": "(2, 2)", "actual": "5", "expected": "4"}


def test_type_error_in_call(runtime_report):
    exc = runtime_report["test_type_error"]["exception"]
    assert exc["type"] == "TypeError" and exc["module"] == "builtins"
    assert "positional argument" in exc["message"]
    assert exc["from_suite_assert"] is False
    assert "tivr_values" not in runtime_report["test_type_error"]


def test_assertion_error_inside_candidate_is_not_suite_assert(runtime_report):
    entry = runtime_report["test_assert_in_candidate"]
    exc = entry["exception"]
    assert exc["type"] == "AssertionError"
    assert exc["raised_in"] == "solution.py"
    assert exc["from_suite_assert"] is False
    assert exc["message"] == "x must be positive"
    assert "compare" not in entry


def test_custom_exception_class(runtime_report):
    exc = runtime_report["test_custom_exception"]["exception"]
    assert exc["type"] == "BadInput"
    assert exc["module"] == "solution"
    assert exc["raised_in"] == "solution.py"
    assert exc["message"] == "bad input: 3"


def test_passing_test_is_recorded_without_exception(runtime_report):
    entry = runtime_report["test_passes"]
    assert entry["outcome"] == "passed"
    assert "exception" not in entry and "compare" not in entry


def test_collection_import_error_records_import_name(tmp_path):
    project = _project(
        tmp_path / "proj",
        "def other():\n    return 1\n",
        "from solution import entry\n\n\ndef test_entry():\n    assert entry() == 1\n",
    )
    data = _report(project)
    assert data["exitstatus"] == 2
    assert data["tests"] == []
    assert len(data["collection_errors"]) == 1
    error = data["collection_errors"][0]
    assert error["nodeid"] == "test_solution.py"
    exc = error["exception"]
    assert exc["type"] == "ImportError"
    assert exc["import_name"] == "solution"
    assert "cannot import name 'entry'" in exc["message"]
    assert exc["longrepr"]


def test_plugin_is_noop_without_report_env(tmp_path):
    project = _project(tmp_path / "proj", "def f():\n    return 1\n",
                       "from solution import f\n\n\ndef test_f():\n    assert f() == 2\n")
    proc = _run_pytest(project, None)
    assert proc.returncode == 1, proc.stdout + proc.stderr
    assert "1 failed" in proc.stdout
    assert not list(tmp_path.rglob("*.json"))
