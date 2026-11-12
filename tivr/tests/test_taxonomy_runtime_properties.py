"""Property-based tests for the runtime rules of the shared taxonomy.

Feature: paper-aligned-repair-tool, Property 3: TypeError argument families map to B.4, other TypeErrors to B.1
**Validates: Requirements 9.1, 9.2, 18.1**

Feature: paper-aligned-repair-tool, Property 4: Runtime classification by exact class with LLM-defined precedence
**Validates: Requirements 9.3, 9.4, 9.5, 9.7, 9.8**

The mapper under test is ``TaxonomyMapper(load_definition())`` over the
shared ``shared/taxonomy.v1.json`` rules, fed runtime Correctness_Findings
whose signals use the enriched grammar (``runtime:<Class>``,
``collection:<Class>``, ``runtime:<Class>:llm_defined``,
``runtime:NameError:stdlib_unbound``).

TypeError messages come from two sources: templates of the CPython message
families with random names/counts, and messages captured from real CPython by
calling generated functions with wrong arguments (or applying operators to
mismatched operand types), so the rules are checked against the interpreter.
"""
from __future__ import annotations

import keyword
import operator

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from tivr.schemas import Finding
from tivr.taxonomy import TaxonomyMapper
from tivr.taxonomy_def import load_definition

SETTINGS = settings(max_examples=200, deadline=None)

MAPPER = TaxonomyMapper(load_definition())
UNMAPPED = MAPPER.definition.unmapped.id


def category(signal: str, message: str) -> str:
    finding = Finding(technique="runtime", severity="blocking",
                      signal=signal, message=message)
    return MAPPER.map_finding(finding).category


# ------------------------------------------------------------ name pieces ---

prefixes = st.sampled_from(["runtime", "collection"])

idents = st.from_regex(r"[a-z_][a-z0-9_]{0,10}", fullmatch=True).filter(
    lambda s: not keyword.iskeyword(s))
class_idents = st.from_regex(r"[A-Z][A-Za-z0-9_]{0,10}", fullmatch=True).filter(
    lambda s: not keyword.iskeyword(s))

# Plain, method-qualified and constructor-qualified callables, as CPython prints them.
qualnames = st.one_of(
    idents,
    st.builds(lambda c, m: f"{c}.{m}", class_idents, idents),
    st.builds(lambda c: f"{c}.__init__", class_idents),
)


def _s(n: int) -> str:
    return "" if n == 1 else "s"


def _names_list(names: list[str]) -> str:
    """CPython's format for missing-argument names: 'a' / 'a' and 'b' / 'a', 'b', and 'c'."""
    quoted = [f"'{n}'" for n in names]
    if len(quoted) == 1:
        return quoted[0]
    if len(quoted) == 2:
        return f"{quoted[0]} and {quoted[1]}"
    return ", ".join(quoted[:-1]) + f", and {quoted[-1]}"


# ------------------------------------------- Property 3: template families ---

@st.composite
def too_many_positional(draw):
    name = draw(qualnames)
    n = draw(st.integers(0, 6))
    m = draw(st.integers(n + 1, n + 6))
    verb = "was" if m == 1 else "were"
    return f"{name}() takes {n} positional argument{_s(n)} but {m} {verb} given"


@st.composite
def range_positional(draw):
    name = draw(qualnames)
    lo = draw(st.integers(0, 5))
    hi = draw(st.integers(lo + 1, lo + 5))
    m = draw(st.integers(hi + 1, hi + 5))
    return f"{name}() takes from {lo} to {hi} positional arguments but {m} were given"


@st.composite
def too_many_positional_with_kwonly(draw):
    """CPython form when keyword-only arguments were also passed (ceval too_many_positional)."""
    name = draw(qualnames)
    lo = draw(st.integers(0, 4))
    takes = draw(st.one_of(
        st.just(f"{lo} positional argument{_s(lo)}"),
        st.integers(lo + 1, lo + 4).map(lambda hi: f"from {lo} to {hi} positional arguments"),
    ))
    m = draw(st.integers(lo + 5, lo + 9))
    k = draw(st.integers(1, 4))
    return (f"{name}() takes {takes} but {m} positional argument{_s(m)} "
            f"(and {k} keyword-only argument{_s(k)}) were given")


@st.composite
def missing_required(draw):
    name = draw(qualnames)
    kind = draw(st.sampled_from(["positional", "keyword-only"]))
    args = draw(st.lists(idents, min_size=1, max_size=5, unique=True))
    return (f"{name}() missing {len(args)} required {kind} argument{_s(len(args))}: "
            f"{_names_list(args)}")


@st.composite
def unexpected_keyword(draw):
    name = draw(qualnames)
    arg = draw(idents)
    hint = draw(st.one_of(st.just(""), idents.map(lambda h: f". Did you mean '{h}'?")))
    return f"{name}() got an unexpected keyword argument '{arg}'{hint}"


@st.composite
def multiple_values(draw):
    name = draw(qualnames)
    arg = draw(idents)
    kw = draw(st.sampled_from(["", "keyword "]))
    return f"{name}() got multiple values for {kw}argument '{arg}'"


@st.composite
def builtin_count(draw):
    """Builtin/C-function forms, e.g. ``len() takes exactly one argument (2 given)``."""
    name = draw(idents)
    n = draw(st.integers(0, 4))
    m = draw(st.integers(0, 8))
    return draw(st.sampled_from([
        f"{name}() takes at most {n} argument{_s(n)} ({m} given)",
        f"{name}() takes at least {n} argument{_s(n)} ({m} given)",
        f"{name}() takes exactly {n} argument{_s(n)} ({m} given)",
        f"{name}() takes exactly one argument ({m} given)",
        f"{name}() takes no arguments ({m} given)",
        f"{name} expected at most {n} argument{_s(n)}, got {m}",
        f"{name} expected {n} argument{_s(n)}, got {m}",
    ]))


argument_family_templates = st.one_of(
    too_many_positional(), range_positional(), too_many_positional_with_kwonly(),
    missing_required(), unexpected_keyword(), multiple_values(), builtin_count(),
)


# --------------------------------- Property 3: real CPython argument errors ---

@st.composite
def real_argument_error(draw):
    """Define a function with a random signature, call it wrongly, capture str(TypeError)."""
    names = draw(st.lists(idents.filter(lambda s: s != "self"),
                          min_size=1, max_size=7, unique=True))
    split = draw(st.integers(0, len(names)))
    pos, kwonly = names[:split], names[split:]
    n_default = draw(st.integers(0, len(pos)))
    required = len(pos) - n_default
    params = [p if i < required else f"{p}=0" for i, p in enumerate(pos)]
    if kwonly:
        params += ["*"] + kwonly
    fname = draw(idents)
    as_method = draw(st.booleans())

    variants = ["too_many", "unexpected"]
    if required:
        variants.append("missing_pos")
    if kwonly:
        variants.append("missing_kw")
    if pos:
        variants.append("multiple")
    variant = draw(st.sampled_from(variants))

    kwargs = {k: 0 for k in kwonly}
    if variant == "too_many":
        args = [0] * (len(pos) + draw(st.integers(1, 3)))
    elif variant == "missing_pos":
        args = [0] * draw(st.integers(0, required - 1))
    elif variant == "missing_kw":
        args = [0] * required
        for k in draw(st.lists(st.sampled_from(kwonly), min_size=1, unique=True)):
            del kwargs[k]
    elif variant == "unexpected":
        args = [0] * required
        extra = draw(idents.filter(lambda s: s not in names and s != "self"))
        kwargs[extra] = 0
    else:  # multiple
        args = [0] * max(1, required)
        kwargs[pos[0]] = 0

    namespace: dict = {}
    if as_method:
        cls = draw(class_idents)
        sig = ", ".join(["self"] + params)
        exec(f"class {cls}:\n    def {fname}({sig}): pass\n", namespace)
        target = getattr(namespace[cls](), fname)
    else:
        exec(f"def {fname}({', '.join(params)}): pass\n", namespace)
        target = namespace[fname]
    try:
        target(*args, **kwargs)
    except TypeError as exc:
        return str(exc)
    raise AssertionError(f"call unexpectedly succeeded: {variant} {params} {args} {kwargs}")


# ------------------------------------ Property 3: non-argument TypeErrors ---

type_names = st.sampled_from(["int", "str", "float", "list", "dict", "tuple",
                              "NoneType", "set", "bytes", "function"]) | class_idents


@st.composite
def non_argument_templates(draw):
    a, b = draw(type_names), draw(type_names)
    op = draw(st.sampled_from(["+", "-", "*", "/", "//", "%", "**", "<<", "&", "@"]))
    cmp = draw(st.sampled_from(["<", ">", "<=", ">="]))
    return draw(st.sampled_from([
        f"unsupported operand type(s) for {op}: '{a}' and '{b}'",
        f"'{a}' object is not subscriptable",
        f"'{a}' object is not callable",
        f"'{a}' object is not iterable",
        f"'{a}' object does not support item assignment",
        f'can only concatenate {a} (not "{b}") to {a}',
        f"can't multiply sequence by non-int of type '{a}'",
        f"'{cmp}' not supported between instances of '{a}' and '{b}'",
        f"object of type '{a}' has no len()",
        f"unhashable type: '{a}'",
        f"{a} indices must be integers or slices, not {b}",
        f"bad operand type for unary -: '{a}'",
    ]))


# No callables here: calling one with no arguments would raise an argument-family error.
_OPERANDS = [1, 1.5, "s", None, [1], {"k": 1}, (1,), b"b", {1}, object()]
_BINOPS = [operator.add, operator.sub, operator.mul, operator.truediv,
           operator.mod, operator.lt, operator.getitem, operator.matmul]
_UNARY = [operator.neg, len, iter, hash, lambda v: v(), lambda v: v.__setitem__(0, 0)]


@st.composite
def real_non_argument_error(draw):
    """str(TypeError) from applying real operators to mismatched operand types."""
    if draw(st.booleans()):
        fn = draw(st.sampled_from(_BINOPS))
        a, b = draw(st.sampled_from(_OPERANDS)), draw(st.sampled_from(_OPERANDS))
        call = lambda: fn(a, b)  # noqa: E731
    else:
        fn = draw(st.sampled_from(_UNARY))
        a = draw(st.sampled_from(_OPERANDS))
        call = lambda: fn(a)  # noqa: E731
    try:
        call()
    except TypeError as exc:
        return str(exc)
    except Exception:  # noqa: BLE001 - other exception classes are not under test
        pass
    assume(False)


# Phrases that identify the four argument families (independent of the rule regex).
FAMILY_PHRASES = ("positional argument", "required", "keyword argument",
                  "multiple values", "given", "argument")


def _has_no_family_phrase(text: str) -> bool:
    low = text.lower()
    return not any(p in low for p in FAMILY_PHRASES)


free_text_non_argument = st.text(max_size=80).filter(_has_no_family_phrase)


# ------------------------------------------------------------- Property 3 ---

@SETTINGS
@given(prefix=prefixes, message=argument_family_templates)
def test_p3_argument_family_templates_map_to_b4(prefix, message):
    assert category(f"{prefix}:TypeError", message) == "B.4", message


@SETTINGS
@given(prefix=prefixes, message=real_argument_error())
def test_p3_real_cpython_argument_errors_map_to_b4(prefix, message):
    assert category(f"{prefix}:TypeError", message) == "B.4", message


@SETTINGS
@given(prefix=prefixes,
       message=st.one_of(non_argument_templates(), real_non_argument_error(),
                         free_text_non_argument))
def test_p3_non_argument_type_errors_map_to_b1(prefix, message):
    assert category(f"{prefix}:TypeError", message) == "B.1", message


# ------------------------------------------------------------- Property 4 ---

EXACT_CLASSES = {
    "AttributeError": "B.1",
    "NameError": "B.2",
    "UnboundLocalError": "B.2",
    "IndexError": "B.3",
    "KeyError": "B.3",
    "ValueError": "B.3",
    "ZeroDivisionError": "B.3",
    "OverflowError": "B.3",
    "RecursionError": "B.5",
}

# Every class named by some rule (runtime or otherwise); excluded from "unknown".
RULE_NAMED = set(EXACT_CLASSES) | {
    "TypeError", "ImportError", "ModuleNotFoundError", "SyntaxError",
    "IndentationError", "TabError",
}

BUILTIN_EXCEPTION_NAMES = sorted(
    n for n, v in vars(__import__("builtins")).items()
    if isinstance(v, type) and issubclass(v, BaseException))

# Messages are arbitrary and may even contain B.4 phrases: class alone decides.
any_message = st.one_of(
    st.text(max_size=80),
    argument_family_templates,
    non_argument_templates(),
)


@SETTINGS
@given(prefix=prefixes, cls=st.sampled_from(sorted(EXACT_CLASSES)), message=any_message)
def test_p4_exact_class_maps_to_its_category(prefix, cls, message):
    assert category(f"{prefix}:{cls}", message) == EXACT_CLASSES[cls]


@SETTINGS
@given(prefix=prefixes,
       cls=st.one_of(st.sampled_from(BUILTIN_EXCEPTION_NAMES),
                     st.from_regex(r"[A-Za-z_][A-Za-z0-9_]{0,20}", fullmatch=True)),
       message=any_message)
def test_p4_llm_defined_qualifier_maps_to_b5(prefix, cls, message):
    # Includes TypeError with B.4 messages, NameError, KeyError, ...: LLM-defined wins.
    assert category(f"{prefix}:{cls}:llm_defined", message) == "B.5"


near_misses = st.builds(
    lambda base, pre, suf: f"{pre}{base}{suf}",
    st.sampled_from(sorted(RULE_NAMED)),
    st.sampled_from(["", "My", "Custom", "_"]),
    st.sampled_from(["", "s", "2", "_", "Ex"]),
).filter(lambda n: n not in RULE_NAMED)

unknown_classes = st.one_of(
    # Built-in exceptions not named by any rule, incl. subclasses of named ones
    # (UnicodeDecodeError < ValueError, FileNotFoundError, NotImplementedError, ...).
    st.sampled_from([n for n in BUILTIN_EXCEPTION_NAMES if n not in RULE_NAMED]),
    near_misses,
    st.from_regex(r"[A-Z][A-Za-z0-9_]{0,20}", fullmatch=True).filter(
        lambda n: n not in RULE_NAMED),
)


@SETTINGS
@given(prefix=prefixes, cls=unknown_classes, message=any_message)
def test_p4_other_classes_are_unmapped(prefix, cls, message):
    assert category(f"{prefix}:{cls}", message) == UNMAPPED, cls


@SETTINGS
@given(prefix=prefixes, message=st.text(max_size=80))
def test_p4_stdlib_unbound_name_error_is_not_b2(prefix, message):
    # Req. 9.4 excludes NameErrors satisfying criterion 8.5 (missing stdlib import -> A.3).
    assert category(f"{prefix}:NameError:stdlib_unbound", message) == "A.3"
