"""Property-based tests for tivr.normalize.classify_functional.

Property 6: Functional classification follows values only.
**Validates: Requirements 10.2, 10.3, 10.4, 10.5, 10.6, 18.5**

Generators build pairs whose expected classification is known by
construction (independently of the implementation):

* normalization pairs: a generated value and a recursively transformed
  variant (int<->float, number<->numeric str, list<->tuple, reordering),
  never touching bools;
* rounding pairs: a less precise number ``L`` and a more precise ``M`` that
  rounds (ROUND_HALF_UP) to ``L`` at ``L``'s decimal places;
* logic pairs: values that are unequal under every normalization and are
  not rounding-equal;
* missing pairs: ``None`` / ``MISSING`` / absent key / absent attribute.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from types import SimpleNamespace
from typing import Any

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from tivr.normalize import (
    FORMAT,
    LOGIC,
    MISSING,
    UNEXTRACTABLE,
    classify_functional,
    equal_after_normalization,
    rounding_equal,
)

SETTINGS = settings(max_examples=200, deadline=None)

# ------------------------------------------------------------ base values ---

_ints = st.integers(min_value=-(10**12), max_value=10**12)
_floats = st.floats(allow_nan=False, allow_infinity=False, width=64)
_scalars = st.one_of(st.booleans(), _ints, _floats, st.text(max_size=8))
_values = st.recursive(
    _scalars,
    lambda children: st.one_of(
        st.lists(children, max_size=4),
        st.lists(children, max_size=4).map(tuple),
    ),
    max_leaves=12,
)


@st.composite
def _variant(draw: st.DrawFn, v: Any) -> Any:
    """A value equal to ``v`` after type normalization (Requirement 10.2)."""
    if isinstance(v, bool):
        return v  # bool is never normalized
    if isinstance(v, int):
        options = [v, str(v)]
        if abs(v) <= 2**53:
            options.append(float(v))
        return draw(st.sampled_from(options))
    if isinstance(v, float):
        options: list[Any] = [v, repr(v)]
        if v.is_integer() and abs(v) <= 2**53:
            options.append(int(v))
        return draw(st.sampled_from(options))
    if isinstance(v, (list, tuple)):
        items = [draw(_variant(x)) for x in v]
        items = draw(st.permutations(items)) if items else items
        container = draw(st.sampled_from([list, tuple]))
        return container(items)
    return v  # str: compared with ==


@st.composite
def normalization_pairs(draw: st.DrawFn) -> tuple[Any, Any]:
    v = draw(_values)
    w = draw(_variant(v))
    return (v, w) if draw(st.booleans()) else (w, v)


@st.composite
def _nonzero_last_digit(draw: st.DrawFn, head_bound: int, max_last: int = 9) -> int:
    """A signed integer whose last decimal digit is in 1..max_last."""
    head = draw(st.integers(min_value=0, max_value=head_bound))
    n = head * 10 + draw(st.integers(min_value=1, max_value=max_last))
    return -n if draw(st.booleans()) else n


@st.composite
def rounding_pairs(draw: st.DrawFn) -> tuple[Any, Any]:
    """(more precise, less precise) numbers, randomly ordered (Requirement 10.3)."""
    p = draw(st.integers(min_value=0, max_value=6))
    q = draw(st.integers(min_value=p + 1, max_value=p + 6))
    if p == 0:
        less_d = Decimal(draw(st.integers(min_value=-(10**6), max_value=10**6)))
    else:
        less_d = Decimal(draw(_nonzero_last_digit(10**6))).scaleb(-p)
    d = draw(_nonzero_last_digit(10 ** (q - p - 1) // 2, max_last=5))
    more_d = less_d + Decimal(d).scaleb(-q)
    # Spec definition: rounding M to L's places gives L.
    assume(more_d.quantize(Decimal(1).scaleb(-p), rounding=ROUND_HALF_UP) == less_d)

    more = float(str(more_d))
    less: Any = int(less_d) if p == 0 else float(str(less_d))
    # The values as written (repr) carry exactly q and p decimal places.
    assume(Decimal(repr(more)) == more_d and Decimal(repr(more)).as_tuple().exponent == -q)
    if p > 0:
        assume(Decimal(repr(less)).as_tuple().exponent == -p)
    return (more, less) if draw(st.booleans()) else (less, more)


format_pairs = st.one_of(normalization_pairs(), rounding_pairs())

_non_numeric_text = st.text(alphabet="abcdefghijklmnopqrstuvwxyz _-", min_size=1, max_size=8).filter(
    lambda s: _unparseable(s)
)


def _unparseable(s: str) -> bool:
    try:
        float(s)
    except ValueError:
        return True
    return False


@st.composite
def logic_pairs(draw: st.DrawFn) -> tuple[Any, Any]:
    """Pairs that are neither equal after normalization nor rounding-equal."""
    kind = draw(st.sampled_from(["ints", "bool_vs_number", "text_vs_number", "length", "nested"]))
    if kind == "ints":
        a = draw(_ints)
        b = draw(_ints.filter(lambda n: n != a))
        pair: tuple[Any, Any] = (a, b)
    elif kind == "bool_vs_number":
        b = draw(st.booleans())
        n = draw(st.sampled_from([int(b), float(b), str(int(b))]))
        pair = (b, n)
    elif kind == "text_vs_number":
        pair = (draw(_non_numeric_text), draw(st.one_of(_ints, _floats)))
    elif kind == "length":
        xs = draw(st.lists(_ints, max_size=4))
        extra = draw(_ints)
        pair = (xs, xs + [extra])
    else:  # a container holding one unequal element
        xs = draw(st.lists(_ints, max_size=3))
        a = draw(_ints)
        b = draw(st.integers(min_value=10**13, max_value=10**14))  # outside _ints: never equal
        pair = (xs + [a], tuple(xs + [b]))
    return pair if draw(st.booleans()) else (pair[1], pair[0])


@st.composite
def missing_items(draw: st.DrawFn) -> Any:
    """An assertion whose actual or expected value cannot be extracted (10.6)."""
    present = draw(_values)
    absent = draw(st.sampled_from([None, MISSING]))
    side = draw(st.sampled_from(["actual", "expected"]))
    form = draw(st.sampled_from(["pair", "dict_none", "dict_absent", "obj_none", "obj_absent"]))
    a, e = (absent, present) if side == "actual" else (present, absent)
    if form == "pair":
        return (a, e)
    if form == "dict_none":
        return {"actual": a, "expected": e}
    if form == "dict_absent":
        return {"expected": e} if side == "actual" else {"actual": a}
    if form == "obj_none":
        return SimpleNamespace(actual=a, expected=e)
    return SimpleNamespace(expected=e) if side == "actual" else SimpleNamespace(actual=a)


# ------------------------------------------------------- value-free text ---

_text = st.text(max_size=20)


@st.composite
def _encode(draw: st.DrawFn, pair: tuple[Any, Any], name: str, message: str) -> Any:
    """Wrap a pair as a tuple, list, dict, or object with value-free text."""
    a, e = pair
    form = draw(st.sampled_from(["tuple", "list", "dict", "obj"]))
    if form == "tuple":
        return (a, e)
    if form == "list":
        return [a, e]
    if form == "dict":
        return {"actual": a, "expected": e, "test_name": name, "message": message}
    return SimpleNamespace(actual=a, expected=e, test_name=name, nodeid=f"test_x.py::{name}", message=message)


@st.composite
def encoded(draw: st.DrawFn, pairs: list[tuple[Any, Any]]) -> list[Any]:
    return [draw(_encode(p, draw(_text), draw(_text))) for p in pairs]


# --------------------------------------------------------------- properties ---

@SETTINGS
@given(pairs=st.lists(format_pairs, min_size=1, max_size=5), data=st.data())
def test_all_format_pairs_classify_as_format(pairs, data):
    """10.2/10.3: every pair normalizes equal or rounds equal -> C.3 (format)."""
    for a, e in pairs:
        assert equal_after_normalization(a, e) or rounding_equal(a, e), (a, e)
    assert classify_functional(pairs) == FORMAT
    assert classify_functional(data.draw(encoded(pairs))) == FORMAT


@SETTINGS
@given(
    good=st.lists(format_pairs, max_size=4),
    bad=st.lists(logic_pairs(), min_size=1, max_size=3),
    data=st.data(),
)
def test_any_non_format_pair_classifies_as_logic(good, bad, data):
    """10.4: one or more non-matching pairs (including partial matches) -> C.1 (logic)."""
    for a, e in bad:
        assert not equal_after_normalization(a, e), (a, e)
        assert not rounding_equal(a, e), (a, e)
    pairs = data.draw(st.permutations(good + bad))
    assert classify_functional(pairs) == LOGIC
    assert classify_functional(data.draw(encoded(pairs))) == LOGIC


@SETTINGS
@given(
    others=st.lists(st.one_of(format_pairs, logic_pairs()), max_size=4),
    missing=st.lists(missing_items(), min_size=1, max_size=2),
    data=st.data(),
)
def test_any_missing_value_classifies_as_unextractable(others, missing, data):
    """10.6: a value that cannot be extracted -> C.1 (unextractable), never C.3."""
    items = data.draw(st.permutations(data.draw(encoded(others)) + missing))
    result = classify_functional(items)
    assert result == UNEXTRACTABLE
    assert result != FORMAT


@SETTINGS
@given(
    pairs=st.lists(st.one_of(format_pairs, logic_pairs()), min_size=1, max_size=5),
    data=st.data(),
)
def test_names_and_value_free_text_do_not_change_category(pairs, data):
    """10.5: test names and value-free message text never change the category."""
    baseline = classify_functional(pairs)
    first = data.draw(encoded(pairs))
    second = data.draw(encoded(pairs))
    assert classify_functional(first) == baseline
    assert classify_functional(second) == baseline


@SETTINGS
@given(b=st.booleans(), rest=st.lists(format_pairs, max_size=3), data=st.data())
def test_bool_is_never_normalized_to_a_number(b, rest, data):
    """10.2: bool vs a numerically equal int/float/str is not a format match."""
    n = data.draw(st.sampled_from([int(b), float(b), str(int(b))]))
    pair = data.draw(st.sampled_from([(b, n), (n, b)]))
    assert not equal_after_normalization(*pair)
    assert classify_functional(rest + [pair]) == LOGIC
