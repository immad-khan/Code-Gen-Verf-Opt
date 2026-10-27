"""Property-based tests for the Taxonomy_Definition loader.

Feature: paper-aligned-repair-tool, Property 1
Property 1: Definition validation rejects every single invalid mutation.
**Validates: Requirements 7.1, 7.2, 7.3, 7.7, 10.7**

For the shipped ``shared/taxonomy.v1.json`` and any single mutation drawn from
{remove a required field, duplicate a category ID / priority / rule ID, put a
priority out of range, break A<B<C ordering, retarget a rule to D, C.2, C.4 or
an undefined ID, confidence outside [0, 1], empty match, checklist length
!= 10, wrong schema/version, non-portable or non-compiling regex, missing or
optional required prompt, undeclared or duplicate prompt variable, empty
repair hint, make D/C.2/C.4 auto-assignable}, ``load_definition`` raises
``TaxonomyLoadError`` naming the file and the JSON path of the mutated field.
The unmutated file loads.

Each mutation carries its expected JSON path computed from the mutation
itself (not from the loader), so the oracle is independent of the code under
test.
"""
from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import pytest
from hypothesis import given, note, settings
from hypothesis import strategies as st

import tivr
from tivr.taxonomy_def import (
    CATEGORY_IDS,
    PLACEHOLDER_RE,
    REQUIRED_PROMPTS,
    SUPPORTED_VERSIONS,
    TaxonomyLoadError,
    load_definition,
)

SETTINGS = settings(max_examples=300, deadline=None)

DEFINITION_FILE = Path(tivr.__file__).resolve().parent.parent / "shared" / "taxonomy.v1.json"
BASE: dict[str, Any] = json.loads(DEFINITION_FILE.read_text(encoding="utf-8"))

N_CATS = len(BASE["categories"])
N_RULES = len(BASE["rules"])
PROMPT_NAMES = tuple(BASE["prompts"])
CAT_INDEX = {c["id"]: i for i, c in enumerate(BASE["categories"])}
PT_INDEX = {p["id"]: i for i, p in enumerate(BASE["primary_types"])}

Token = str | int
Mutate = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class Mutation:
    label: str
    apply: Mutate
    json_path: str           # exact expected path of the mutated field


def jpath(tokens: tuple[Token, ...]) -> str:
    return "$" + "".join(f"[{t}]" if isinstance(t, int) else f".{t}" for t in tokens)


def walk(root: Any, tokens: tuple[Token, ...]) -> Any:
    for t in tokens:
        root = root[t]
    return root


def setter(tokens: tuple[Token, ...], value: Any) -> Mutate:
    def apply(d: dict[str, Any]) -> None:
        walk(d, tokens[:-1])[tokens[-1]] = value
    return apply


# ------------------------------------------------------------ mutations ---

def _required_fields() -> list[tuple[tuple[Token, ...], str]]:
    """(container tokens, key) for every required field in BASE."""
    out: list[tuple[tuple[Token, ...], str]] = [
        ((), k) for k in ("schema", "version", "primary_types", "categories", "unmapped",
                          "checklist", "rules", "dou_feedback", "prompts")
    ]
    for i, pt in enumerate(BASE["primary_types"]):
        keys = ["id", "name", "auto_assignable"] + ([] if pt["auto_assignable"] else ["not_assigned_reason"])
        out += [(("primary_types", i), k) for k in keys]
    for i, cat in enumerate(BASE["categories"]):
        keys = ["id", "primary", "name", "priority", "auto_assignable", "repair_hint"]
        keys += [] if cat["auto_assignable"] else ["not_assigned_reason"]
        out += [(("categories", i), k) for k in keys]
    out += [(("unmapped",), k) for k in ("id", "name", "priority", "primary_state", "repair_hint")]
    out += [(("rules", i), k) for i in range(N_RULES) for k in ("id", "match", "category", "confidence")]
    out += [(("dou_feedback",), k) for k in ("functional", "timeout", "no_code")]
    out += [(("prompts", n), k) for n in PROMPT_NAMES for k in ("variables", "text")]
    out += [(("prompts",), n) for n in REQUIRED_PROMPTS]
    return out


REQUIRED_FIELDS = _required_fields()


@st.composite
def remove_required(draw) -> Mutation:
    container, key = draw(st.sampled_from(REQUIRED_FIELDS))

    def apply(d: dict[str, Any]) -> None:
        del walk(d, container)[key]
    return Mutation(f"remove {jpath(container + (key,))}", apply, jpath(container + (key,)))


@st.composite
def duplicate_in_list(draw, list_key: str, field: str) -> Mutation:
    n = len(BASE[list_key])
    i, j = draw(st.lists(st.integers(0, n - 1), min_size=2, max_size=2, unique=True))
    value = BASE[list_key][j][field]
    return Mutation(f"{list_key}[{i}].{field} = {list_key}[{j}].{field} ({value!r})",
                    setter((list_key, i, field), value),
                    jpath((list_key, max(i, j), field)))


@st.composite
def priority_out_of_range(draw) -> Mutation:
    i = draw(st.integers(0, N_CATS - 1))
    value = draw(st.one_of(st.integers(max_value=0), st.integers(min_value=N_CATS + 1)))
    return Mutation(f"categories[{i}].priority = {value}",
                    setter(("categories", i, "priority"), value),
                    jpath(("categories", i, "priority")))


@st.composite
def break_ordering(draw) -> Mutation:
    """Swap the priorities of a category in one primary with one in the next primary."""
    lo, hi = draw(st.sampled_from((("A", "B"), ("B", "C"))))
    i = draw(st.sampled_from([k for k, c in enumerate(BASE["categories"]) if c["id"][0] == lo]))
    j = draw(st.sampled_from([k for k, c in enumerate(BASE["categories"]) if c["id"][0] == hi]))

    def apply(d: dict[str, Any]) -> None:
        a, b = d["categories"][i], d["categories"][j]
        a["priority"], b["priority"] = b["priority"], a["priority"]
    # After the swap, category j holds the smallest priority of its primary and
    # ranks before the lower primary: it is the mutated field the loader names.
    return Mutation(f"swap priority categories[{i}] <-> categories[{j}]", apply,
                    jpath(("categories", j, "priority")))


@st.composite
def retarget_rule(draw) -> Mutation:
    i = draw(st.integers(0, N_RULES - 1))
    target = draw(st.one_of(
        st.sampled_from(("D", "C.2", "C.4")),
        st.text(max_size=8).filter(lambda s: s not in CATEGORY_IDS),
    ))
    return Mutation(f"rules[{i}].category = {target!r}",
                    setter(("rules", i, "category"), target),
                    jpath(("rules", i, "category")))


@st.composite
def bad_confidence(draw) -> Mutation:
    i = draw(st.integers(0, N_RULES - 1))
    value = draw(st.one_of(
        st.floats(max_value=0.0, exclude_max=True, allow_nan=False, allow_infinity=False),
        st.floats(min_value=1.0, exclude_min=True, allow_nan=False, allow_infinity=False),
        st.integers(max_value=-1),
        st.integers(min_value=2),
    ))
    return Mutation(f"rules[{i}].confidence = {value!r}",
                    setter(("rules", i, "confidence"), value),
                    jpath(("rules", i, "confidence")))


@st.composite
def empty_match(draw) -> Mutation:
    i = draw(st.integers(0, N_RULES - 1))
    value = draw(st.sampled_from(({}, {"ignore_case": True}, {"ignore_case": False})))
    return Mutation(f"rules[{i}].match = {value!r}",
                    setter(("rules", i, "match"), value),
                    jpath(("rules", i, "match")))


@st.composite
def bad_checklist_length(draw) -> Mutation:
    n = draw(st.integers(0, 25).filter(lambda k: k != 10))
    items = (BASE["checklist"] + [f"extra item {k}" for k in range(n)])[:n]
    return Mutation(f"checklist length {n}", setter(("checklist",), items), "$.checklist")


@st.composite
def bad_schema_or_version(draw) -> Mutation:
    key = draw(st.sampled_from(("schema", "version")))
    good = SUPPORTED_VERSIONS if key == "version" else frozenset({BASE["schema"]})
    value = draw(st.one_of(
        st.text(max_size=12).filter(lambda s: s not in good),
        st.integers(),
        st.none(),
        st.booleans(),
    ))
    return Mutation(f"{key} = {value!r}", setter((key,), value), jpath((key,)))


NON_PORTABLE_REGEXES = (
    "(?=x)", "(?!x)", "(?<=a)b", "(?:ab)", "(?P<n>a)", "(?i)abc", "(a)\\1", "\\bword",
    "\\Aabc", "a++", "a*+", "caf\u00e9", "\u00fc", "abc\\",
)
NON_COMPILING_REGEXES = ("(", ")", "(ab", "a)|(b", "[a-", "[z-a]", "a{2,1}", "*a", "a**", "")


@st.composite
def bad_regex(draw) -> Mutation:
    i = draw(st.integers(0, N_RULES - 1))
    field = draw(st.sampled_from(("signal", "message")))
    pattern = draw(st.sampled_from(NON_PORTABLE_REGEXES + NON_COMPILING_REGEXES))
    return Mutation(f"rules[{i}].match.{field} = {pattern!r}",
                    setter(("rules", i, "match", field), pattern),
                    jpath(("rules", i, "match", field)))


@st.composite
def required_prompt_optional(draw) -> Mutation:
    name = draw(st.sampled_from(REQUIRED_PROMPTS))
    return Mutation(f"prompts.{name}.optional = true",
                    setter(("prompts", name, "optional"), True),
                    jpath(("prompts", name, "optional")))


@st.composite
def bad_prompt_variable(draw) -> Mutation:
    """Append an undeclared-in-text variable, or a duplicate of a declared one."""
    name = draw(st.sampled_from(PROMPT_NAMES))
    tpl = BASE["prompts"][name]
    present = set(PLACEHOLDER_RE.findall(tpl["text"]))
    choices = [st.text(min_size=1, max_size=20).filter(
        lambda v: v not in present and v not in tpl["variables"])]
    if tpl["variables"]:
        choices.append(st.sampled_from(tpl["variables"]))
    var = draw(st.one_of(*choices))
    j = len(tpl["variables"])
    return Mutation(f"prompts.{name}.variables += [{var!r}]",
                    setter(("prompts", name, "variables"), tpl["variables"] + [var]),
                    jpath(("prompts", name, "variables", j)))


@st.composite
def empty_repair_hint(draw) -> Mutation:
    blank = draw(st.sampled_from(("", " ", "\t", " \n ")))
    container = draw(st.one_of(st.integers(0, N_CATS - 1).map(lambda i: ("categories", i)),
                               st.just(("unmapped",))))
    tokens = container + ("repair_hint",)
    return Mutation(f"{jpath(tokens)} = {blank!r}", setter(tokens, blank), jpath(tokens))


@st.composite
def make_auto_assignable(draw) -> Mutation:
    tokens = draw(st.sampled_from((
        ("primary_types", PT_INDEX["D"], "auto_assignable"),
        ("categories", CAT_INDEX["C.2"], "auto_assignable"),
        ("categories", CAT_INDEX["C.4"], "auto_assignable"),
    )))
    return Mutation(f"{jpath(tokens)} = true", setter(tokens, True), jpath(tokens))


mutations = st.one_of(
    remove_required(),
    duplicate_in_list("categories", "id"),
    duplicate_in_list("categories", "priority"),
    duplicate_in_list("rules", "id"),
    priority_out_of_range(),
    break_ordering(),
    retarget_rule(),
    bad_confidence(),
    empty_match(),
    bad_checklist_length(),
    bad_schema_or_version(),
    bad_regex(),
    required_prompt_optional(),
    bad_prompt_variable(),
    empty_repair_hint(),
    make_auto_assignable(),
)


# ------------------------------------------------------------- fixtures ---

@pytest.fixture(scope="module")
def work_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    return tmp_path_factory.mktemp("taxonomy_def")


def _write(directory: Path, name: str, definition: dict[str, Any]) -> Path:
    path = directory / name
    path.write_text(json.dumps(definition, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


# ----------------------------------------------------------- properties ---

@SETTINGS
@given(mutation=mutations)
def test_property1_every_single_invalid_mutation_is_rejected_naming_file_and_field(
        work_dir: Path, mutation: Mutation) -> None:
    note(mutation.label)
    definition = copy.deepcopy(BASE)
    mutation.apply(definition)
    path = _write(work_dir, "mutated.json", definition)

    with pytest.raises(TaxonomyLoadError) as info:
        load_definition(path)

    err = info.value
    assert err.file == str(path)
    assert err.json_path == mutation.json_path, (mutation.label, err.reason)
    assert err.reason.strip()
    assert str(err) == f"{path}: {mutation.json_path}: {err.reason}"
    # the shared base was not touched by the mutation
    assert BASE == json.loads(DEFINITION_FILE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("indent", [None, 0, 2, 4])
def test_property1_unmutated_definition_loads(work_dir: Path, indent: int | None) -> None:
    path = work_dir / f"base_{indent}.json"
    path.write_text(json.dumps(BASE, ensure_ascii=False, indent=indent), encoding="utf-8")
    definition = load_definition(path)
    assert definition.path == str(path)
    assert tuple(sorted(definition.categories)) == tuple(sorted(CATEGORY_IDS))
    assert len(definition.checklist) == 10
    assert len(definition.rules) == N_RULES


def test_property1_shipped_file_loads() -> None:
    assert load_definition(DEFINITION_FILE).version in SUPPORTED_VERSIONS


def test_mutation_paths_use_loader_path_syntax() -> None:
    # sanity check on the oracle helper, independent of the loader
    assert jpath(("categories", 3, "id")) == "$.categories[3].id"
    assert jpath(("prompts", "lesson", "variables", 4)) == "$.prompts.lesson.variables[4]"
    assert re.fullmatch(r"\$(\.\w+|\[\d+\])*", jpath(("rules", 0, "match", "signal")))
