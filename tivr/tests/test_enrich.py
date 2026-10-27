"""Unit tests for ``tivr/enrich.py`` using hand-built plugin report dicts.

Requirements 8.4, 8.5, 8.7, 8.8, 9.6, 9.7, 9.8, 9.9, 10.1, 10.5.
"""
from __future__ import annotations

from typing import Any

import pytest

from tivr import enrich
from tivr.enrich import EnrichContext, findings_from_report
from tivr.schemas import BLOCKING, AssertionValues

SOLUTION = """\
import collections as col
from os import path as p

class BadInput(ValueError):
    pass

def f(x):
    return math.sqrt(x)
"""


@pytest.fixture
def ctx() -> EnrichContext:
    return EnrichContext({"solution"}, {"solution.py": SOLUTION})


def _exc(type_: str, message: str = "", *, module: str = "builtins",
         suite: bool = False, raised_in: str | None = "solution.py",
         longrepr: str | None = None, **extra: Any) -> dict[str, Any]:
    d = {"type": type_, "module": module, "message": message, "from_suite_assert": suite,
         "raised_in": raised_in, "longrepr": longrepr or f"E   {type_}: {message}"}
    d.update(extra)
    return d


def _test(n: int, exc: dict[str, Any] | None = None, outcome: str = "failed",
          **extra: Any) -> dict[str, Any]:
    d: dict[str, Any] = {"nodeid": f"test_solution.py::test_case[{n}]",
                         "outcome": outcome, "when": "call"}
    if exc is not None:
        d["exception"] = exc
    d.update(extra)
    return d


def _report(tests=(), collection=()) -> dict[str, Any]:
    return {"exitstatus": 1, "tests": list(tests), "collection_errors": list(collection)}


def _suite_fail(n: int, actual: str | None, expected: str | None, *, via: str = "compare"):
    exc = _exc("AssertionError", "assert x == y", suite=True, raised_in="test_solution.py")
    if via == "compare":
        return _test(n, exc, compare={"op": "==", "actual": actual, "expected": expected})
    return _test(n, exc, tivr_values={"case": n, "input": "(1,)", "actual": actual,
                                      "expected": expected})


def _signals(findings) -> list[str]:
    return [f.signal for f in findings]


# ---------------------------------------------------------------- stages ---

def test_syntax_finding_uses_exact_class_and_interpreter_report():
    with pytest.raises(SyntaxError) as info:
        compile("def f(x):\n    return (x + 1\n", "solution.py", "exec")
    f = enrich.syntax_finding(info.value, "solution.py")
    assert f.signal == "syntax:SyntaxError"
    assert f.severity == BLOCKING and f.technique == "syntax"
    assert "was never closed" in f.message
    assert "SyntaxError" in f.evidence and "solution.py" in f.evidence
    assert f.location.file == "solution.py" and f.location.line is not None


def test_syntax_finding_indentation_error():
    with pytest.raises(IndentationError) as info:
        compile("def f():\nreturn 1\n", "solution.py", "exec")
    assert enrich.syntax_finding(info.value).signal == "syntax:IndentationError"


def test_import_finding():
    f = enrich.import_finding("numpyy", "solution.py", 1, "import numpyy")
    assert f.signal == "import:ModuleNotFoundError"
    assert f.technique == "imports" and f.location.line == 1
    assert "numpyy" in f.message


def test_timeout_finding():
    f = enrich.timeout_finding(60)
    assert f.signal == "timeout" and f.severity == BLOCKING
    assert "60 s" in f.message


# --------------------------------------------------------------- runtime ---

def test_runtime_exception_named_by_exact_class(ctx):
    msg = "f() takes 1 positional argument but 2 were given"
    findings = findings_from_report(_report([_test(0, _exc(
        "TypeError", msg, longrepr="solution.py:7: in f\n    ...\nE   TypeError: " + msg))]), ctx)
    assert len(findings) == 1
    f = findings[0]
    assert f.signal == "runtime:TypeError"
    assert f.technique == "runtime" and f.exception == "TypeError"
    assert f.message == msg
    assert "TypeError: " + msg in f.evidence
    assert f.location.file == "solution.py" and f.location.line == 7
    assert f.test_id == "test_solution.py::test_case[0]"


def test_assertion_error_inside_candidate_is_runtime(ctx):
    findings = findings_from_report(_report([_test(0, _exc("AssertionError", "x must be positive"))]), ctx)
    assert _signals(findings) == ["runtime:AssertionError"]


def test_suite_assertion_is_functional_not_runtime(ctx):
    findings = findings_from_report(_report([_suite_fail(0, "4", "3")]), ctx)
    assert _signals(findings) == ["functional:logic"]
    assert findings[0].technique == "tests"


def test_llm_defined_by_module(ctx):
    exc = _exc("BadInput", "bad input: 3", module="solution")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == \
        ["runtime:BadInput:llm_defined"]


def test_llm_defined_by_class_statement_in_other_module():
    ctx = EnrichContext({"app"}, ["class Oops(KeyError):\n    pass\n"])
    exc = _exc("Oops", "k", module="some.other")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == \
        ["runtime:Oops:llm_defined"]


def test_builtin_class_is_not_llm_defined_even_if_shadowed():
    ctx = EnrichContext({"solution"}, ["class ValueError(Exception):\n    pass\n"])
    exc = _exc("ValueError", "invalid literal", module="builtins")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == ["runtime:ValueError"]


def test_stdlib_unbound_name_error(ctx):
    exc = _exc("NameError", "name 'math' is not defined. Did you forget to import 'math'?")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == \
        ["runtime:NameError:stdlib_unbound"]


def test_stdlib_member_name_error(ctx):
    exc = _exc("NameError", "name 'defaultdict' is not defined")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == \
        ["runtime:NameError:stdlib_unbound"]


@pytest.mark.parametrize("ident", ["col", "p", "not_a_stdlib_name_xyz"])
def test_name_error_bound_by_import_or_unknown_is_plain(ctx, ident):
    exc = _exc("NameError", f"name '{ident}' is not defined")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == ["runtime:NameError"]


def test_aliased_import_does_not_bind_original_name():
    ctx = EnrichContext({"solution"}, ["import math as m\n"])
    exc = _exc("NameError", "name 'math' is not defined")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == \
        ["runtime:NameError:stdlib_unbound"]


def test_unbound_local_error_has_no_qualifier(ctx):
    exc = _exc("UnboundLocalError", "cannot access local variable 'math' where it is not "
                                    "associated with a value")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == \
        ["runtime:UnboundLocalError"]


def test_grouping_and_cap(ctx):
    tests = [_test(i, _exc("ZeroDivisionError", "division by zero")) for i in range(4)]
    tests += [_test(10 + i, _exc("KeyError", f"'k{i}'")) for i in range(8)]
    findings = findings_from_report(_report(tests), ctx)
    assert len(findings) == enrich.MAX_RUNTIME_FINDINGS
    assert findings[0].signal == "runtime:ZeroDivisionError"
    assert findings[0].occurrences == 4
    assert findings[0].test_id == "test_solution.py::test_case[0]"
    assert all(f.occurrences == 1 for f in findings[1:])


def test_passed_and_skipped_tests_ignored(ctx):
    tests = [_test(0, outcome="passed"), _test(1, outcome="skipped")]
    assert findings_from_report(_report(tests), ctx) == []
    assert enrich.test_counts(_report(tests)) == (1, 0)


def test_failed_test_without_exception_uses_text(ctx):
    entry = _test(0, longrepr="E   RecursionError: maximum recursion depth exceeded")
    assert _signals(findings_from_report(_report([entry]), ctx)) == ["runtime:RecursionError"]


# ------------------------------------------------------------ collection ---

def test_collection_import_error_candidate(ctx):
    err = {"nodeid": "test_solution.py", "exception": _exc(
        "ImportError", "cannot import name 'entry' from 'solution' (/tmp/solution.py)",
        raised_in="test_solution.py", import_name="solution")}
    findings = findings_from_report(_report(collection=[err]), ctx)
    assert _signals(findings) == ["collection:ImportError:candidate"]
    assert "ImportError: cannot import name 'entry'" in findings[0].evidence
    assert enrich.test_counts(_report(collection=[err])) == (0, 1)


def test_collection_import_error_external(ctx):
    err = {"nodeid": "test_solution.py", "exception": _exc(
        "ImportError", "cannot import name 'Foo' from 'collections'", import_name="collections")}
    assert _signals(findings_from_report(_report(collection=[err]), ctx)) == \
        ["collection:ImportError:external"]


def test_import_error_target_from_message_and_submodule():
    ctx = EnrichContext({"app"}, [])
    exc = _exc("ImportError", "cannot import name 'X' from 'app.models' (app/models.py)")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == \
        ["runtime:ImportError:candidate"]


def test_import_error_without_target_has_no_qualifier(ctx):
    exc = _exc("ImportError", "attempted relative import with no known parent package")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == ["runtime:ImportError"]


def test_collection_module_not_found(ctx):
    err = {"nodeid": "test_solution.py", "exception": _exc(
        "ModuleNotFoundError", "No module named 'numpyy'", import_name="numpyy")}
    assert _signals(findings_from_report(_report(collection=[err]), ctx)) == \
        ["collection:ModuleNotFoundError"]


def test_collection_name_error_stdlib_unbound(ctx):
    err = {"nodeid": "test_solution.py", "exception": _exc("NameError", "name 'math' is not defined")}
    assert _signals(findings_from_report(_report(collection=[err]), ctx)) == \
        ["collection:NameError:stdlib_unbound"]


def test_collection_text_fallback(ctx):
    text = ("ImportError while importing test module 'test_solution.py'.\n"
            "Traceback:\n"
            "E     File \"solution.py\", line 2\n"
            "E       return (x\n"
            "E   SyntaxError: '(' was never closed\n")
    err = {"nodeid": "test_solution.py", "exception": None, "longrepr": text}
    findings = findings_from_report(_report(collection=[err]), ctx)
    assert _signals(findings) == ["collection:SyntaxError"]
    assert findings[0].message == "'(' was never closed"
    assert "SyntaxError: '(' was never closed" in findings[0].evidence


def test_collection_text_fallback_import_target(ctx):
    text = "E   ImportError: cannot import name 'entry' from 'solution' (/x/solution.py)"
    err = {"nodeid": "test_solution.py", "exception": None, "longrepr": text}
    assert _signals(findings_from_report(_report(collection=[err]), ctx)) == \
        ["collection:ImportError:candidate"]


def test_collection_unidentifiable_is_unknown(ctx):
    err = {"nodeid": "test_solution.py", "exception": None, "longrepr": "something odd happened"}
    findings = findings_from_report(_report(collection=[err]), ctx)
    assert _signals(findings) == ["collection:unknown"]
    assert findings[0].severity == BLOCKING


def test_missing_report_falls_back_to_text(ctx):
    out = "E   ModuleNotFoundError: No module named 'foo'\n1 error in 0.1s"
    assert _signals(findings_from_report(None, ctx, fallback_text=out)) == \
        ["collection:ModuleNotFoundError"]
    assert _signals(findings_from_report(None, ctx, fallback_text="")) == ["collection:unknown"]


# ------------------------------------------------------------ functional ---

def test_functional_aggregate_format(ctx):
    tests = [_suite_fail(0, "2.0", "2"), _suite_fail(1, "(1, 2)", "[2, 1]", via="tivr")]
    findings = findings_from_report(_report(tests), ctx)
    assert _signals(findings) == ["functional:format"]
    f = findings[0]
    assert f.occurrences == 2 and f.exception == "AssertionError"
    assert f.values[1] == AssertionValues(input="(1,)", actual="(1, 2)", expected="[2, 1]")


def test_functional_classified_over_all_assertions_not_just_shown(ctx):
    tests = [_suite_fail(i, "1.0", "1") for i in range(enrich.MAX_SHOWN_VALUES)]
    tests.append(_suite_fail(99, "5", "7"))
    findings = findings_from_report(_report(tests), ctx)
    assert _signals(findings) == ["functional:logic"]
    assert len(findings[0].values) == enrich.MAX_SHOWN_VALUES
    assert findings[0].occurrences == enrich.MAX_SHOWN_VALUES + 1


@pytest.mark.parametrize("actual, expected", [
    (None, "3"),                     # not captured
    ("<object at 0x1>", "3"),        # repr fallback, not parseable
    ("1" * (enrich.MAX_VALUE_CHARS + 1), "3"),  # too long
], ids=["missing", "repr", "too-long"])
def test_functional_unextractable(ctx, actual, expected):
    findings = findings_from_report(_report([_suite_fail(0, actual, expected)]), ctx)
    assert _signals(findings) == ["functional:unextractable"]


def test_functional_without_any_values_is_unextractable(ctx):
    exc = _exc("AssertionError", "assert False", suite=True, raised_in="test_solution.py")
    assert _signals(findings_from_report(_report([_test(0, exc)]), ctx)) == \
        ["functional:unextractable"]


def test_test_names_and_messages_do_not_change_class(ctx):
    a = _suite_fail(0, "2.0", "2")
    b = _suite_fail(0, "2.0", "2")
    b["nodeid"] = "test_solution.py::test_wrong_type_format_rounding"
    b["exception"]["message"] = "format mismatch: expected different type"
    assert _signals(findings_from_report(_report([a]), ctx)) == \
        _signals(findings_from_report(_report([b]), ctx)) == ["functional:format"]


def test_mixed_report_order(ctx):
    tests = [_suite_fail(0, "4", "3"), _test(1, _exc("IndexError", "list index out of range"))]
    err = {"nodeid": "test_other.py", "exception": _exc("ModuleNotFoundError", "No module named 'x'")}
    findings = findings_from_report(_report(tests, [err]), ctx)
    assert _signals(findings) == ["collection:ModuleNotFoundError", "runtime:IndexError",
                                  "functional:logic"]
