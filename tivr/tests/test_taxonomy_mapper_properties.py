"""Property-based tests for the rule-based TaxonomyMapper (tivr/taxonomy.py).

Property 2: Mapper equals first-match reference evaluation.

The reference evaluator below is independent of the loader: it reads the raw
rule objects from ``shared/taxonomy.v1.json`` and compiles every regex itself
(signal: full match ``\\A(?:p)\\Z``; message: search, ``re.IGNORECASE`` when
``ignore_case``; technique: optional allowed set). Advisory findings get no
category; a blocking finding matching no rule is ``UNMAPPED``.
"""
from __future__ import annotations

import dataclasses
import json
import re
from pathlib import Path
from typing import Any

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from tivr.schemas import (
    ADVISORY,
    ADVISORY_TECHNIQUES,
    BLOCKING,
    CORRECTNESS_TECHNIQUES,
    Finding,
)
from tivr.taxonomy import TaxonomyMapper
from tivr.taxonomy_def import TaxonomyDefinition, load_definition

_SETTINGS = settings(
    max_examples=300,
    deadline=None,
    suppress_health_check=[HealthCheck.too_slow, HealthCheck.function_scoped_fixture],
)

DEFINITION: TaxonomyDefinition = load_definition()
RAW: dict[str, Any] = json.loads(Path(DEFINITION.path).read_text(encoding="utf-8"))
RAW_RULES: list[dict[str, Any]] = RAW["rules"]
RAW_BY_ID: dict[str, dict[str, Any]] = {r["id"]: r for r in RAW_RULES}
UNMAPPED_ID: str = RAW["unmapped"]["id"]


# ---------------------------------------------------------------------------
# Independent reference evaluator
# ---------------------------------------------------------------------------

def _reference(raw_rules: list[dict[str, Any]], technique: str, severity: str,
               signal: str, message: str) -> tuple[str | None, str | None, float | None]:
    """(category, rule_id, confidence) by first-match over ``raw_rules``."""
    if severity == ADVISORY:
        return None, None, None
    for r in raw_rules:
        m = r["match"]
        allowed = m.get("technique")
        if allowed is not None and technique not in allowed:
            continue
        sig = m.get("signal")
        if sig is not None and re.compile(r"\A(?:" + sig + r")\Z").match(signal) is None:
            continue
        msg = m.get("message")
        if msg is not None:
            flags = re.IGNORECASE if m.get("ignore_case") else 0
            if re.compile(msg, flags).search(message) is None:
                continue
        return r["category"], r["id"], float(r["confidence"])
    return UNMAPPED_ID, None, None


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_IDENT = st.from_regex(r"[A-Za-z_][A-Za-z0-9_]{0,12}", fullmatch=True)

_KNOWN_CLASSES = [
    "SyntaxError", "IndentationError", "TabError", "ModuleNotFoundError",
    "ImportError", "NameError", "UnboundLocalError", "TypeError",
    "AttributeError", "IndexError", "KeyError", "ValueError",
    "ZeroDivisionError", "OverflowError", "RecursionError",
    "AssertionError", "RuntimeError", "UnicodeDecodeError", "unknown",
]
_EXC_CLASSES = st.one_of(st.sampled_from(_KNOWN_CLASSES), st.sampled_from(_KNOWN_CLASSES), _IDENT)
_STAGES = st.sampled_from(["syntax", "import", "collection", "runtime"])
_KNOWN_QUALIFIERS = ["llm_defined", "stdlib_unbound", "candidate", "external"]
_QUALIFIERS = st.one_of(
    st.sampled_from(_KNOWN_QUALIFIERS),
    st.from_regex(r"[a-z_]{1,10}", fullmatch=True),
)


@st.composite
def _staged(draw: st.DrawFn) -> str:
    """stage x exception class x optional qualifier (enriched grammar)."""
    sig = f"{draw(_STAGES)}:{draw(_EXC_CLASSES)}"
    if draw(st.integers(0, 2)) == 0:
        sig += f":{draw(_QUALIFIERS)}"
    return sig


@st.composite
def _well_formed_staged(draw: st.DrawFn) -> str:
    """Grammar-valid staged signals from known stages/classes/qualifiers only."""
    sig = f"{draw(_STAGES)}:{draw(st.sampled_from(_KNOWN_CLASSES))}"
    if draw(st.integers(0, 2)) == 0:
        sig += f":{draw(st.sampled_from(_KNOWN_QUALIFIERS))}"
    return sig


_GRAMMAR_SIGNALS = st.one_of(
    st.sampled_from(["no_code_output", "timeout"]),
    st.builds(lambda k: f"functional:{k}",
              st.one_of(st.sampled_from(["format", "logic", "unextractable"]), _IDENT)),
    _staged(),
    _well_formed_staged(),
    _well_formed_staged(),
)
# Near-misses probe full-match anchoring (prefix/suffix, trailing newline, case).
# Signals drawn from a random rule's own signal pattern (hits every rule).
_RULE_SIGNALS = st.sampled_from([r["match"]["signal"] for r in RAW_RULES if "signal" in r["match"]]
                                ).flatmap(lambda p: st.from_regex(p, fullmatch=True))
_SIGNALS = st.one_of(
    _GRAMMAR_SIGNALS,
    _GRAMMAR_SIGNALS,
    _RULE_SIGNALS,
    _RULE_SIGNALS,
    _GRAMMAR_SIGNALS.flatmap(lambda s: st.sampled_from(
        [s + "\n", " " + s, s + "x", "x" + s, s.upper(), s.lower()])),
    st.text(max_size=20),
)

_PHRASES = [
    "import * only allowed at module level",
    "'(' was never closed",
    "unterminated string literal (detected at line 3)",
    "unterminated triple-quoted string literal",
    "unexpected EOF while parsing",
    "EOF while scanning triple-quoted string literal",
    "expected ':'",
    "missing ':'",
    "invalid syntax",
    "f() takes 1 positional argument but 2 were given",
    "g() takes from 1 to 2 positional arguments but 3 were given",
    "h() takes no positional arguments but 1 was given",
    "len() takes exactly one argument (2 given)",
    "foo() takes at most 2 arguments (3 given)",
    "bar() takes no arguments (1 given)",
    "f() missing 1 required positional argument: 'x'",
    "f() missing 2 required keyword-only arguments: 'a' and 'b'",
    "f() got an unexpected keyword argument 'z'",
    "f() got multiple values for argument 'x'",
    "f() got multiple values for keyword argument 'x'",
    "expected at most 3 arguments, got 5",
    "expected 2 positional arguments, got 1",
    "unsupported operand type(s) for +: 'int' and 'str'",
    "name 'math' is not defined",
    "list index out of range",
    "",
]
_CASE = st.sampled_from([str, str.upper, str.lower, str.swapcase])
_SHORT_TEXT = st.text(max_size=12)


_RULE_MESSAGE_PATTERNS = [r["match"]["message"] for r in RAW_RULES if "message" in r["match"]]


@st.composite
def _messages(draw: st.DrawFn) -> str:
    kind = draw(st.integers(0, 5))
    if kind == 0:
        return draw(st.text(max_size=40))
    if kind == 1:  # text containing a match of some rule's message pattern
        pattern = draw(st.sampled_from(_RULE_MESSAGE_PATTERNS))
        return draw(_CASE)(draw(st.from_regex(pattern)))
    phrase = draw(_CASE)(draw(st.sampled_from(_PHRASES)))
    return draw(_SHORT_TEXT) + phrase + draw(_SHORT_TEXT)


_TECHNIQUES = st.one_of(
    st.sampled_from(CORRECTNESS_TECHNIQUES + ADVISORY_TECHNIQUES),
    st.text(max_size=8),
)
_SEVERITIES = st.sampled_from([BLOCKING, BLOCKING, BLOCKING, ADVISORY])


@st.composite
def _findings(draw: st.DrawFn) -> Finding:
    if draw(st.integers(0, 2)) == 0:
        # Rule-targeted: signal and message drawn from one rule's own patterns,
        # so that rules needing both conditions (R03, R04, R11) are exercised.
        match = draw(st.sampled_from(RAW_RULES))["match"]
        signal = draw(st.from_regex(match["signal"], fullmatch=True))
        if "message" in match:
            message = draw(st.from_regex(match["message"]))
            if match.get("ignore_case"):
                message = draw(_CASE)(message)
        else:
            message = draw(_messages())
    else:
        signal, message = draw(_SIGNALS), draw(_messages())
    return Finding(technique=draw(_TECHNIQUES), severity=draw(_SEVERITIES),
                   signal=signal, message=message)


@st.composite
def _variant_definitions(draw: st.DrawFn) -> tuple[TaxonomyDefinition, list[dict[str, Any]]]:
    """Random subset/permutation of the rules, some gaining a technique restriction.

    Returns the mapper's definition and the matching raw rule list for the reference.
    """
    ids = draw(st.permutations([r.id for r in DEFINITION.rules]))
    ids = ids[:draw(st.integers(0, len(ids)))]
    by_id = {r.id: r for r in DEFINITION.rules}
    rules, raw = [], []
    for rid in ids:
        rule, raw_rule = by_id[rid], json.loads(json.dumps(RAW_BY_ID[rid]))
        if draw(st.integers(0, 3)) == 0:
            allowed = draw(st.lists(st.sampled_from(CORRECTNESS_TECHNIQUES + ADVISORY_TECHNIQUES),
                                    min_size=1, unique=True))
            rule = dataclasses.replace(rule, technique=frozenset(allowed))
            raw_rule["match"]["technique"] = allowed
        rules.append(rule)
        raw.append(raw_rule)
    return dataclasses.replace(DEFINITION, rules=tuple(rules)), raw


# ---------------------------------------------------------------------------
# Property 2
# ---------------------------------------------------------------------------

def _check(defn: TaxonomyDefinition, raw_rules: list[dict[str, Any]], f: Finding) -> None:
    m = TaxonomyMapper(defn).map_finding(f)
    expected = _reference(raw_rules, f.technique, f.severity, f.signal, f.message)
    assert (m.category, m.rule_id, m.confidence) == expected, (
        f"signal={f.signal!r} message={f.message!r} technique={f.technique!r}")
    # Finding data is carried over unchanged.
    assert (m.technique, m.severity, m.signal, m.message) == (
        f.technique, f.severity, f.signal, f.message)
    if f.severity == ADVISORY:
        assert m.category is None and m.rule_id is None and m.confidence is None
    else:
        # Exactly one category: a single A.1–C.4 ID or UNMAPPED, never None.
        assert isinstance(m.category, str)
        assert m.category == defn.unmapped.id or m.category in defn.categories
        assert defn.priority(m.category) <= defn.priority(defn.unmapped.id)


def test_raw_rules_match_loaded_rule_order() -> None:
    """The reference walks the same rules, in the same order, as the loader."""
    assert [r["id"] for r in RAW_RULES] == [r.id for r in DEFINITION.rules]
    c4 = DEFINITION.categories["C.4"].priority
    assert DEFINITION.priority(UNMAPPED_ID) > max(c.priority for c in DEFINITION.categories.values())
    assert DEFINITION.priority(UNMAPPED_ID) > c4


@_SETTINGS
@given(f=_findings())
def test_mapper_equals_first_match_reference(f: Finding) -> None:
    """**Validates: Requirements 7.4, 8.8, 8.9, 20.2**"""
    _check(DEFINITION, RAW_RULES, f)


@_SETTINGS
@given(variant=_variant_definitions(), f=_findings())
def test_mapper_follows_rule_order_of_any_definition(
        variant: tuple[TaxonomyDefinition, list[dict[str, Any]]], f: Finding) -> None:
    """**Validates: Requirements 7.4, 8.8, 8.9, 20.2**"""
    defn, raw = variant
    _check(defn, raw, f)


@pytest.mark.parametrize("signal, message", [
    ("runtime:TypeError", "f() takes 1 positional argument but 2 were given"),
    ("runtime:ModuleNotFoundError:llm_defined", "No module named 'helpers'"),  # R05 and R06
])
def test_rule_order_changes_outcome(signal: str, message: str) -> None:
    """Reversing the rule order flips the result for findings matching several rules."""
    f = Finding(technique="runtime", severity=BLOCKING, signal=signal, message=message)
    rev = dataclasses.replace(DEFINITION, rules=tuple(reversed(DEFINITION.rules)))
    fwd_m, rev_m = TaxonomyMapper(DEFINITION).map_finding(f), TaxonomyMapper(rev).map_finding(f)
    assert fwd_m.rule_id == _reference(RAW_RULES, f.technique, f.severity, signal, message)[1]
    assert rev_m.rule_id == _reference(RAW_RULES[::-1], f.technique, f.severity, signal, message)[1]
    assert fwd_m.rule_id != rev_m.rule_id
