"""Unit tests for the Taxonomy_Definition loader (tivr/taxonomy_def.py).

Validates: Requirements 7.1, 7.2, 7.3, 7.7
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any, Callable

import pytest

from tivr.taxonomy_def import (
    CATEGORY_IDS,
    TaxonomyDefinition,
    TaxonomyLoadError,
    load_definition,
)

REAL_PATH = Path(__file__).resolve().parents[2] / "shared" / "taxonomy.v1.json"

# Dou et al.'s published checklist, verbatim (trailing spaces are significant).
PUBLISHED_CHECKLIST = (
    "1.1 Bugs due to incorrect syntax structure.",
    "1.2 LLMs only output explanation without code.",
    "2.1 Bugs due to misjudge variable type or misunderstand API usage.",
    "2.2 Bugs due to missing library or incorrectly import library.",
    "2.3 LLMs refer functions or variables without definition.",
    "2.4 Bugs due to out-of-bound access or missing corner case check. ",
    "2.5 LLMs output code with incorrect arguments.",
    "3.1 LLMs misunderstand the problem requirement, lack knowledge to implement, or produce the faulty logic. ",
    "3.2 LLMs output code without any logic or apply incorrect knowledge.",
    "3.3 Bugs due to incorrectly follow input-output format.  ",
)


@pytest.fixture(scope="module")
def real_raw() -> dict[str, Any]:
    return json.loads(REAL_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def definition() -> TaxonomyDefinition:
    return load_definition(REAL_PATH)


# ---- real file ----------------------------------------------------------

def test_real_file_loads(definition: TaxonomyDefinition) -> None:
    assert definition.schema == "maci.taxonomy"
    assert definition.version == "1.0.0"
    assert Path(definition.path) == REAL_PATH


def test_default_path_loads_real_file(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TIVR_TAXONOMY_PATH", raising=False)
    assert Path(load_definition().path).resolve() == REAL_PATH


def test_twelve_categories_in_priority_order(definition: TaxonomyDefinition) -> None:
    assert set(definition.categories) == set(CATEGORY_IDS)
    assert len(definition.categories) == 12
    assert list(definition.categories) == list(definition.priority_order)
    prios = [definition.categories[c].priority for c in definition.priority_order]
    assert prios == list(range(1, 13))
    for cat in definition.categories.values():
        assert cat.repair_hint.strip()
        assert cat.primary == cat.id[0]


def test_priorities_rank_a_before_b_before_c(definition: TaxonomyDefinition) -> None:
    by_primary: dict[str, list[int]] = {"A": [], "B": [], "C": []}
    for cat in definition.categories.values():
        by_primary[cat.primary].append(cat.priority)
    assert max(by_primary["A"]) < min(by_primary["B"])
    assert max(by_primary["B"]) < min(by_primary["C"])
    assert definition.priority(definition.unmapped.id) > 12


def test_primary_d_present_and_untargeted(definition: TaxonomyDefinition) -> None:
    d = definition.primary_types["D"]
    assert d.name == "Ambiguous problem description"
    assert d.auto_assignable is False
    assert d.not_assigned_reason and d.not_assigned_reason.strip()
    assert "D" not in definition.categories
    assert definition.rules
    assert all(rule.category != "D" for rule in definition.rules)
    assert all(rule.category in definition.categories for rule in definition.rules)


def test_checklist_matches_published_text(definition: TaxonomyDefinition) -> None:
    assert len(definition.checklist) == 10
    assert definition.checklist == PUBLISHED_CHECKLIST
    for got, want in zip(definition.checklist, PUBLISHED_CHECKLIST):
        assert got == want, f"{got!r} != {want!r}"
    assert definition.checklist_text() == "\n".join(PUBLISHED_CHECKLIST)


def test_rules_have_compiled_regexes(definition: TaxonomyDefinition) -> None:
    for rule in definition.rules:
        if rule.signal is not None:
            assert rule.signal_re is not None
        if rule.message is not None:
            assert rule.message_re is not None
        assert 0.0 <= rule.confidence <= 1.0


# ---- invalid cases (Req. 7.7) -------------------------------------------

def _load_mutated(tmp_path: Path, raw: dict[str, Any],
                  mutate: Callable[[dict[str, Any]], None]) -> tuple[Path, TaxonomyLoadError]:
    data = copy.deepcopy(raw)
    mutate(data)
    path = tmp_path / "taxonomy.mutated.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    with pytest.raises(TaxonomyLoadError) as info:
        load_definition(path)
    return path, info.value


def _assert_error(err: TaxonomyLoadError, path: Path, json_path: str, reason_part: str) -> None:
    assert err.file == str(path)
    assert err.json_path == json_path
    assert reason_part in err.reason
    assert str(err) == f"{path}: {json_path}: {err.reason}"


def test_missing_required_field(tmp_path: Path, real_raw: dict[str, Any]) -> None:
    path, err = _load_mutated(tmp_path, real_raw,
                              lambda d: d["categories"][3].pop("repair_hint"))
    _assert_error(err, path, "$.categories[3].repair_hint", "required field missing")


def test_duplicate_category_id(tmp_path: Path, real_raw: dict[str, Any]) -> None:
    def mutate(d: dict[str, Any]) -> None:
        d["categories"][1]["id"] = "A.1"
    path, err = _load_mutated(tmp_path, real_raw, mutate)
    _assert_error(err, path, "$.categories[1].id", "duplicate category ID")


def test_duplicate_priority(tmp_path: Path, real_raw: dict[str, Any]) -> None:
    def mutate(d: dict[str, Any]) -> None:
        d["categories"][1]["priority"] = 1
    path, err = _load_mutated(tmp_path, real_raw, mutate)
    _assert_error(err, path, "$.categories[1].priority", "duplicate priority")


def test_rule_targets_d(tmp_path: Path, real_raw: dict[str, Any]) -> None:
    def mutate(d: dict[str, Any]) -> None:
        d["rules"][0]["category"] = "D"
    path, err = _load_mutated(tmp_path, real_raw, mutate)
    _assert_error(err, path, "$.rules[0].category", "primary type D")


def test_rule_targets_undefined_category(tmp_path: Path, real_raw: dict[str, Any]) -> None:
    def mutate(d: dict[str, Any]) -> None:
        d["rules"][2]["category"] = "Z.9"
    path, err = _load_mutated(tmp_path, real_raw, mutate)
    _assert_error(err, path, "$.rules[2].category", "undefined category")


def test_checklist_of_nine(tmp_path: Path, real_raw: dict[str, Any]) -> None:
    path, err = _load_mutated(tmp_path, real_raw, lambda d: d["checklist"].pop())
    _assert_error(err, path, "$.checklist", "exactly 10 items, got 9")


def test_unsupported_version(tmp_path: Path, real_raw: dict[str, Any]) -> None:
    def mutate(d: dict[str, Any]) -> None:
        d["version"] = "2.0.0"
    path, err = _load_mutated(tmp_path, real_raw, mutate)
    _assert_error(err, path, "$.version", "unsupported version")


def test_bad_regex(tmp_path: Path, real_raw: dict[str, Any]) -> None:
    def mutate(d: dict[str, Any]) -> None:
        d["rules"][1]["match"]["signal"] = "(syntax|collection"
    path, err = _load_mutated(tmp_path, real_raw, mutate)
    _assert_error(err, path, "$.rules[1].match.signal", "regex does not compile")


def test_missing_file_names_file(tmp_path: Path) -> None:
    path = tmp_path / "absent.json"
    with pytest.raises(TaxonomyLoadError) as info:
        load_definition(path)
    _assert_error(info.value, path, "$", "file not found")
