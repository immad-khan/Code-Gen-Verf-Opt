"""Unit tests for tivr.normalize (Requirement 10.2-10.6)."""
from dataclasses import dataclass
from typing import Any

import pytest

from tivr.normalize import (
    MISSING,
    classify_functional,
    equal_after_normalization,
    rounding_equal,
)


# ------------------------------------------------- equal_after_normalization

@pytest.mark.parametrize(
    "a, e",
    [
        (1, 1.0),
        (1.0, 1),
        ("3", 3),
        (3, "3"),
        ("2.5", 2.5),
        ("1e3", 1000),
        ([1, 2], (1, 2)),
        ((1, 2), [1.0, "2"]),
        ([3, 1, 2], [1, 2, 3]),
        ([[2, 1], (3,)], ([3.0], (1, 2))),  # recursive reorder + type normalization
        ([1, 1, 2], [2, 1, 1]),
        ([], ()),
        (True, True),
        ("abc", "abc"),
        ({"a": 1}, {"a": 1}),
    ],
)
def test_equal_after_normalization_true(a, e):
    assert equal_after_normalization(a, e)


@pytest.mark.parametrize(
    "a, e",
    [
        (True, 1),
        (1, True),
        (False, 0.0),
        ("True", True),
        ([True], [1]),
        ("abc", 3),
        ("1", "1.0"),  # str vs str is not numerically normalized
        ([1, 2], [1, 2, 3]),
        ([1, 1, 2], [1, 2, 2]),  # multisets differ
        (1, 2),
        (None, 0),
        (float("nan"), float("nan")),
    ],
)
def test_equal_after_normalization_false(a, e):
    assert not equal_after_normalization(a, e)


def test_matching_needs_augmenting_paths():
    # "1" ~ 1 and "1" ~ "1"; "1.0" ~ 1 only. Element-wise fails ("1.0" vs "1"),
    # and first-fit puts "1" on 1, so the matching must reassign "1" -> "1".
    a = ["1", "1.0"]
    e = [1, "1"]
    assert equal_after_normalization(a, e)


def test_deep_nesting_does_not_raise():
    a: Any = []
    e: Any = []
    for _ in range(3000):
        a, e = [a], [e]
    assert equal_after_normalization(a, e) in (True, False)


# ------------------------------------------------------------ rounding_equal

@pytest.mark.parametrize(
    "a, e",
    [
        (3.14159, 3.14),
        (3.14, 3.14159),
        (0.30000000000000004, 0.3),
        (2.675, 2.68),  # ROUND_HALF_UP on repr, not binary float rounding
        (2.5, 3),
        (-2.5, -3),
        (1.0000001, 1.0),
        (10, 10.4),
    ],
)
def test_rounding_equal_true(a, e):
    assert rounding_equal(a, e)


@pytest.mark.parametrize(
    "a, e",
    [
        (3.14, 3.14),  # exactly equal
        (3.15, 3.14),  # same precision
        (3.146, 3.14),
        (True, 1.0),
        ("3.14", 3.14159),
        (float("inf"), 1.0),
        (float("nan"), 1.0),
    ],
)
def test_rounding_equal_false(a, e):
    assert not rounding_equal(a, e)


def test_rounding_beyond_15_places_rejected():
    # repr(1e-16) == '1e-16': the less precise value has 16 places -> outside 0..15
    assert not rounding_equal(1.4e-16, 1e-16)
    # within range the same shape is accepted
    assert rounding_equal(1.4e-15, 1e-15)


# -------------------------------------------------------- classify_functional

@dataclass
class _AV:
    actual: Any = MISSING
    expected: Any = MISSING
    test_name: str = ""
    message: str = ""


def test_classify_format_type_normalization():
    assert classify_functional([(1, 1.0), ([1, 2], (1, 2))]) == "format"


def test_classify_format_reordering():
    assert classify_functional([{"actual": [3, 2, 1], "expected": [1, 2, 3]}]) == "format"


def test_classify_format_rounding():
    assert classify_functional([_AV(actual=3.14159, expected=3.14)]) == "format"


def test_classify_logic_when_only_some_match():
    assert classify_functional([(1, 1.0), (1, 2)]) == "logic"


def test_classify_logic_bool_vs_int():
    assert classify_functional([(True, 1)]) == "logic"


@pytest.mark.parametrize(
    "items",
    [
        [],
        [(None, 1)],
        [(1, None)],
        [{"actual": 1}],
        [_AV(actual=1)],
        [(1, 1.0), (MISSING, 2)],
        [(1, 2), (None, 2)],  # missing wins over logic
    ],
)
def test_classify_unextractable(items):
    assert classify_functional(items) == "unextractable"


def test_classify_ignores_names_and_messages():
    base = [_AV(actual=1, expected=1.0)]
    renamed = [_AV(actual=1, expected=1.0, test_name="test_rounding_format",
                   message="logic error in sort")]
    assert classify_functional(base) == classify_functional(renamed) == "format"


def test_classify_accepts_generator():
    assert classify_functional(((a, float(a)) for a in range(3))) == "format"
