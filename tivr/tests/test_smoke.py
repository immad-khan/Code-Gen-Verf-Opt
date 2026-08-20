"""
test_smoke.py — Verifier smoke tests covering each Dou et al. taxonomy bug category.
"""
from __future__ import annotations
import json
import pytest
from tivr.verifier import Verifier
from tivr.schemas import VerificationReport


@pytest.fixture
def verifier():
    return Verifier()


def test_a1_unclosed_parenthesis(verifier):
    """A.1: Incomplete syntax structure (unclosed bracket/parenthesis)."""
    code = "def solve(x):\n    return (x + 1"
    report = verifier.run(code, visible_tests=None)
    assert report.verdict == "FAIL"
    assert len(report.diagnoses) > 0
    assert report.diagnoses[0].taxonomy_id == "A.1"
    assert report.diagnoses[0].primary == "Type A: Syntax Bug"
    assert report.diagnoses[0].secondary == "A.1 Incomplete syntax structure"


def test_a2_incorrect_indentation(verifier):
    """A.2: Incorrect indentation (IndentationError)."""
    code = "def solve(x):\n  return x\n print(x)"
    report = verifier.run(code, visible_tests=None)
    assert report.verdict == "FAIL"
    assert len(report.diagnoses) > 0
    assert report.diagnoses[0].taxonomy_id == "A.2"
    assert report.diagnoses[0].secondary == "A.2 Incorrect indentation"


def test_a3_star_import_in_function(verifier):
    """A.3: Library import error (star import inside function scope or missing module)."""
    code = "def solve(x):\n    import non_existent_fake_package_xyz\n    return x"
    report = verifier.run(code, visible_tests=None)
    assert report.verdict == "FAIL"
    assert len(report.diagnoses) > 0
    assert report.diagnoses[0].taxonomy_id == "A.3"
    assert report.diagnoses[0].secondary == "A.3 Library import error"



def test_b1_attribute_error(verifier):
    """B.1: API misuse (calling .sort() on a tuple)."""
    code = "def solve(tup):\n    tup.sort()\n    return tup"
    tests = "def test_solve():\n    solve((3, 1, 2))"
    report = verifier.run(code, visible_tests=tests)
    assert report.verdict == "FAIL"
    assert any(d.taxonomy_id == "B.1" for d in report.diagnoses)


def test_b2_undefined_name(verifier):
    """B.2: Definition missing (NameError for undefined MOD)."""
    code = "def solve(n):\n    return n % MOD"
    tests = "def test_solve():\n    solve(10)"
    report = verifier.run(code, visible_tests=tests)
    assert report.verdict == "FAIL"
    assert any(d.taxonomy_id == "B.2" for d in report.diagnoses)


def test_b3_zero_division(verifier):
    """B.3: Incorrect boundary condition check (ZeroDivisionError)."""
    code = "def solve(n, length):\n    return n % length"
    tests = "def test_solve():\n    solve(10, 0)"
    report = verifier.run(code, visible_tests=tests)
    assert report.verdict == "FAIL"
    assert any(d.taxonomy_id == "B.3" for d in report.diagnoses)


def test_b4_incorrect_argument_count(verifier):
    """B.4 / B.1: Incorrect arguments passed to helper or built-in function."""
    code = "def solve(a, b):\n    return int(a, b, 10)"
    tests = "def test_solve():\n    solve('10', 2)"
    report = verifier.run(code, visible_tests=tests)
    assert report.verdict == "FAIL"
    assert any(d.taxonomy_id in ("B.1", "B.4") for d in report.diagnoses)


def test_c1_logic_error_paper_example(verifier):
    """C.1: Misunderstanding and logic error (paper example: str concat vs int addition)."""
    code = "def add_elements(a, b):\n    return str(a) + str(b)"
    tests = "def test_add():\n    assert add_elements(2, 3) == 5"
    report = verifier.run(code, visible_tests=tests)
    assert report.verdict == "FAIL"
    assert any(d.taxonomy_id in ("C.1", "C.3") for d in report.diagnoses)


def test_verification_report_json_format(verifier):
    """P1-7: Verify report JSON serialization matches canonical schema requirements."""
    code = "def solve():\n    return 1 + 2"
    report = verifier.run(code, visible_tests="def test_s(): assert solve() == 3")
    assert report.verdict == "PASS"
    raw_json = report.to_json()
    parsed = json.loads(raw_json)
    assert "verdict" in parsed
    assert "iteration" in parsed
    assert "findings" in parsed
    assert "diagnoses" in parsed
    assert "repair_priority" in parsed
    assert "metrics" in parsed
    assert "timing" in parsed
