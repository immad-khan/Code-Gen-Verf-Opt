"""Functional-failure classification from assertion values (Requirement 10).

``classify_functional`` decides between C.3 (``format``) and C.1 (``logic`` /
``unextractable``) using only the actual/expected values of the failing
assertions. Test names and assertion message text are never inputs (10.5).

The module is intentionally independent of ``tivr.schemas``: an assertion may
be an object with ``actual``/``expected`` attributes (e.g. ``AssertionValues``),
a mapping with ``"actual"``/``"expected"`` keys, or an ``(actual, expected)``
pair. A value of ``None``, a missing attribute/key, or the ``MISSING`` sentinel
means the value could not be extracted from the evidence (10.6).
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from decimal import ROUND_HALF_UP, Context, Decimal, InvalidOperation
import math
from typing import Any

__all__ = [
    "MISSING",
    "FORMAT",
    "LOGIC",
    "UNEXTRACTABLE",
    "classify_functional",
    "equal_after_normalization",
    "rounding_equal",
]

FORMAT = "format"
LOGIC = "logic"
UNEXTRACTABLE = "unextractable"

MAX_ROUNDING_PLACES = 15


class _Missing:
    """Sentinel for a value that could not be taken from the evidence."""

    _instance: "_Missing | None" = None

    def __new__(cls) -> "_Missing":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __repr__(self) -> str:
        return "MISSING"

    def __bool__(self) -> bool:
        return False


MISSING: Any = _Missing()


# ---------------------------------------------------------------- helpers ---

def _is_number(x: Any) -> bool:
    """int or float, never bool (bool is a subclass of int)."""
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _parse_numeric_str(s: str) -> int | float | None:
    """Parse ``s`` with ``int()`` then ``float()``; ``None`` when neither accepts it."""
    for conv in (int, float):
        try:
            return conv(s)
        except (ValueError, OverflowError):
            continue
    return None


def _safe_eq(a: Any, e: Any) -> bool:
    try:
        return bool(a == e)
    except Exception:  # exotic __eq__ (e.g. array-likes) -> treat as unequal
        return False


def _equal(a: Any, e: Any) -> bool:
    # bool is never normalized to a number.
    if isinstance(a, bool) or isinstance(e, bool):
        return isinstance(a, bool) and isinstance(e, bool) and a == e

    if _is_number(a) and _is_number(e):
        return a == e

    # str vs int/float: the string parses to the same numeric value.
    if isinstance(a, str) and _is_number(e):
        parsed = _parse_numeric_str(a)
        return parsed is not None and parsed == e
    if _is_number(a) and isinstance(e, str):
        parsed = _parse_numeric_str(e)
        return parsed is not None and parsed == a

    # list/tuple vs list/tuple: element-wise or as a reordered multiset.
    if isinstance(a, (list, tuple)) and isinstance(e, (list, tuple)):
        if len(a) != len(e):
            return False
        if all(_equal(x, y) for x, y in zip(a, e)):
            return True
        return _has_perfect_matching(a, e)

    return _safe_eq(a, e)


def _has_perfect_matching(a: list | tuple, e: list | tuple) -> bool:
    """Kuhn's augmenting-path bipartite matching under ``_equal`` (lazy edges)."""
    n = len(a)
    cache: dict[tuple[int, int], bool] = {}

    def edge(i: int, j: int) -> bool:
        key = (i, j)
        if key not in cache:
            cache[key] = _equal(a[i], e[j])
        return cache[key]

    match_of_e: list[int] = [-1] * n  # index of a-element matched to e[j]

    def augment(i: int, seen: list[bool]) -> bool:
        for j in range(n):
            if seen[j] or not edge(i, j):
                continue
            seen[j] = True
            if match_of_e[j] == -1 or augment(match_of_e[j], seen):
                match_of_e[j] = i
                return True
        return False

    for i in range(n):
        if not augment(i, [False] * n):
            return False
    return True


def _decimal_places(d: Decimal) -> int:
    exp = d.as_tuple().exponent
    return max(0, -exp) if isinstance(exp, int) else 0


# ------------------------------------------------------------- public API ---

def equal_after_normalization(a: Any, e: Any) -> bool:
    """True when ``a`` and ``e`` are equal after type normalization (10.2).

    Covers, recursively: int vs float with the same value; str vs int/float
    where the string parses (``int()`` or ``float()``) to the same value;
    list vs tuple element-wise; list/tuple vs list/tuple holding the same
    multiset in a different order. bool is never normalized: bool vs non-bool
    is False, bool vs bool compares directly. Other types use ``==``.
    """
    try:
        return _equal(a, e)
    except RecursionError:
        return False


def rounding_equal(a: Any, e: Any) -> bool:
    """True when two unequal numbers match after rounding (10.3).

    The more precise value (more decimal places in ``repr``) is rounded
    ROUND_HALF_UP to the places of the less precise one (0..15) and compared
    with the less precise value as written.
    """
    if not (_is_number(a) and _is_number(e)) or a == e:
        return False
    if isinstance(a, float) and not math.isfinite(a):
        return False
    if isinstance(e, float) and not math.isfinite(e):
        return False
    try:
        da, de = Decimal(repr(a)), Decimal(repr(e))
    except (InvalidOperation, ValueError):
        return False
    pa, pe = _decimal_places(da), _decimal_places(de)
    if pa == pe:
        return False  # same precision and unequal: rounding changes nothing
    more, less, places = (da, de, pe) if pa > pe else (de, da, pa)
    if places > MAX_ROUNDING_PLACES:
        return False
    ctx = Context(prec=max(28, len(more.as_tuple().digits) + places + 2))
    try:
        rounded = more.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP, context=ctx)
    except InvalidOperation:
        return False
    return rounded == less


def _extract_pair(item: Any) -> tuple[Any, Any]:
    if isinstance(item, Mapping):
        return item.get("actual", MISSING), item.get("expected", MISSING)
    if isinstance(item, (tuple, list)):
        if len(item) == 2:
            return item[0], item[1]
        return MISSING, MISSING
    return getattr(item, "actual", MISSING), getattr(item, "expected", MISSING)


def _missing(v: Any) -> bool:
    return v is None or v is MISSING


def classify_functional(assertions: Iterable[Any]) -> str:
    """Classify a functional failure from its failing assertions' values.

    Returns ``"unextractable"`` when any assertion lacks an actual or expected
    value (or there are no assertions), ``"format"`` when every pair is
    ``equal_after_normalization`` or ``rounding_equal``, otherwise ``"logic"``.
    """
    pairs = [_extract_pair(item) for item in assertions]
    if not pairs or any(_missing(a) or _missing(e) for a, e in pairs):
        return UNEXTRACTABLE
    if all(equal_after_normalization(a, e) or rounding_equal(a, e) for a, e in pairs):
        return FORMAT
    return LOGIC
