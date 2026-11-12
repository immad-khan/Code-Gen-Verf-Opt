"""Output equivalence and value serialization for prepared benchmark suites.

Two concerns live here:

* ``to_source`` / ``from_source``: a restricted serializer used to inline test
  inputs and expected outputs into self-contained pytest sources, and to read
  captured actual/expected values back without ``eval``.
* ``equivalent(actual, expected, atol)``: the output comparison used by the
  Hidden_Suite and Visible_Suite (Requirements 3.4, 3.5, 4.2).

The comparison logic is written once, as Python source in
``SUITE_HELPER_SOURCE``. Generated suites inline that string verbatim, and this
module executes the same string to build ``equivalent``, so the suites and the
pipeline cannot drift apart.
"""

from __future__ import annotations

import ast
import math
from typing import Any, Callable

__all__ = [
    "SUITE_HELPER_SOURCE",
    "SourceError",
    "Unserializable",
    "equivalent",
    "from_source",
    "to_source",
]


class Unserializable(ValueError):
    """Raised by ``to_source`` for a value outside the supported type set."""


class SourceError(ValueError):
    """Raised by ``from_source`` for text that is not a supported value expression."""


# ---------------------------------------------------------------------------
# Suite helper (inlined into generated test files; stdlib only)
# ---------------------------------------------------------------------------
#
# Rules (see design "equivalent(actual, expected, atol)"):
#
# * atol != 0 (Req 3.4): recursive structural comparison. Lists and tuples must
#   match in kind and length and are compared element-wise. A float expected
#   value at any depth inside lists/tuples matches an actual float with
#   |a - e| <= atol (or an actual value that is exactly equal). Everything
#   else is compared with ``==``.
# * atol == 0 (Req 3.5, EvalPlus default): exact ``==``. When that fails and the
#   expected value is a float or a non-empty list/tuple whose elements are all
#   floats, the actual value must have the same type (and length) and every
#   float must satisfy |a - e| <= 1e-6 + 1e-7 * |e|.
#
# In both modes NaN never matches (EvalPlus behaviour), infinities match only
# an equal infinity, and a comparison that raises counts as "not equivalent".
#
# The helper avoids braces so it can be embedded in any text template, and all
# of its module-level names start with ``_tivr`` so they cannot collide with a
# task's entry point or be collected by pytest.
SUITE_HELPER_SOURCE = '''\
# --- tivr equivalence helper (from tivr/equivalence.py; stdlib only) ---
import math as _tivr_math

_TIVR_EVALPLUS_ATOL = 1e-6
_TIVR_EVALPLUS_RTOL = 1e-7
_TIVR_REPR_LIMIT = 1000


def _tivr_safe_eq(actual, expected):
    try:
        return bool(actual == expected)
    except Exception:
        return False


def _tivr_float_close(actual, expected, atol, rtol):
    if not isinstance(actual, float):
        return _tivr_safe_eq(actual, expected)
    if actual == expected:
        return True
    if not (_tivr_math.isfinite(actual) and _tivr_math.isfinite(expected)):
        return False
    return abs(actual - expected) <= atol + rtol * abs(expected)


def _tivr_same_sequence_kind(actual, expected):
    if isinstance(expected, list):
        return isinstance(actual, list)
    return isinstance(actual, tuple)


def _tivr_structural(actual, expected, atol):
    if isinstance(expected, float):
        return _tivr_float_close(actual, expected, atol, 0.0)
    if isinstance(expected, (list, tuple)):
        if not _tivr_same_sequence_kind(actual, expected):
            return False
        if len(actual) != len(expected):
            return False
        for a, e in zip(actual, expected):
            if not _tivr_structural(a, e, atol):
                return False
        return True
    return _tivr_safe_eq(actual, expected)


def _tivr_is_floats(value):
    if isinstance(value, float):
        return True
    if isinstance(value, (list, tuple)) and len(value) > 0:
        return all(isinstance(x, float) for x in value)
    return False


def _tivr_evalplus(actual, expected):
    if _tivr_safe_eq(actual, expected):
        return True
    if not _tivr_is_floats(expected):
        return False
    if isinstance(expected, float):
        if not isinstance(actual, float):
            return False
        return _tivr_float_close(actual, expected, _TIVR_EVALPLUS_ATOL, _TIVR_EVALPLUS_RTOL)
    if not _tivr_same_sequence_kind(actual, expected):
        return False
    if len(actual) != len(expected):
        return False
    for a, e in zip(actual, expected):
        if not _tivr_float_close(a, e, _TIVR_EVALPLUS_ATOL, _TIVR_EVALPLUS_RTOL):
            return False
    return True


def _tivr_equivalent(actual, expected, atol):
    try:
        if atol != 0:
            return bool(_tivr_structural(actual, expected, atol))
        return bool(_tivr_evalplus(actual, expected))
    except Exception:
        return False


def _tivr_repr(value):
    try:
        text = repr(value)
    except Exception:
        text = "<unrepresentable %s>" % type(value).__name__
    if len(text) > _TIVR_REPR_LIMIT:
        text = text[:_TIVR_REPR_LIMIT] + "..."
    return text


def _tivr_check(actual, expected, atol, idx, args):
    if _tivr_equivalent(actual, expected, atol):
        return
    error = AssertionError(
        "case %s: wrong output for input %s: expected %s, got %s"
        % (idx, _tivr_repr(args), _tivr_repr(expected), _tivr_repr(actual))
    )
    error._tivr_case = idx
    error._tivr_input = args
    error._tivr_actual = actual
    error._tivr_expected = expected
    raise error
# --- end tivr equivalence helper ---
'''

_helper_namespace: dict[str, Any] = {"__name__": "tivr._suite_helper"}
exec(compile(SUITE_HELPER_SOURCE, "<tivr suite helper>", "exec"), _helper_namespace)
_helper_equivalent: Callable[[Any, Any, float], bool] = _helper_namespace["_tivr_equivalent"]


def equivalent(actual: Any, expected: Any, atol: float = 0.0) -> bool:
    """Return whether ``actual`` matches ``expected`` under the suite rules.

    ``atol != 0`` applies the structural absolute-tolerance rule (Req 3.4);
    ``atol == 0`` applies EvalPlus's default semantics (Req 3.5). This is the
    exact function that generated suites run as ``_tivr_equivalent``.
    """
    return bool(_helper_equivalent(actual, expected, atol))


# ---------------------------------------------------------------------------
# Serializer
# ---------------------------------------------------------------------------

_SCALAR_TYPES = (type(None), bool, int, float, complex, str, bytes)


def _float_source(value: float) -> str:
    if math.isnan(value):
        return "float('nan')"
    if math.isinf(value):
        return "float('inf')" if value > 0 else "float('-inf')"
    return repr(value)


def _int_source(value: int) -> str:
    try:
        return repr(value)
    except ValueError:
        # Decimal conversion of very large ints is capped (sys.int_info /
        # int_max_str_digits); hexadecimal is not, and parses back exactly.
        return hex(value)


def _to_source(value: Any, active: set[int]) -> str:
    kind = type(value)
    if value is None:
        return "None"
    if kind is bool:
        return "True" if value else "False"
    if kind is int:
        return _int_source(value)
    if kind is float:
        return _float_source(value)
    if kind is complex:
        return f"complex({_float_source(value.real)}, {_float_source(value.imag)})"
    if kind is str or kind is bytes:
        return repr(value)
    if kind not in (list, tuple, dict, set, frozenset):
        raise Unserializable(f"unsupported type {kind.__module__}.{kind.__qualname__}")

    marker = id(value)
    if marker in active:
        raise Unserializable(f"self-referencing {kind.__name__}")
    active.add(marker)
    try:
        if kind is list:
            return "[" + ", ".join(_to_source(item, active) for item in value) + "]"
        if kind is tuple:
            parts = [_to_source(item, active) for item in value]
            if len(parts) == 1:
                return "(" + parts[0] + ",)"
            return "(" + ", ".join(parts) + ")"
        if kind is dict:
            items = (
                _to_source(k, active) + ": " + _to_source(v, active) for k, v in value.items()
            )
            return "{" + ", ".join(items) + "}"
        # set / frozenset: sort element sources so output does not depend on
        # hash randomization across processes.
        parts = sorted(_to_source(item, active) for item in value)
        if kind is set:
            return "{" + ", ".join(parts) + "}" if parts else "set()"
        return "frozenset({" + ", ".join(parts) + "})" if parts else "frozenset()"
    finally:
        active.discard(marker)


def to_source(value: Any) -> str:
    """Serialize ``value`` as a Python expression that ``from_source`` accepts.

    Supported: ``None``, ``bool``, ``int``, ``float`` (NaN/±inf as
    ``float('...')``), ``complex``, ``str``, ``bytes`` and
    ``list``/``tuple``/``dict``/``set``/``frozenset`` of those. Types are
    matched exactly, so subclasses (enums, namedtuples, ``OrderedDict``,
    NumPy scalars, ...) raise ``Unserializable``, as do self-referencing
    containers.
    """
    try:
        return _to_source(value, set())
    except RecursionError:
        raise Unserializable("value is nested too deeply") from None


# --- restricted evaluator ---------------------------------------------------

_FLOAT_SPECIALS = {"nan", "inf", "+inf", "-inf"}
_CONTAINER_VALUES = (list, tuple, set, frozenset)


def _is_real(value: Any) -> bool:
    return type(value) in (int, float)


def _is_number(value: Any) -> bool:
    return type(value) in (int, float, complex)


def _eval_call(node: ast.Call) -> Any:
    if not isinstance(node.func, ast.Name) or node.keywords:
        raise SourceError("unsupported call")
    name = node.func.id
    if any(isinstance(arg, ast.Starred) for arg in node.args):
        raise SourceError("starred arguments are not supported")
    if name == "float":
        if len(node.args) != 1:
            raise SourceError("float() takes one string argument")
        arg = node.args[0]
        if (
            not isinstance(arg, ast.Constant)
            or type(arg.value) is not str
            or arg.value.strip().lower() not in _FLOAT_SPECIALS
        ):
            raise SourceError("float() accepts only 'nan', 'inf', '+inf' or '-inf'")
        return float(arg.value)
    if name in ("set", "frozenset"):
        if len(node.args) > 1:
            raise SourceError(f"{name}() takes at most one argument")
        items: Any = ()
        if node.args:
            items = _eval(node.args[0])
            if type(items) not in _CONTAINER_VALUES:
                raise SourceError(f"{name}() argument must be a list, tuple, set or frozenset")
        try:
            return set(items) if name == "set" else frozenset(items)
        except TypeError as exc:
            raise SourceError(f"unhashable {name} element: {exc}") from None
    if name == "complex":
        if not 1 <= len(node.args) <= 2:
            raise SourceError("complex() takes one or two numeric arguments")
        parts = [_eval(arg) for arg in node.args]
        if not all(_is_real(part) for part in parts):
            raise SourceError("complex() arguments must be int or float")
        return complex(*parts)
    raise SourceError(f"call to {name!r} is not allowed")


def _eval(node: ast.AST) -> Any:
    if isinstance(node, ast.Constant):
        if type(node.value) not in _SCALAR_TYPES:
            raise SourceError(f"unsupported constant {node.value!r}")
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        operand = _eval(node.operand)
        if not _is_number(operand):
            raise SourceError("unary sign applies only to numbers")
        return -operand if isinstance(node.op, ast.USub) else +operand
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub)):
        # Complex literals in repr form, e.g. (1+2j) or (-1-0j).
        left, right = _eval(node.left), _eval(node.right)
        if not (_is_real(left) and type(right) is complex):
            raise SourceError("only real +/- imaginary literals are allowed")
        return left + right if isinstance(node.op, ast.Add) else left - right
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        if any(isinstance(elt, ast.Starred) for elt in node.elts):
            raise SourceError("starred elements are not supported")
        values = [_eval(elt) for elt in node.elts]
        if isinstance(node, ast.List):
            return values
        if isinstance(node, ast.Tuple):
            return tuple(values)
        try:
            return set(values)
        except TypeError as exc:
            raise SourceError(f"unhashable set element: {exc}") from None
    if isinstance(node, ast.Dict):
        result: dict[Any, Any] = {}
        for key_node, value_node in zip(node.keys, node.values):
            if key_node is None:
                raise SourceError("dict unpacking is not supported")
            key = _eval(key_node)
            try:
                result[key] = _eval(value_node)
            except TypeError as exc:
                raise SourceError(f"unhashable dict key: {exc}") from None
        return result
    if isinstance(node, ast.Call):
        return _eval_call(node)
    raise SourceError(f"unsupported expression {type(node).__name__}")


def from_source(source: str) -> Any:
    """Evaluate a value expression produced by ``to_source`` without ``eval``.

    Accepts Python literals (as ``ast.literal_eval`` does) plus
    ``float('nan'|'inf'|'+inf'|'-inf')``, ``complex(re[, im])``,
    ``set(...)`` and ``frozenset(...)``. Anything else raises ``SourceError``.
    """
    if not isinstance(source, str):
        raise SourceError(f"expected str, got {type(source).__name__}")
    try:
        tree = ast.parse(source.strip(), mode="eval")
        return _eval(tree.body)
    except SourceError:
        raise
    except (SyntaxError, ValueError, RecursionError, MemoryError) as exc:
        raise SourceError(f"not a value expression: {type(exc).__name__}") from None
