"""Tests for ``tivr/verifier.py`` ``ProjectVerifier`` (design §2 stages 1-5).

Requirements 8.1-8.4, 8.6, 9.6, 12.8, 19.5, 20.1, 20.8. Every case runs the real
pipeline (compile, static imports, pytest subprocess with the tivr plugin).
"""
from __future__ import annotations

import ast
import textwrap
import time

import pytest

from tivr.schemas import (ADVISORY, BLOCKING, CORRECTNESS_TECHNIQUES, STATUS_ERROR,
                          STATUS_FAIL, STATUS_NO_TESTS, STATUS_PASS,
                          STATUS_SKIPPED_UPSTREAM)
from tivr.verifier import ProjectVerifier, module_level_imports

ADD = "def add(a, b):\n    return a + b\n"
ADD_TESTS = "from solution import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n"


@pytest.fixture(scope="module")
def verifier() -> ProjectVerifier:
    return ProjectVerifier()


def _statuses(report) -> dict[str, str]:
    return {k: v.status for k, v in report.techniques.items()}


def _signals(report) -> list[str]:
    return [f.signal for f in report.correctness]


# ---- pass / gate ------------------------------------------------------------

def test_passing_candidate_passes_gate(verifier):
    report = verifier.verify_candidate(ADD, ADD_TESTS)
    assert report.correctness == []
    assert _statuses(report) == {t: STATUS_PASS for t in CORRECTNESS_TECHNIQUES}
    assert report.tests_passed == 1 and report.tests_failed == 0
    assert report.complete() and report.gate_passed()
    assert report.suite == "hidden"
    assert report.advisory == []  # advisory techniques are off by default
    assert set(report.techniques) == set(CORRECTNESS_TECHNIQUES)


# ---- stage 1: no_code_output (8.6) --------------------------------------------

@pytest.mark.parametrize("text", ["", "   \n", "I could not solve this problem."])
def test_no_code_output(verifier, text):
    report = verifier.verify_candidate(text, ADD_TESTS, had_code_block=False)
    assert _signals(report) == ["no_code_output"]
    f = report.correctness[0]
    assert f.technique == "syntax" and f.severity == BLOCKING and f.category == "A.1"
    assert f.evidence.strip()
    assert _statuses(report)["syntax"] == STATUS_FAIL
    assert all(_statuses(report)[t] == STATUS_SKIPPED_UPSTREAM
               for t in ("imports", "tests", "runtime"))
    assert report.complete() and not report.gate_passed()


def test_bare_text_that_compiles_is_verified_as_code(verifier):
    report = verifier.verify_candidate(ADD, ADD_TESTS, had_code_block=False)
    assert report.gate_passed()


# ---- stage 2: syntax (8.1-8.3) ------------------------------------------------

def test_syntax_error_fails_fast(verifier):
    report = verifier.verify_candidate("def add(a, b:\n    return a + b\n", ADD_TESTS)
    assert _signals(report) == ["syntax:SyntaxError"]
    assert report.correctness[0].category == "A.1"
    assert report.correctness[0].location.file == "solution.py"
    assert _statuses(report) == {"syntax": STATUS_FAIL, "imports": STATUS_SKIPPED_UPSTREAM,
                                 "tests": STATUS_SKIPPED_UPSTREAM,
                                 "runtime": STATUS_SKIPPED_UPSTREAM}
    assert report.complete() and not report.gate_passed()


def test_indentation_error_is_a2(verifier):
    report = verifier.verify_candidate("def f():\nreturn 1\n", None)
    assert _signals(report) == ["syntax:IndentationError"]
    assert report.correctness[0].category == "A.2"


def test_star_import_in_function_caught_by_compile(verifier):
    code = "def f(xs):\n    from heapq import *\n    return nsmallest(1, xs)\n"
    report = verifier.verify_candidate(code, None)
    assert _signals(report) == ["syntax:SyntaxError"]
    assert report.correctness[0].category == "A.3"


# ---- stage 3: static imports (8.4) ----------------------------------------------

def test_module_level_missing_import_flagged(verifier):
    code = "import tivr_no_such_module_xyz\n\n" + ADD
    report = verifier.verify_candidate(code, ADD_TESTS)
    assert _signals(report) == ["import:ModuleNotFoundError"]
    f = report.correctness[0]
    assert f.category == "A.3" and f.location.line == 1
    assert "tivr_no_such_module_xyz" in f.message
    st = _statuses(report)
    assert st["imports"] == STATUS_FAIL
    assert st["tests"] == st["runtime"] == STATUS_SKIPPED_UPSTREAM


def test_import_inside_function_not_flagged_statically(verifier):
    code = ADD + "\n\ndef unused():\n    import tivr_no_such_module_xyz\n"
    report = verifier.verify_candidate(code, ADD_TESTS)
    assert report.gate_passed(), _signals(report)


def test_try_except_import_error_skipped(verifier):
    code = ("try:\n    import tivr_no_such_module_xyz as fast\n"
            "except ImportError:\n    fast = None\n\n" + ADD)
    report = verifier.verify_candidate(code, ADD_TESTS)
    assert report.gate_passed(), _signals(report)


def test_module_level_imports_walker():
    tree = ast.parse(textwrap.dedent("""
        import a
        if True:
            import b
        try:
            import c
        except ModuleNotFoundError:
            import d
        try:
            import e
        finally:
            pass
        class K:
            import f
        def g():
            import h
        if TYPE_CHECKING:
            import i
        if __name__ == "__main__":
            import j
    """))
    names = [n.names[0].name for n in module_level_imports(tree)]
    assert names == ["a", "b", "d", "e"]


# ---- stage 4: tests + runtime ---------------------------------------------------

def test_functional_failure(verifier):
    report = verifier.verify_candidate("def add(a, b):\n    return a - b\n", ADD_TESTS)
    assert _signals(report) == ["functional:logic"]
    assert report.correctness[0].category == "C.1"
    st = _statuses(report)
    assert st["tests"] == STATUS_FAIL and st["runtime"] == STATUS_PASS
    assert report.tests_passed == 0 and report.tests_failed == 1
    assert report.complete() and not report.gate_passed()


def test_runtime_type_error(verifier):
    tests = "from solution import add\n\n\ndef test_add():\n    assert add(1, 2, 3) == 6\n"
    report = verifier.verify_candidate(ADD, tests)
    assert _signals(report) == ["runtime:TypeError"]
    assert report.correctness[0].category == "B.4"
    assert _statuses(report)["runtime"] == STATUS_FAIL


def test_collection_error_for_missing_entry_point(verifier):
    tests = "from solution import mul\n\n\ndef test_mul():\n    assert mul(2, 3) == 6\n"
    report = verifier.verify_candidate(ADD, tests)
    assert _signals(report) == ["collection:ImportError:candidate"]
    assert report.correctness[0].category == "B.2"
    assert _statuses(report)["tests"] == STATUS_FAIL


def test_timeout_with_reduced_limit():
    v = ProjectVerifier(test_timeout_s=4)
    code = "def add(a, b):\n    while True:\n        pass\n"
    start = time.monotonic()
    report = v.verify_candidate(code, ADD_TESTS)
    assert time.monotonic() - start < 30
    assert _signals(report) == ["timeout"]
    f = report.correctness[0]
    assert f.technique == "tests" and f.category == "B.5"
    assert _statuses(report)["tests"] == STATUS_FAIL
    assert report.complete() and not report.gate_passed()


def test_no_test_files_runs_import_smoke(verifier):
    ok = verifier.verify_candidate(ADD, None)
    assert ok.gate_passed()
    assert _statuses(ok)["tests"] == STATUS_NO_TESTS
    assert _statuses(ok)["runtime"] == STATUS_PASS

    bad = verifier.verify_candidate(ADD + "\nVALUE = math.sqrt(4)\n", "")
    assert _signals(bad) == ["runtime:NameError:stdlib_unbound"]
    assert bad.correctness[0].category == "A.3"
    assert _statuses(bad)["tests"] == STATUS_NO_TESTS
    assert _statuses(bad)["runtime"] == STATUS_FAIL
    assert bad.tests_passed == bad.tests_failed == 0


def test_verify_project_with_package_and_default_candidates(verifier, tmp_path):
    pkg = tmp_path / "app"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("", encoding="utf-8")
    (pkg / "core.py").write_text("from app.util import double\n\n"
                                 "def quad(x):\n    return double(double(x))\n",
                                 encoding="utf-8")
    (pkg / "util.py").write_text("def double(x):\n    return 2 * x\n", encoding="utf-8")
    (tmp_path / "test_core.py").write_text(
        "from app.core import quad\n\n\ndef test_quad():\n    assert quad(1) == 4\n",
        encoding="utf-8")
    report = verifier.verify_project(tmp_path)
    assert report.suite == "project"
    assert report.gate_passed(), _signals(report)
    assert report.tests_passed == 1

    (pkg / "core.py").write_text("from app.missing import double\n", encoding="utf-8")
    report = verifier.verify_project(tmp_path)
    assert _signals(report) == ["import:ModuleNotFoundError"]
    assert "app.missing" in report.correctness[0].message


def test_harness_error_makes_report_incomplete(tmp_path):
    v = ProjectVerifier(python=str(tmp_path / "no-such-python.exe"))
    report = v.verify_candidate(ADD, ADD_TESTS)
    st = _statuses(report)
    assert st["tests"] == STATUS_ERROR and st["runtime"] == STATUS_ERROR
    assert report.correctness == []
    assert not report.complete() and not report.gate_passed()
    assert set(report.incomplete_techniques()) == {"tests", "runtime"}


# ---- stage 5: advisory (20.1, 20.8) --------------------------------------------

def test_advisory_never_affects_gate():
    v = ProjectVerifier(advisory=True, semgrep="tivr-no-such-semgrep-binary")
    report = v.verify_candidate(ADD, ADD_TESTS)
    assert report.gate_passed()
    assert {"types", "quality", "security"} <= set(report.techniques)
    assert all(f.severity == ADVISORY for f in report.advisory)
    assert all(getattr(f, "category", None) is None for f in report.advisory)
    did_not_run = [f for f in report.advisory if f.signal == "security:did_not_run"]
    assert len(did_not_run) == 1 and "did not run" in did_not_run[0].message
    assert report.techniques["security"].status == STATUS_ERROR
    assert report.complete()  # advisory errors never make verification incomplete


def test_repo_pytest_config_not_picked_up(verifier, tmp_path):
    # A project nested under a dir with a conftest that would break every test.
    outer = tmp_path / "outer"
    project = outer / "proj"
    project.mkdir(parents=True)
    (outer / "conftest.py").write_text("raise RuntimeError('outer conftest loaded')\n",
                                       encoding="utf-8")
    (outer / "pytest.ini").write_text("[pytest]\naddopts = --definitely-invalid-flag\n",
                                      encoding="utf-8")
    (project / "solution.py").write_text(ADD, encoding="utf-8")
    (project / "test_solution.py").write_text(ADD_TESTS, encoding="utf-8")
    report = verifier.verify_project(project, {"solution"})
    assert report.gate_passed(), [f.evidence for f in report.correctness]
