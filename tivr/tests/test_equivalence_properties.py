"""Property-based tests for tivr.equivalence (Properties 26 and 27).

Property 26 (equivalence semantics) covers ``equivalent(actual, expected, atol)``;
Property 27 (serializer round trip) covers ``to_source`` / ``from_source``.
"""

from __future__ import annotations

import collections
import copy
import decimal
import enum
import fractions
import math
from typing import Any, Callable

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from tivr.equivalence import Unserializable, equivalent, from_source, to_source

_SETTINGS = settings(
    max_examples=200,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.data_too_large],
)

# ---------------------------------------------------------------------------
# Strategies for supported values
# ---------------------------------------------------------------------------

# Includes ints whose decimal form exceeds CPython's int_max_str_digits limit.
_INTS = st.one_of(
    st.integers(),
    st.builds(
        lambda sign, exponent, low: sign * (2**exponent + low),
        st.sampled_from([1, -1]),
        st.integers(14000, 20000),  # 2**14000 has ~4200 digits; the default limit is 4300
        st.integers(0, 2**64),
    ),
)
# exclude_categories=() keeps lone surrogates, which repr() must escape.
_TEXT = st.text(alphabet=st.characters(exclude_categories=()), max_size=12)


def _scalars(allow_nan: bool) -> st.SearchStrategy[Any]:
    return st.one_of(
        st.none(),
        st.booleans(),
        _INTS,
        st.floats(allow_nan=allow_nan, allow_infinity=True),
        st.complex_numbers(allow_nan=allow_nan, allow_infinity=True),
        _TEXT,
        st.binary(max_size=12),
    )


def _hashables(allow_nan: bool) -> st.SearchStrategy[Any]:
    return st.recursive(
        _scalars(allow_nan),
        lambda inner: st.one_of(
            st.lists(inner, max_size=3).map(tuple),
            st.frozensets(inner, max_size=3),
        ),
        max_leaves=6,
    )


def _values(allow_nan: bool) -> st.SearchStrategy[Any]:
    hashables = _hashables(allow_nan)
    return st.recursive(
        _scalars(allow_nan),
        lambda inner: st.one_of(
            st.lists(inner, max_size=4),
            st.lists(inner, max_size=4).map(tuple),
            st.dictionaries(hashables, inner, max_size=4),
            st.sets(hashables, max_size=4),
            st.frozensets(hashables, max_size=4),
        ),
        max_leaves=16,
    )


SUPPORTED = _values(allow_nan=True)
SUPPORTED_NO_NAN = _values(allow_nan=False)


def _float_free_values() -> st.SearchStrategy[Any]:
    scalars = st.one_of(
        st.none(),
        st.booleans(),
        st.integers(-3, 3),
        st.text(alphabet="ab", max_size=2),
        st.binary(max_size=2),
        st.complex_numbers(allow_nan=False, allow_infinity=False, max_magnitude=4),
    )
    hashables = st.recursive(scalars, lambda c: st.lists(c, max_size=2).map(tuple), max_leaves=4)
    return st.recursive(
        scalars,
        lambda inner: st.one_of(
            st.lists(inner, max_size=3),
            st.lists(inner, max_size=3).map(tuple),
            st.dictionaries(hashables, inner, max_size=3),
            st.sets(hashables, max_size=3),
        ),
        max_leaves=8,
    )


FLOAT_FREE = _float_free_values()


def nan_aware_equal(a: Any, b: Any) -> bool:
    """Exact-type structural equality where NaN equals NaN and -0.0 differs from 0.0."""
    if type(a) is not type(b):
        return False
    if isinstance(a, float):
        if math.isnan(a) or math.isnan(b):
            return math.isnan(a) and math.isnan(b)
        return a == b and math.copysign(1.0, a) == math.copysign(1.0, b)
    if isinstance(a, complex):
        return nan_aware_equal(a.real, b.real) and nan_aware_equal(a.imag, b.imag)
    if isinstance(a, (list, tuple)):
        return len(a) == len(b) and all(nan_aware_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict):
        return len(a) == len(b) and all(
            nan_aware_equal(ka, kb) and nan_aware_equal(va, vb)
            for (ka, va), (kb, vb) in zip(a.items(), b.items())
        )
    if isinstance(a, (set, frozenset)):
        # nan_aware_equal is an equivalence relation, so greedy matching is exact.
        remaining = list(b)
        if len(remaining) != len(a):
            return False
        for item in a:
            for index, candidate in enumerate(remaining):
                if nan_aware_equal(item, candidate):
                    del remaining[index]
                    break
            else:
                return False
        return not remaining
    return a == b


# ---------------------------------------------------------------------------
# Strategies for unsupported values
# ---------------------------------------------------------------------------


class _Color(enum.Enum):
    RED = 1


class _IntSub(int):
    pass


class _FloatSub(float):
    pass


class _StrSub(str):
    pass


_Point = collections.namedtuple("_Point", "x y")

_HASHABLE_UNSUPPORTED = st.one_of(
    st.builds(object),
    st.just(_Color.RED),
    st.integers().map(_IntSub),
    st.floats(allow_nan=False).map(_FloatSub),
    st.text(max_size=4).map(_StrSub),
    st.integers(0, 5).map(range),
    st.just(Ellipsis),
    st.just(len),
    st.tuples(st.integers(), st.integers()).map(lambda xy: _Point(*xy)),
    st.decimals(allow_nan=False, allow_infinity=False).map(decimal.Decimal),
    st.fractions().map(fractions.Fraction),
)
_UNSUPPORTED_LEAVES = st.one_of(
    _HASHABLE_UNSUPPORTED,
    st.binary(max_size=4).map(bytearray),
    st.builds(collections.OrderedDict),
    st.builds(lambda: (lambda: 0)),
)
_SMALL_SUPPORTED = st.lists(_values(allow_nan=True), max_size=2)
_SMALL_HASHABLE = _hashables(allow_nan=False)

# Every generated value contains exactly one unsupported object somewhere.
CONTAINS_UNSUPPORTED = st.recursive(
    st.one_of(
        _UNSUPPORTED_LEAVES,
        st.tuples(_HASHABLE_UNSUPPORTED, _values(allow_nan=True)).map(lambda kv: {kv[0]: kv[1]}),
        _HASHABLE_UNSUPPORTED.map(lambda x: {x}),
        _HASHABLE_UNSUPPORTED.map(lambda x: frozenset({x})),
    ),
    lambda inner: st.one_of(
        st.tuples(_SMALL_SUPPORTED, inner, _SMALL_SUPPORTED).map(lambda t: [*t[0], t[1], *t[2]]),
        st.tuples(_SMALL_SUPPORTED, inner, _SMALL_SUPPORTED).map(lambda t: (*t[0], t[1], *t[2])),
        st.tuples(_SMALL_HASHABLE, inner).map(lambda kv: {kv[0]: kv[1]}),
    ),
    max_leaves=4,
)


# ---------------------------------------------------------------------------
# Property 27: Serializer round trip
# ---------------------------------------------------------------------------


@_SETTINGS
@given(value=SUPPORTED)
def test_property_27_round_trip(value: Any) -> None:
    """Property 27: Serializer round trip (supported values, incl. NaN and ±inf).

    **Validates: Requirements 3.1, 3.3**
    """
    source = to_source(value)
    assert isinstance(source, str)
    assert nan_aware_equal(from_source(source), value)


@_SETTINGS
@given(value=CONTAINS_UNSUPPORTED)
def test_property_27_unsupported_values_raise(value: Any) -> None:
    """Property 27: Serializer round trip (unsupported values raise Unserializable).

    **Validates: Requirements 3.1, 3.3**
    """
    try:
        to_source(value)
    except Unserializable:
        return
    raise AssertionError(f"to_source accepted an unsupported value: {value!r}")


@_SETTINGS
@given(prefix=st.lists(SUPPORTED, max_size=3), wrap=st.integers(0, 3))
def test_property_27_self_reference_raises(prefix: list, wrap: int) -> None:
    """Property 27: Serializer round trip (self-referencing containers are unsupported).

    **Validates: Requirements 3.1, 3.3**
    """
    cyclic = list(prefix)
    holder: Any = cyclic
    for _ in range(wrap):
        holder = (holder,)
    cyclic.append(holder)
    try:
        to_source(cyclic)
    except Unserializable:
        return
    raise AssertionError("to_source accepted a self-referencing list")


# ---------------------------------------------------------------------------
# Property 26: Equivalence semantics
# ---------------------------------------------------------------------------

# Floats on a 2**-10 grid with bounded magnitude: e + δ and (e + δ) - e are
# exact, so the expected verdict for atol > 0 can be computed from integers.
_GRID = 1024.0
_GRID_FLOATS = st.integers(-(2**30), 2**30).map(lambda k: k / _GRID)

FLOAT_STRUCTURES = st.recursive(
    st.one_of(_GRID_FLOATS, _GRID_FLOATS, st.integers(-5, 5), st.text(alphabet="xy", max_size=2), st.none()),
    lambda inner: st.one_of(st.lists(inner, max_size=4), st.lists(inner, max_size=4).map(tuple)),
    max_leaves=12,
)

_POSITIVE_ATOL = st.one_of(st.floats(min_value=1e-12, max_value=10.0), st.integers(1, 3))


def _perturb(value: Any, delta: Callable[[float], float]) -> Any:
    """Copy ``value`` with every float ``e`` replaced by ``e + delta(e)``."""
    if type(value) is float:
        return value + delta(value)
    if type(value) in (list, tuple):
        return type(value)(_perturb(item, delta) for item in value)
    return value


def _paths(value: Any, prefix: tuple[int, ...] = ()) -> list[tuple[int, ...]]:
    found = [prefix]
    if type(value) in (list, tuple):
        for index, item in enumerate(value):
            found.extend(_paths(item, prefix + (index,)))
    return found


def _replace(value: Any, path: tuple[int, ...], edit: Callable[[Any], Any]) -> Any:
    if not path:
        return edit(value)
    items = list(value)
    items[path[0]] = _replace(items[path[0]], path[1:], edit)
    return type(value)(items)


def _is_flat_floats(value: Any) -> bool:
    if type(value) is float:
        return True
    return type(value) in (list, tuple) and len(value) > 0 and all(type(x) is float for x in value)


@_SETTINGS
@given(value=SUPPORTED_NO_NAN, atol=st.one_of(st.just(0), st.just(0.0), _POSITIVE_ATOL))
def test_property_26_reflexive_without_nan(value: Any, atol: float) -> None:
    """Property 26: Equivalence semantics (v is equivalent to itself without NaN).

    **Validates: Requirements 3.4, 3.5, 4.2**
    """
    assert equivalent(value, value, atol) is True
    assert equivalent(copy.deepcopy(value), value, atol) is True


@_SETTINGS
@given(expected=FLOAT_STRUCTURES, m=st.integers(1, 4096), data=st.data())
def test_property_26_positive_atol_iff_every_delta_within(expected: Any, m: int, data: st.DataObject) -> None:
    """Property 26: Equivalence semantics (atol > 0: equivalent iff every |δ| ≤ atol).

    **Validates: Requirements 3.4, 3.5, 4.2**
    """
    atol = m / _GRID
    steps: list[int] = []
    step_strategy = st.one_of(st.sampled_from([0, m, -m, m + 1, -(m + 1)]), st.integers(-2 * m, 2 * m))

    def delta(_: float) -> float:
        step = data.draw(step_strategy)
        steps.append(step)
        return step / _GRID

    actual = _perturb(expected, delta)
    assert equivalent(actual, expected, atol) is all(abs(step) <= m for step in steps)


@_SETTINGS
@given(expected=FLOAT_STRUCTURES, m=st.integers(1, 4096), data=st.data())
def test_property_26_positive_atol_rejects_structure_change(
    expected: Any, m: int, data: st.DataObject
) -> None:
    """Property 26: Equivalence semantics (atol > 0: a changed structure is never equivalent).

    **Validates: Requirements 3.4, 3.5, 4.2**
    """
    atol = m / _GRID
    # Floats stay within tolerance, so only the structural edit can break equivalence.
    near = _perturb(expected, lambda _: data.draw(st.integers(-m, m)) / _GRID)
    path = data.draw(st.sampled_from(_paths(near)))

    def edit(node: Any) -> Any:
        ops = ["wrap"]
        if type(node) in (list, tuple):
            ops += ["swap_kind", "append"] + (["drop"] if node else [])
        op = data.draw(st.sampled_from(ops))
        if op == "wrap":
            return [node]
        if op == "swap_kind":
            return tuple(node) if type(node) is list else list(node)
        if op == "append":
            return type(node)([*node, data.draw(_GRID_FLOATS)])
        index = data.draw(st.integers(0, len(node) - 1))
        return type(node)([*node[:index], *node[index + 1 :]])

    actual = _replace(near, path, edit)
    assert equivalent(actual, expected, atol) is False


_MODERATE_FLOATS = st.floats(min_value=-1e12, max_value=1e12, allow_nan=False)


def _evalplus_close(actual: float, expected: float) -> bool:
    return actual == expected or abs(actual - expected) <= 1e-6 + 1e-7 * abs(expected)


def _near(expected: float) -> st.SearchStrategy[float]:
    return st.one_of(
        st.just(expected),
        st.floats(-5e-6, 5e-6).map(lambda d: expected + d),
        st.floats(-5e-7, 5e-7).map(lambda r: expected * (1.0 + r)),
        _MODERATE_FLOATS,
    )


@_SETTINGS
@given(expected=_MODERATE_FLOATS, data=st.data())
def test_property_26_zero_atol_float_tolerance(expected: float, data: st.DataObject) -> None:
    """Property 26: Equivalence semantics (atol = 0: floats use 1e-6 abs + 1e-7 rel tolerance).

    **Validates: Requirements 3.4, 3.5, 4.2**
    """
    actual = data.draw(_near(expected))
    assert equivalent(actual, expected, 0) is _evalplus_close(actual, expected)
    assert equivalent(actual, expected, 0.0) is _evalplus_close(actual, expected)


@_SETTINGS
@given(
    expected=st.lists(_MODERATE_FLOATS, min_size=1, max_size=6),
    as_tuple=st.booleans(),
    data=st.data(),
)
def test_property_26_zero_atol_float_sequence_tolerance(
    expected: list[float], as_tuple: bool, data: st.DataObject
) -> None:
    """Property 26: Equivalence semantics (atol = 0: flat float sequences compare element-wise).

    **Validates: Requirements 3.4, 3.5, 4.2**
    """
    actual_items = [data.draw(_near(e)) for e in expected]
    kind = tuple if as_tuple else list
    actual, expected_value = kind(actual_items), kind(expected)
    verdict = all(_evalplus_close(a, e) for a, e in zip(actual_items, expected))
    assert equivalent(actual, expected_value, 0) is verdict


@_SETTINGS
@given(expected=FLOAT_STRUCTURES.filter(lambda v: not _is_flat_floats(v)), data=st.data())
def test_property_26_zero_atol_other_structures_exact(expected: Any, data: st.DataObject) -> None:
    """Property 26: Equivalence semantics (atol = 0: non-float outputs use exact equality).

    Deltas are far below the EvalPlus tolerance, so any acceptance of a
    non-identical nested/mixed structure would show up here.

    **Validates: Requirements 3.4, 3.5, 4.2**
    """
    actual = _perturb(expected, lambda _: data.draw(st.integers(-3, 3)) * 2.0**-24)
    assert equivalent(actual, expected, 0) is (actual == expected)


@_SETTINGS
@given(
    expected=FLOAT_FREE,
    data=st.data(),
    atol=st.one_of(st.just(0), st.just(0.0), _POSITIVE_ATOL),
)
def test_property_26_float_free_values_exact(expected: Any, data: st.DataObject, atol: float) -> None:
    """Property 26: Equivalence semantics (values without floats compare by exact equality).

    **Validates: Requirements 3.4, 3.5, 4.2**
    """
    actual = data.draw(st.one_of(st.just(copy.deepcopy(expected)), FLOAT_FREE))
    assert equivalent(actual, expected, atol) is (actual == expected)
