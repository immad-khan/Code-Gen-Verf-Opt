"""Unit tests for tivr.equivalence (Requirements 3.3, 3.4, 3.5, 4.2)."""

from __future__ import annotations

import ast
import collections
import enum
import math
import sys

import pytest

from tivr.equivalence import (
    SUITE_HELPER_SOURCE,
    SourceError,
    Unserializable,
    equivalent,
    from_source,
    to_source,
)

NAN = float("nan")
INF = float("inf")


def nan_aware_equal(a, b) -> bool:
    """Structural equality that treats NaN as equal to NaN and checks exact types."""
    if type(a) is not type(b):
        return False
    if isinstance(a, float):
        return (math.isnan(a) and math.isnan(b)) or (a == b and math.copysign(1, a) == math.copysign(1, b))
    if isinstance(a, complex):
        return nan_aware_equal(a.real, b.real) and nan_aware_equal(a.imag, b.imag)
    if isinstance(a, (list, tuple)):
        return len(a) == len(b) and all(nan_aware_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict):
        return list(a) == list(b) and all(nan_aware_equal(a[k], b[k]) for k in a)
    return a == b


# --- serializer ---------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        None,
        True,
        False,
        0,
        -17,
        10**5000,
        -(10**5000),
        1.5,
        -0.0,
        1e-300,
        NAN,
        INF,
        -INF,
        complex(1, -2),
        complex(NAN, INF),
        "",
        "it's \"quoted\"\n\t\u00e9\U0001f600",
        "\ud800",
        b"",
        b"\x00\xffabc",
        [],
        (),
        (1,),
        (1, "a", None),
        [1, [2, [3, (4.5, NAN)]]],
        {},
        {"b": 1, "a": [1.0, -INF], 3: (None,)},
        {(1, 2): frozenset({1})},
        set(),
        {3, 1, 2},
        {"x", "y", (1, 2)},
        frozenset(),
        frozenset({frozenset({1}), "z"}),
    ],
    ids=lambda v: type(v).__name__,
)
def test_round_trip(value):
    source = to_source(value)
    assert nan_aware_equal(from_source(source), value)


def test_special_floats_use_float_calls():
    assert to_source(NAN) == "float('nan')"
    assert to_source(INF) == "float('inf')"
    assert to_source(-INF) == "float('-inf')"
    assert to_source([NAN]) == "[float('nan')]"


def test_set_output_is_sorted_and_empty_containers_are_explicit():
    assert to_source({"b", "a", "c"}) == "{'a', 'b', 'c'}"
    assert to_source(set()) == "set()"
    assert to_source(frozenset()) == "frozenset()"
    assert to_source((1,)) == "(1,)"


def test_output_is_valid_python_expression():
    source = to_source({"k": [1, 2.5, NAN, b"x", complex(0, 1), {1}]})
    ast.parse(source, mode="eval")


class _Color(enum.IntEnum):
    RED = 1


@pytest.mark.parametrize(
    "value",
    [
        object(),
        _Color.RED,
        collections.OrderedDict(a=1),
        collections.namedtuple("P", "x y")(1, 2),
        [1, object()],
        {"k": lambda: 0},
        range(3),
        Ellipsis,
    ],
    ids=lambda v: type(v).__name__,
)
def test_unsupported_values_raise_unserializable(value):
    with pytest.raises(Unserializable):
        to_source(value)


def test_self_referencing_container_raises_unserializable():
    cyclic: list = [1]
    cyclic.append(cyclic)
    with pytest.raises(Unserializable):
        to_source(cyclic)


def test_shared_non_cyclic_references_are_allowed():
    inner = [1, 2]
    assert from_source(to_source([inner, inner])) == [[1, 2], [1, 2]]


def test_deep_nesting_raises_unserializable():
    deep: list = []
    for _ in range(sys.getrecursionlimit() * 2):
        deep = [deep]
    with pytest.raises(Unserializable):
        to_source(deep)


@pytest.mark.parametrize(
    "source",
    [
        "__import__('os')",
        "os.system('x')",
        "x",
        "lambda: 0",
        "float('1.5')",
        "float(1)",
        "set(1)",
        "set([[1]])",
        "{[1]: 2}",
        "{**{}}",
        "[*a]",
        "1 + 2",
        "complex('1+2j')",
        "...",
        "f'{1}'",
        "",
        "1; 2",
        "not a value",
        "\x00",
    ],
)
def test_from_source_rejects_non_values(source):
    with pytest.raises(SourceError):
        from_source(source)


def test_from_source_accepts_literal_eval_forms():
    assert from_source("  (1+2j) ") == complex(1, 2)
    assert from_source("-1.5") == -1.5
    assert from_source("set([1, 2])") == {1, 2}
    assert from_source("frozenset((1,))") == frozenset({1})
    assert from_source("float('+inf')") == INF


# --- equivalence: atol != 0 (Req 3.4) ------------------------------------------


@pytest.mark.parametrize(
    "actual, expected, atol, result",
    [
        (1.0005, 1.0, 1e-3, True),
        (1.002, 1.0, 1e-3, False),
        ([1.0005, (2.0, "x")], [1.0, (2.0, "x")], 1e-3, True),
        ([1.0005, (2.01, "x")], [1.0, (2.0, "x")], 1e-3, False),
        ([1.0, (2.0, "y")], [1.0, (2.0, "x")], 1e-3, False),
        ((1.0, 2.0), [1.0, 2.0], 1e-3, False),
        ([1.0], [1.0, 2.0], 1e-3, False),
        ([[1.0]], [1.0], 1e-3, False),
        (3, 3, 1e-3, True),
        (4, 3, 1e-3, False),
        ("a", "a", 0.5, True),
        ({"k": 1.0001}, {"k": 1.0}, 1e-3, False),  # dicts compare exactly
        (2, 2.0, 1e-3, True),  # exactly equal
        (2, 2.0005, 1e-3, False),  # tolerance applies to float outputs only
        (NAN, NAN, 1e-3, False),
        (INF, INF, 1e-3, True),
        (1e308, INF, 1e-3, False),
    ],
)
def test_structural_atol_rule(actual, expected, atol, result):
    assert equivalent(actual, expected, atol) is result


# --- equivalence: atol == 0, EvalPlus semantics (Req 3.5) --------------------


@pytest.mark.parametrize(
    "actual, expected, result",
    [
        (0.1 + 0.2, 0.3, True),
        (1.0 + 5e-7, 1.0, True),
        (1.0 + 2e-6, 1.0, False),
        (1e9 + 50, 1e9, True),  # relative tolerance: 1e-6 + 100
        (1e9 + 200, 1e9, False),
        ([0.1 + 0.2, 1.0], [0.3, 1.0], True),
        ((0.1 + 0.2,), (0.3,), True),
        ((0.1 + 0.2,), [0.3], False),
        ([0.3, 1.0, 2.0], [0.3, 1.0], False),
        ([1.0 + 1e-7, "a"], [1.0, "a"], False),  # mixed list: exact only
        ([[1.0 + 1e-7]], [[1.0]], False),  # nested lists: exact only
        (2, 2.0, True),
        (2, 2.0000001, False),  # type must match for tolerance
        ([1, 2], [1, 2], True),
        ([1, 2], [1, 3], False),
        ("3", 3, False),
        (True, 1, True),  # Python == semantics, as in EvalPlus
        (NAN, NAN, False),
        ([NAN], [float("nan")], False),
        (INF, INF, True),
        (-INF, INF, False),
        (1e308, INF, False),
        (None, None, True),
        ({1, 2}, {2, 1}, True),
    ],
)
def test_evalplus_rule(actual, expected, result):
    assert equivalent(actual, expected, 0) is result
    assert equivalent(actual, expected, 0.0) is result


def test_comparison_errors_count_as_not_equivalent():
    class Hostile:
        def __eq__(self, other):
            raise RuntimeError("boom")

        __hash__ = object.__hash__

    assert equivalent(Hostile(), 1, 0) is False
    assert equivalent(Hostile(), 1.0, 1e-3) is False


# --- suite helper ----------------------------------------------------------


def _exec_helper() -> dict:
    namespace: dict = {"__name__": "test_suite_module"}
    exec(compile(SUITE_HELPER_SOURCE, "test_suite.py", "exec"), namespace)
    return namespace


def test_helper_is_stdlib_only_and_namespaced():
    tree = ast.parse(SUITE_HELPER_SOURCE)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                assert alias.name.split(".")[0] in sys.stdlib_module_names
        assert not isinstance(node, ast.ImportFrom)
    for node in tree.body:
        names = []
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            names = [node.name]
        elif isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        elif isinstance(node, ast.Import):
            names = [a.asname or a.name for a in node.names]
        for name in names:
            assert name.startswith("_tivr") or name.startswith("_TIVR"), name
    assert "{" not in SUITE_HELPER_SOURCE and "}" not in SUITE_HELPER_SOURCE


_AGREEMENT_CASES = [
    (1.0005, 1.0, 1e-3),
    (1.002, 1.0, 1e-3),
    ([1.0005, (2.0, "x")], [1.0, (2.0, "x")], 1e-3),
    ((1.0, 2.0), [1.0, 2.0], 1e-3),
    (2, 2.0005, 1e-3),
    (0.1 + 0.2, 0.3, 0),
    (1e9 + 200, 1e9, 0),
    ([0.1 + 0.2, 1.0], [0.3, 1.0], 0),
    ([1.0 + 1e-7, "a"], [1.0, "a"], 0),
    (NAN, NAN, 0),
    (INF, INF, 0.0),
    ("3", 3, 0),
    ({"a": [1, 2]}, {"a": [1, 2]}, 0),
    (None, 0, 1e-6),
]


@pytest.mark.parametrize("actual, expected, atol", _AGREEMENT_CASES)
def test_inlined_helper_agrees_with_equivalent(actual, expected, atol):
    helper = _exec_helper()
    assert helper["_tivr_equivalent"](actual, expected, atol) is equivalent(actual, expected, atol)


def test_check_passes_silently_when_equivalent():
    helper = _exec_helper()
    assert helper["_tivr_check"]([0.1 + 0.2], [0.3], 0, 0, ([1, 2],)) is None


def test_check_raises_assertion_error_naming_the_input():
    helper = _exec_helper()
    args = ([3, 1, 2], "key")
    with pytest.raises(AssertionError) as info:
        helper["_tivr_check"]([1, 2], [1, 2, 3], 0, 7, args)
    error = info.value
    assert error._tivr_case == 7
    assert error._tivr_input is args
    assert error._tivr_actual == [1, 2]
    assert error._tivr_expected == [1, 2, 3]
    message = str(error)
    assert "case 7" in message
    assert repr(args) in message
    assert "expected [1, 2, 3]" in message
    assert "got [1, 2]" in message


def test_check_truncates_long_values_in_message():
    helper = _exec_helper()
    with pytest.raises(AssertionError) as info:
        helper["_tivr_check"]("a" * 5000, "b", 0, 0, ("x",))
    assert len(str(info.value)) < 2500
    assert info.value._tivr_actual == "a" * 5000


def test_helper_with_serialized_cases_runs_like_a_generated_suite():
    expected = [0.3, NAN]
    suite = (
        SUITE_HELPER_SOURCE
        + "\nATOL = 0\n"
        + f"_CASES = [({to_source((1, 2))}, {to_source(3)}), ({to_source(([0.5],))}, {to_source(expected)})]\n"
    )
    namespace: dict = {"__name__": "test_generated"}
    exec(compile(suite, "test_generated.py", "exec"), namespace)
    args, exp = namespace["_CASES"][0]
    namespace["_tivr_check"](sum(args), exp, namespace["ATOL"], 0, args)
    args, exp = namespace["_CASES"][1]
    with pytest.raises(AssertionError) as info:
        namespace["_tivr_check"]([0.1 + 0.2, NAN], exp, namespace["ATOL"], 1, args)
    assert repr(args) in str(info.value)
