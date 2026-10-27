"""
TIVR — Taxonomy-guided Iterative Verification and Repair.
taxonomy_def.py — loader for the shared Taxonomy_Definition (design.md §1).

The definition file (``shared/taxonomy.v1.json``) is the single source of
truth for categories, priority ranks, repair hints, Dou's checklist, mapping
rules, Dou feedback strings and prompt templates (Req. 7.5). This module
reads it, validates it in the fixed order of design §1 "Loader validation",
and exposes an immutable ``TaxonomyDefinition``.

Validation order (first failure wins, reported as
``<file>: <json-path>: <reason>``):

1. file missing / unreadable / invalid JSON
2. ``schema == "maci.taxonomy"`` and supported ``version``
3. required fields present with correct types
4. exactly the 12 category IDs A.1–C.4, unique; priorities a permutation of
   1..12 with max(A) < min(B) and max(B) < min(C)
5. primary types A–D present; D, C.2, C.4 not auto-assignable with a
   non-empty reason; all repair hints non-empty
6. checklist has exactly 10 items
7. each rule: unique ID, defined auto-assignable target (never D),
   confidence in [0, 1], at least one condition, regexes compile
8. all non-optional prompt templates present; declared variables appear in
   their text

Nothing is returned unless every step passes (Req. 7.7).

Rule match semantics: every present condition must hold. ``technique`` is a
set of allowed techniques, ``signal`` is a full match (``\\A(?:p)\\Z``),
``message`` is a search, case-insensitive when ``ignore_case`` is true.
"""
from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

ENV_VAR = "TIVR_TAXONOMY_PATH"
SCHEMA_ID = "maci.taxonomy"
SUPPORTED_VERSIONS = frozenset({"1.0.0"})

CATEGORY_IDS = ("A.1", "A.2", "A.3",
                "B.1", "B.2", "B.3", "B.4", "B.5",
                "C.1", "C.2", "C.3", "C.4")
PRIMARY_IDS = ("A", "B", "C", "D")
CATEGORY_PRIMARIES = ("A", "B", "C")          # primaries that own categories
NOT_AUTO_ASSIGNABLE = ("C.2", "C.4")          # Req. 10.7, 10.8
NOT_AUTO_PRIMARY = "D"                        # Req. 7.2
CHECKLIST_LENGTH = 10                         # Req. 7.3
DOU_FEEDBACK_KEYS = ("functional", "timeout", "no_code")
REQUIRED_PROMPTS = (
    "dou_generation", "tivr_generation", "dou_critique", "tivr_repair",
    "generic_repair", "diagnosis_line", "guidance_line", "evidence_line",
    "lessons_header", "lesson", "web_repair_system",
)
MATCH_KEYS = frozenset({"technique", "signal", "message", "ignore_case"})

# Same placeholder grammar as the template renderer (design §1).
PLACEHOLDER_RE = re.compile(r"\{([^{}\r\n]+)\}")

_DEFAULT_PATH = Path(__file__).resolve().parent.parent / "shared" / "taxonomy.v1.json"


# ---- errors -----------------------------------------------------------

class TaxonomyLoadError(Exception):
    """The definition file is missing, unreadable, or invalid (Req. 7.7)."""

    def __init__(self, file: str | os.PathLike[str], json_path: str, reason: str):
        self.file = str(file)
        self.json_path = json_path
        self.reason = reason
        super().__init__(f"{self.file}: {json_path}: {reason}")


# ---- immutable model --------------------------------------------------

@dataclass(frozen=True)
class PrimaryType:
    id: str
    name: str
    auto_assignable: bool
    not_assigned_reason: str | None = None


@dataclass(frozen=True)
class Category:
    id: str
    primary: str
    name: str
    priority: int
    auto_assignable: bool
    repair_hint: str
    not_assigned_reason: str | None = None


@dataclass(frozen=True)
class UnmappedCategory:
    id: str
    name: str
    priority: int
    primary_state: str
    repair_hint: str


@dataclass(frozen=True)
class Rule:
    """One declarative mapping rule with its regexes compiled."""
    id: str
    category: str
    confidence: float
    covers: tuple[str, ...]
    technique: frozenset[str] | None
    signal: str | None              # source pattern
    message: str | None             # source pattern
    ignore_case: bool
    signal_re: re.Pattern[str] | None    # \A(?:p)\Z  (full match)
    message_re: re.Pattern[str] | None   # p, re.I if ignore_case (search)

    def signal_matches(self, signal: str) -> bool:
        return self.signal_re is None or self.signal_re.match(signal) is not None

    def message_matches(self, message: str) -> bool:
        return self.message_re is None or self.message_re.search(message) is not None

    def technique_matches(self, technique: str) -> bool:
        return self.technique is None or technique in self.technique

    def matches(self, technique: str, signal: str, message: str) -> bool:
        """True when every present condition holds."""
        return (self.technique_matches(technique)
                and self.signal_matches(signal)
                and self.message_matches(message))


@dataclass(frozen=True)
class PromptTemplate:
    name: str
    variables: tuple[str, ...]
    text: str
    optional: bool = False


@dataclass(frozen=True)
class TaxonomyDefinition:
    path: str
    schema: str
    version: str
    primary_types: Mapping[str, PrimaryType]
    categories: Mapping[str, Category]          # insertion order == priority order
    priority_order: tuple[str, ...]             # A.1 ... C.4 by priority (no UNMAPPED)
    unmapped: UnmappedCategory
    checklist: tuple[str, ...]
    rules: tuple[Rule, ...]
    dou_feedback: Mapping[str, str]
    prompts: Mapping[str, PromptTemplate]

    def priority(self, category_id: str) -> int:
        """Priority rank; ``UNMAPPED`` ranks below every category."""
        if category_id == self.unmapped.id:
            return self.unmapped.priority
        return self.categories[category_id].priority

    def checklist_text(self) -> str:
        """Checklist joined with ``"\\n"`` (trailing spaces preserved)."""
        return "\n".join(self.checklist)

    def prompt(self, name: str) -> PromptTemplate:
        return self.prompts[name]


# ---- loading ----------------------------------------------------------

def resolve_path(path: str | os.PathLike[str] | None = None) -> Path:
    """Explicit path, else ``TIVR_TAXONOMY_PATH``, else ``<repo>/shared/taxonomy.v1.json``."""
    if path is not None:
        return Path(path)
    env = os.environ.get(ENV_VAR, "").strip()
    if env:
        return Path(env)
    return _DEFAULT_PATH


def load_definition(path: str | os.PathLike[str] | None = None) -> TaxonomyDefinition:
    """Load and validate the definition; raise ``TaxonomyLoadError`` on the first failure."""
    file = resolve_path(path)
    return _Validator(str(file)).run(file)


# ---- validation -------------------------------------------------------

class _DuplicateKey(ValueError):
    pass


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise _DuplicateKey(f"duplicate JSON object key {key!r}")
        out[key] = value
    return out


def _reject_constant(name: str) -> Any:
    raise ValueError(f"non-standard JSON constant {name}")


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


_TYPE_NAMES = {str: "a string", bool: "a boolean", list: "an array",
               dict: "an object", int: "an integer", float: "a number"}

_ALLOWED_CLASS_ESCAPES = frozenset("dswDSW")


def check_regex_subset(pattern: str) -> str | None:
    """Return a reason if ``pattern`` leaves the portable regex subset, else None.

    Allowed: ASCII literals, character classes, ``\\d \\s \\w`` (and their
    negations), escaped punctuation, groups, alternation, ``? * +``,
    ``{m,n}``. Rejected: lookaround, named/non-capturing groups and inline
    flags (any ``(?``), backreferences and other letter/digit escapes,
    possessive quantifiers, non-ASCII characters.
    """
    i, n = 0, len(pattern)
    in_class = False
    class_start = -1
    prev_quant = False
    while i < n:
        c = pattern[i]
        if ord(c) > 127:
            return f"non-ASCII character {c!r} at offset {i}"
        if c == "\\":
            if i + 1 >= n:
                return "trailing backslash"
            e = pattern[i + 1]
            if ord(e) > 127:
                return f"non-ASCII character {e!r} at offset {i + 1}"
            if e.isalnum() and e not in _ALLOWED_CLASS_ESCAPES:
                return f"unsupported escape '\\{e}' at offset {i}"
            i += 2
            prev_quant = False
            continue
        if in_class:
            # ']' directly after '[' or '[^' is a literal in both engines
            if c == "]" and i > class_start:
                in_class = False
            i += 1
            continue
        if c == "[":
            in_class = True
            class_start = i + 1
            if class_start < n and pattern[class_start] == "^":
                class_start += 1
            i += 1
            prev_quant = False
            continue
        if c == "(" and i + 1 < n and pattern[i + 1] == "?":
            return f"unsupported group construct '(?' at offset {i}"
        if c == "+" and prev_quant:
            return f"possessive quantifier at offset {i}"
        prev_quant = c in "*+?}"
        if c == "?" and i > 0 and pattern[i - 1] in "*+?}":
            prev_quant = False  # lazy marker, not a quantifier itself
        i += 1
    return None


class _Validator:
    def __init__(self, file: str):
        self.file = file

    def fail(self, json_path: str, reason: str) -> TaxonomyLoadError:
        return TaxonomyLoadError(self.file, json_path, reason)

    # -- step 3 helpers ------------------------------------------------
    def req(self, obj: dict, key: str, typ: type, path: str) -> Any:
        p = f"{path}.{key}"
        if key not in obj:
            raise self.fail(p, "required field missing")
        return self.typed(obj[key], typ, p)

    def opt(self, obj: dict, key: str, typ: type, path: str) -> Any:
        if key not in obj or obj[key] is None:
            return None
        return self.typed(obj[key], typ, f"{path}.{key}")

    def typed(self, value: Any, typ: type, path: str) -> Any:
        ok = (_is_int(value) if typ is int else
              _is_number(value) if typ is float else
              isinstance(value, typ))
        if not ok:
            raise self.fail(path, f"must be {_TYPE_NAMES[typ]}")
        return value

    def str_list(self, obj: dict, key: str, path: str, required: bool = True) -> list[str] | None:
        items = self.req(obj, key, list, path) if required else self.opt(obj, key, list, path)
        if items is None:
            return None
        for i, item in enumerate(items):
            self.typed(item, str, f"{path}.{key}[{i}]")
        return items

    def obj_list(self, root: dict, key: str) -> list[dict]:
        items = self.req(root, key, list, "$")
        for i, item in enumerate(items):
            self.typed(item, dict, f"$.{key}[{i}]")
        return items

    # -- driver --------------------------------------------------------
    def run(self, file: Path) -> TaxonomyDefinition:
        root = self.step1_read(file)
        self.step2_schema_version(root)
        self.step3_types(root)
        self.step4_categories(root)
        self.step5_primaries_and_hints(root)
        self.step6_checklist(root)
        rules = self.step7_rules(root)
        prompts = self.step8_prompts(root)
        return self.build(root, rules, prompts)

    # -- step 1 --------------------------------------------------------
    def step1_read(self, file: Path) -> dict:
        try:
            raw = file.read_bytes()
        except FileNotFoundError:
            raise self.fail("$", "file not found") from None
        except OSError as exc:
            raise self.fail("$", f"file unreadable: {exc.strerror or exc}") from None
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise self.fail("$", f"file is not valid UTF-8: {exc.reason}") from None
        try:
            root = json.loads(text, object_pairs_hook=_no_duplicate_keys,
                              parse_constant=_reject_constant)
        except json.JSONDecodeError as exc:
            raise self.fail("$", f"invalid JSON: {exc.msg} at line {exc.lineno} column {exc.colno}") from None
        except ValueError as exc:
            raise self.fail("$", f"invalid JSON: {exc}") from None
        if not isinstance(root, dict):
            raise self.fail("$", "root must be a JSON object")
        return root

    # -- step 2 --------------------------------------------------------
    def step2_schema_version(self, root: dict) -> None:
        schema = self.req(root, "schema", str, "$")
        if schema != SCHEMA_ID:
            raise self.fail("$.schema", f"expected {SCHEMA_ID!r}, got {schema!r}")
        version = self.req(root, "version", str, "$")
        if version not in SUPPORTED_VERSIONS:
            raise self.fail("$.version", f"unsupported version {version!r} "
                            f"(supported: {', '.join(sorted(SUPPORTED_VERSIONS))})")

    # -- step 3 --------------------------------------------------------
    def step3_types(self, root: dict) -> None:
        self.opt(root, "source", str, "$")

        for i, pt in enumerate(self.obj_list(root, "primary_types")):
            p = f"$.primary_types[{i}]"
            self.req(pt, "id", str, p)
            self.req(pt, "name", str, p)
            self.req(pt, "auto_assignable", bool, p)
            self.opt(pt, "not_assigned_reason", str, p)

        for i, cat in enumerate(self.obj_list(root, "categories")):
            p = f"$.categories[{i}]"
            self.req(cat, "id", str, p)
            self.req(cat, "primary", str, p)
            self.req(cat, "name", str, p)
            self.req(cat, "priority", int, p)
            self.req(cat, "auto_assignable", bool, p)
            self.req(cat, "repair_hint", str, p)
            self.opt(cat, "not_assigned_reason", str, p)

        unmapped = self.req(root, "unmapped", dict, "$")
        self.req(unmapped, "id", str, "$.unmapped")
        self.req(unmapped, "name", str, "$.unmapped")
        self.req(unmapped, "priority", int, "$.unmapped")
        self.req(unmapped, "primary_state", str, "$.unmapped")
        self.req(unmapped, "repair_hint", str, "$.unmapped")

        self.str_list(root, "checklist", "$")

        for i, rule in enumerate(self.obj_list(root, "rules")):
            p = f"$.rules[{i}]"
            self.req(rule, "id", str, p)
            match = self.req(rule, "match", dict, p)
            mp = f"{p}.match"
            for key in match:
                if key not in MATCH_KEYS:
                    raise self.fail(f"{mp}.{key}", "unknown match condition "
                                    f"(allowed: {', '.join(sorted(MATCH_KEYS))})")
            self.str_list(match, "technique", mp, required=False)
            self.opt(match, "signal", str, mp)
            self.opt(match, "message", str, mp)
            self.opt(match, "ignore_case", bool, mp)
            self.req(rule, "category", str, p)
            self.req(rule, "confidence", float, p)
            self.str_list(rule, "covers", p, required=False)

        fb = self.req(root, "dou_feedback", dict, "$")
        for key in DOU_FEEDBACK_KEYS:
            self.req(fb, key, str, "$.dou_feedback")
        for key, value in fb.items():
            self.typed(value, str, f"$.dou_feedback.{key}")

        prompts = self.req(root, "prompts", dict, "$")
        for name, tpl in prompts.items():
            p = f"$.prompts.{name}"
            self.typed(tpl, dict, p)
            self.str_list(tpl, "variables", p)
            self.req(tpl, "text", str, p)
            self.opt(tpl, "optional", bool, p)

    # -- step 4 --------------------------------------------------------
    def step4_categories(self, root: dict) -> None:
        cats = root["categories"]
        seen: set[str] = set()
        for i, cat in enumerate(cats):
            cid = cat["id"]
            if cid in seen:
                raise self.fail(f"$.categories[{i}].id", f"duplicate category ID {cid!r}")
            if cid not in CATEGORY_IDS:
                raise self.fail(f"$.categories[{i}].id", f"unknown category ID {cid!r} "
                                "(expected exactly A.1-A.3, B.1-B.5, C.1-C.4)")
            seen.add(cid)
        missing = [c for c in CATEGORY_IDS if c not in seen]
        if missing:
            raise self.fail("$.categories", f"missing category IDs: {', '.join(missing)}")

        prios: dict[int, str] = {}
        for i, cat in enumerate(cats):
            pr = cat["priority"]
            if not 1 <= pr <= len(CATEGORY_IDS):
                raise self.fail(f"$.categories[{i}].priority",
                                f"priority {pr} outside 1..{len(CATEGORY_IDS)}")
            if pr in prios:
                raise self.fail(f"$.categories[{i}].priority",
                                f"duplicate priority {pr} (also used by {prios[pr]})")
            prios[pr] = cat["id"]

        by_primary: dict[str, list[int]] = {p: [] for p in CATEGORY_PRIMARIES}
        for cat in cats:
            by_primary[cat["id"][0]].append(cat["priority"])
        for lo, hi in (("A", "B"), ("B", "C")):
            if max(by_primary[lo]) >= min(by_primary[hi]):
                offender = next(i for i, c in enumerate(cats)
                                if c["id"][0] == hi and c["priority"] == min(by_primary[hi]))
                raise self.fail(f"$.categories[{offender}].priority",
                                f"every {lo} category must rank before every {hi} category")

        um = root["unmapped"]
        if um["id"] in seen:
            raise self.fail("$.unmapped.id", f"unmapped ID {um['id']!r} collides with a category ID")
        if um["priority"] <= len(CATEGORY_IDS):
            raise self.fail("$.unmapped.priority",
                            f"must rank below every category (> {len(CATEGORY_IDS)})")
        if um["primary_state"] not in CATEGORY_PRIMARIES:
            raise self.fail("$.unmapped.primary_state",
                            f"must be one of {', '.join(CATEGORY_PRIMARIES)}")

    # -- step 5 --------------------------------------------------------
    def step5_primaries_and_hints(self, root: dict) -> None:
        pts = root["primary_types"]
        seen: dict[str, int] = {}
        for i, pt in enumerate(pts):
            if pt["id"] in seen:
                raise self.fail(f"$.primary_types[{i}].id", f"duplicate primary type {pt['id']!r}")
            if pt["id"] not in PRIMARY_IDS:
                raise self.fail(f"$.primary_types[{i}].id", f"unknown primary type {pt['id']!r}")
            if not pt["name"].strip():
                raise self.fail(f"$.primary_types[{i}].name", "must be non-empty")
            seen[pt["id"]] = i
        missing = [p for p in PRIMARY_IDS if p not in seen]
        if missing:
            raise self.fail("$.primary_types", f"missing primary types: {', '.join(missing)}")
        for i, pt in enumerate(pts):
            must_be_manual = pt["id"] == NOT_AUTO_PRIMARY
            self._check_assignability(pt, f"$.primary_types[{i}]", must_be_manual)

        for i, cat in enumerate(root["categories"]):
            p = f"$.categories[{i}]"
            if cat["primary"] != cat["id"][0]:
                raise self.fail(f"{p}.primary",
                                f"category {cat['id']} must belong to primary {cat['id'][0]!r}")
            if not cat["name"].strip():
                raise self.fail(f"{p}.name", "must be non-empty")
            self._check_assignability(cat, p, cat["id"] in NOT_AUTO_ASSIGNABLE)
            if not cat["repair_hint"].strip():
                raise self.fail(f"{p}.repair_hint", "repair hint must be non-empty")

        um = root["unmapped"]
        if not um["repair_hint"].strip():
            raise self.fail("$.unmapped.repair_hint", "repair hint must be non-empty")

    def _check_assignability(self, entry: dict, path: str, must_be_manual: bool) -> None:
        if must_be_manual and entry["auto_assignable"]:
            raise self.fail(f"{path}.auto_assignable",
                            f"{entry['id']} must not be automatically assignable")
        if not entry["auto_assignable"]:
            reason = entry.get("not_assigned_reason")
            if reason is None:
                raise self.fail(f"{path}.not_assigned_reason", "required field missing")
            if not reason.strip():
                raise self.fail(f"{path}.not_assigned_reason", "reason must be non-empty")

    # -- step 6 --------------------------------------------------------
    def step6_checklist(self, root: dict) -> None:
        n = len(root["checklist"])
        if n != CHECKLIST_LENGTH:
            raise self.fail("$.checklist", f"must contain exactly {CHECKLIST_LENGTH} items, got {n}")

    # -- step 7 --------------------------------------------------------
    def step7_rules(self, root: dict) -> tuple[Rule, ...]:
        cats = {c["id"]: c for c in root["categories"]}
        seen: set[str] = set()
        rules: list[Rule] = []
        for i, r in enumerate(root["rules"]):
            p = f"$.rules[{i}]"
            rid = r["id"]
            if not rid.strip():
                raise self.fail(f"{p}.id", "rule ID must be non-empty")
            if rid in seen:
                raise self.fail(f"{p}.id", f"duplicate rule ID {rid!r}")
            seen.add(rid)

            target = r["category"]
            if target == NOT_AUTO_PRIMARY:
                raise self.fail(f"{p}.category", "rule must not target primary type D")
            if target not in cats:
                raise self.fail(f"{p}.category", f"rule targets undefined category {target!r}")
            if not cats[target]["auto_assignable"]:
                raise self.fail(f"{p}.category",
                                f"rule targets {target!r}, which is not automatically assignable")

            conf = r["confidence"]
            if not (math.isfinite(conf) and 0.0 <= conf <= 1.0):
                raise self.fail(f"{p}.confidence", f"confidence {conf!r} outside [0, 1]")

            match = r["match"]
            technique = match.get("technique")
            signal = match.get("signal")
            message = match.get("message")
            ignore_case = bool(match.get("ignore_case") or False)
            if technique is None and signal is None and message is None:
                raise self.fail(f"{p}.match", "rule needs at least one of technique, signal, message")
            if technique is not None and not technique:
                raise self.fail(f"{p}.match.technique", "technique list must be non-empty")

            signal_re = self._compile(signal, f"{p}.match.signal", full=True, flags=0)
            message_re = self._compile(message, f"{p}.match.message", full=False,
                                       flags=re.IGNORECASE if ignore_case else 0)
            rules.append(Rule(
                id=rid, category=target, confidence=float(conf),
                covers=tuple(r.get("covers") or ()),
                technique=frozenset(technique) if technique is not None else None,
                signal=signal, message=message, ignore_case=ignore_case,
                signal_re=signal_re, message_re=message_re,
            ))
        return tuple(rules)

    def _compile(self, pattern: str | None, path: str, *, full: bool, flags: int) -> re.Pattern[str] | None:
        if pattern is None:
            return None
        if pattern == "":
            raise self.fail(path, "pattern must be non-empty")
        bad = check_regex_subset(pattern)
        if bad:
            raise self.fail(path, f"regex outside the portable subset: {bad}")
        try:
            re.compile(pattern, flags)
            return re.compile(rf"\A(?:{pattern})\Z", flags) if full else re.compile(pattern, flags)
        except re.error as exc:
            raise self.fail(path, f"regex does not compile: {exc}") from None

    # -- step 8 --------------------------------------------------------
    def step8_prompts(self, root: dict) -> dict[str, PromptTemplate]:
        prompts = root["prompts"]
        for name in REQUIRED_PROMPTS:
            if name not in prompts:
                raise self.fail(f"$.prompts.{name}", "required prompt template missing")
            if prompts[name].get("optional"):
                raise self.fail(f"$.prompts.{name}.optional", "required template cannot be optional")
        out: dict[str, PromptTemplate] = {}
        for name, tpl in prompts.items():
            p = f"$.prompts.{name}"
            variables = tpl["variables"]
            present = set(PLACEHOLDER_RE.findall(tpl["text"]))
            seen: set[str] = set()
            for j, var in enumerate(variables):
                if var in seen:
                    raise self.fail(f"{p}.variables[{j}]", f"duplicate variable {var!r}")
                seen.add(var)
                if var not in present:
                    raise self.fail(f"{p}.variables[{j}]",
                                    f"declared variable {{{var}}} does not appear in the text")
            out[name] = PromptTemplate(name=name, variables=tuple(variables),
                                       text=tpl["text"], optional=bool(tpl.get("optional")))
        return out

    # -- build ---------------------------------------------------------
    def build(self, root: dict, rules: tuple[Rule, ...],
              prompts: dict[str, PromptTemplate]) -> TaxonomyDefinition:
        primaries = {pt["id"]: PrimaryType(pt["id"], pt["name"], pt["auto_assignable"],
                                           pt.get("not_assigned_reason"))
                     for pt in sorted(root["primary_types"], key=lambda x: x["id"])}
        ordered = sorted(root["categories"], key=lambda c: c["priority"])
        categories = {c["id"]: Category(c["id"], c["primary"], c["name"], c["priority"],
                                        c["auto_assignable"], c["repair_hint"],
                                        c.get("not_assigned_reason"))
                      for c in ordered}
        um = root["unmapped"]
        return TaxonomyDefinition(
            path=self.file,
            schema=root["schema"],
            version=root["version"],
            primary_types=MappingProxyType(primaries),
            categories=MappingProxyType(categories),
            priority_order=tuple(categories),
            unmapped=UnmappedCategory(um["id"], um["name"], um["priority"],
                                      um["primary_state"], um["repair_hint"]),
            checklist=tuple(root["checklist"]),
            rules=rules,
            dou_feedback=MappingProxyType({k: root["dou_feedback"][k] for k in root["dou_feedback"]}),
            prompts=MappingProxyType(prompts),
        )


__all__ = [
    "ENV_VAR", "SUPPORTED_VERSIONS", "CATEGORY_IDS", "REQUIRED_PROMPTS",
    "TaxonomyLoadError", "TaxonomyDefinition", "PrimaryType", "Category",
    "UnmappedCategory", "Rule", "PromptTemplate",
    "load_definition", "resolve_path", "check_regex_subset",
]
