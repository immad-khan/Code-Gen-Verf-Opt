"""Tests for ``tivr/verify_cli.py`` (Req. 19.7, 20.5).

Every case invokes ``python -m tivr.verify_cli`` as a subprocess on a temp project,
exactly as the C# backend does, and checks the written JSON against the shape
of ``Backend/Models/VerificationModels.cs`` ``VerifyCliReport``.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
CORRECTNESS = {"syntax", "imports", "tests", "runtime"}
FINDING_KEYS = {"technique", "severity", "signal", "message", "evidence", "exception",
                "location", "test_id", "occurrences", "values"}

ADD = "def add(a, b):\n    return a + b\n"
ADD_TESTS = "from solution import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n"


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(REPO_ROOT)
    return subprocess.run([sys.executable, "-m", "tivr.verify_cli", *args],
                          cwd=REPO_ROOT, env=env, capture_output=True, text=True,
                          encoding="utf-8", timeout=180)


def _project(tmp_path: Path, files: dict[str, str]) -> Path:
    project = tmp_path / "proj"
    project.mkdir()
    for name, text in files.items():
        (project / name).write_text(text, encoding="utf-8")
    return project


def _verify(tmp_path: Path, files: dict[str, str], *extra: str) -> dict:
    project = _project(tmp_path, files)
    out = tmp_path / "out" / "report.json"
    result = _run("--project", str(project), "--out", str(out), *extra)
    assert result.returncode == 0, result.stderr
    raw = out.read_text(encoding="utf-8")
    assert "NaN" not in raw and "Infinity" not in raw
    return json.loads(raw)


def _assert_schema(report: dict) -> None:
    assert set(report) == {"techniques", "correctness", "tests_passed", "tests_failed"}
    assert set(report["techniques"]) == CORRECTNESS
    for status in report["techniques"].values():
        assert set(status) == {"status", "complete", "details"}
        assert isinstance(status["status"], str) and isinstance(status["complete"], bool)
        assert isinstance(status["details"], str)
    assert isinstance(report["tests_passed"], int) and isinstance(report["tests_failed"], int)
    for f in report["correctness"]:
        assert set(f) == FINDING_KEYS  # enriched and unmapped: no category fields
        assert f["severity"] == "blocking" and f["technique"] in CORRECTNESS
        assert f["location"] is None or set(f["location"]) == {"file", "line"}
        for v in f["values"]:
            assert set(v) == {"input", "actual", "expected"}


def test_passing_project(tmp_path):
    report = _verify(tmp_path, {"solution.py": ADD, "test_solution.py": ADD_TESTS})
    _assert_schema(report)
    assert report["correctness"] == []
    assert {t: s["status"] for t, s in report["techniques"].items()} == {
        t: "pass" for t in CORRECTNESS}
    assert all(s["complete"] for s in report["techniques"].values())
    assert report["tests_passed"] == 1 and report["tests_failed"] == 0


def test_failing_test_reports_functional_finding(tmp_path):
    wrong = "def add(a, b):\n    return a - b\n"
    report = _verify(tmp_path, {"solution.py": wrong, "test_solution.py": ADD_TESTS})
    _assert_schema(report)
    assert report["techniques"]["tests"]["status"] == "fail"
    assert report["tests_failed"] == 1 and report["tests_passed"] == 0
    signals = [f["signal"] for f in report["correctness"]]
    assert signals and all(s.startswith("functional:") for s in signals)


def test_runtime_error_is_reported(tmp_path):
    boom = "def add(a, b):\n    return {}[a]\n"
    report = _verify(tmp_path, {"solution.py": boom, "test_solution.py": ADD_TESTS})
    _assert_schema(report)
    assert report["techniques"]["runtime"]["status"] == "fail"
    assert any(f["exception"] == "KeyError" for f in report["correctness"])


def test_syntax_error_skips_downstream(tmp_path):
    report = _verify(tmp_path, {"solution.py": "def add(a, b)\n    return a + b\n",
                                "test_solution.py": ADD_TESTS})
    _assert_schema(report)
    assert report["techniques"]["syntax"]["status"] == "fail"
    assert all(report["techniques"][t]["status"] == "skipped_upstream"
               for t in ("imports", "tests", "runtime"))
    [finding] = report["correctness"]
    assert finding["technique"] == "syntax" and finding["signal"] == "syntax:SyntaxError"
    assert finding["location"]["file"] == "solution.py"


def test_candidate_module_option(tmp_path):
    # helper.py has an unresolvable import but is not a candidate: not checked.
    files = {"solution.py": ADD, "test_solution.py": ADD_TESTS,
             "helper.py": "import tivr_no_such_module_xyz\n"}
    report = _verify(tmp_path, files, "--candidate-module", "solution", "--test-timeout", "30")
    _assert_schema(report)
    assert report["techniques"]["imports"]["status"] == "pass"
    (tmp_path / "default").mkdir()
    default = _verify(tmp_path / "default", files)  # all non-test modules are candidates
    _assert_schema(default)
    assert default["techniques"]["imports"]["status"] == "fail"
    assert default["correctness"][0]["signal"] == "import:ModuleNotFoundError"


@pytest.mark.parametrize("args", [
    [],                                              # missing required options
    ["--out", "x.json"],                             # missing --project
    ["--project", "{missing}", "--out", "x.json"],   # project is not a directory
    ["--project", "{proj}", "--out", "x.json", "--test-timeout", "0"],
    ["--project", "{proj}", "--out", "x.json", "--test-timeout", "abc"],
])
def test_bad_args_exit_2(tmp_path, args):
    proj = _project(tmp_path, {"solution.py": ADD})
    out = tmp_path / "x.json"
    args = [a.format(missing=tmp_path / "nope", proj=proj) for a in args]
    args = [str(out) if a == "x.json" else a for a in args]
    result = _run(*args)
    assert result.returncode == 2
    assert result.stderr.strip()
    assert not out.exists()


def test_unwritable_out_is_harness_failure(tmp_path):
    proj = _project(tmp_path, {"solution.py": ADD})
    out = tmp_path / "is_a_dir"
    out.mkdir()
    result = _run("--project", str(proj), "--out", str(out))
    assert result.returncode not in (0, 2)
    assert "harness failure" in result.stderr
