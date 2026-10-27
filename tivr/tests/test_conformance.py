"""Shared taxonomy Conformance_Fixture run against the Python Taxonomy_Mapper.

Fixture: ``shared/taxonomy_conformance.json`` (schema ``maci.taxonomy-conformance``),
also consumed by the C# conformance test so both mappers stay in lockstep.

* ``mapper_cases``: one separately reported test per case ID (Req. 18.7); a
  missing or empty fixture fails the suite. Each case asserts the expected
  category (``"UNMAPPED"`` or ``null`` for advisory findings) and, where the
  case names a rule, that this rule is the one that matched (Req. 7.8).
* Meta-tests: every definition rule has a case, an advisory case exists
  (Req. 7.8), and every criterion of 8.1–8.8, 9.1–9.9 and the 10.9 categories
  appears in some case's ``covers`` (Req. 8.10, 9.10, 10.9).
* ``prompt_cases`` / ``enrichment_cases`` are optional sections; use
  ``optional_case_params`` to parametrize tests over them (an empty section
  yields one skipped test instead of a collection error).

**Validates: Requirements 7.8, 8.10, 9.10, 10.9, 18.7**
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from tivr.schemas import Finding
from tivr.taxonomy import TaxonomyMapper
from tivr.taxonomy_def import load_definition

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "shared" / "taxonomy_conformance.json"
FIXTURE_SCHEMA = "maci.taxonomy-conformance"

# Criteria the fixture must cover (Req. 8.10, 9.10, 10.9).
REQUIRED_CRITERIA = (
    [f"8.{i}" for i in range(1, 9)]
    + [f"9.{i}" for i in range(1, 10)]
    + ["10.2", "10.3", "10.4", "10.6"]
)


def _load_fixture() -> tuple[dict[str, Any] | None, str | None]:
    """Return ``(fixture, error)``; never raises so collection always succeeds."""
    try:
        data = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, f"conformance fixture missing: {FIXTURE_PATH}"
    except (OSError, ValueError) as exc:
        return None, f"conformance fixture unreadable: {FIXTURE_PATH}: {exc}"
    if not isinstance(data, dict):
        return None, f"conformance fixture root must be an object: {FIXTURE_PATH}"
    return data, None


FIXTURE, FIXTURE_ERROR = _load_fixture()


def fixture_cases(section: str) -> list[dict[str, Any]]:
    """Cases in ``section`` (empty when the fixture or section is absent)."""
    if FIXTURE is None:
        return []
    cases = FIXTURE.get(section)
    return cases if isinstance(cases, list) else []


def _case_id(case: Any, index: int) -> str:
    return str(case.get("id")) if isinstance(case, dict) and case.get("id") else f"case-{index}"


def optional_case_params(section: str) -> list[Any]:
    """Params for an optional section; one skipped param when it is empty."""
    cases = fixture_cases(section)
    if not cases:
        return [pytest.param(None, id=f"{section}-empty",
                             marks=pytest.mark.skip(reason=f"no {section} in fixture"))]
    return [pytest.param(c, id=_case_id(c, i)) for i, c in enumerate(cases)]


def _mapper_case_params() -> list[Any]:
    """Params for ``mapper_cases``; a single failing param when missing/empty."""
    cases = fixture_cases("mapper_cases")
    if not cases:
        reason = FIXTURE_ERROR or f"conformance fixture has zero mapper_cases: {FIXTURE_PATH}"
        return [pytest.param(reason, id="fixture-missing-or-empty")]
    return [pytest.param(c, id=_case_id(c, i)) for i, c in enumerate(cases)]


@pytest.fixture(scope="module")
def mapper() -> TaxonomyMapper:
    return TaxonomyMapper(load_definition())


def _finding(case: dict[str, Any]) -> Finding:
    f = case["finding"]
    return Finding(technique=f["technique"], severity=f["severity"], signal=f["signal"],
                   message=f["message"], evidence=f.get("evidence", ""))


# ---------------------------------------------------------------------------
# Fixture shape
# ---------------------------------------------------------------------------

def test_fixture_present_and_well_formed() -> None:
    assert FIXTURE is not None, FIXTURE_ERROR
    assert FIXTURE.get("schema") == FIXTURE_SCHEMA
    assert FIXTURE.get("taxonomy_version") == load_definition().version
    for section in ("mapper_cases", "prompt_cases", "enrichment_cases"):
        assert isinstance(FIXTURE.get(section, []), list), f"{section} must be a list"
    assert fixture_cases("mapper_cases"), "conformance fixture has zero mapper_cases"
    ids = [c.get("id") for c in fixture_cases("mapper_cases")]
    assert len(ids) == len(set(ids)), "mapper_cases IDs must be unique"


# ---------------------------------------------------------------------------
# One test per mapper case (Req. 18.7)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("case", _mapper_case_params())
def test_mapper_case(case: Any, mapper: TaxonomyMapper) -> None:
    if isinstance(case, str):  # sentinel: fixture missing or empty
        pytest.fail(case)
    actual = mapper.map_finding(_finding(case))
    expected = case["expected"]
    assert actual.category == expected, (
        f"case {case['id']}: expected {expected!r}, actual {actual.category!r} "
        f"(rule {actual.rule_id!r})"
    )
    # Cases name the rule that must fire; null for UNMAPPED and advisory cases.
    assert actual.rule_id == case.get("rule"), (
        f"case {case['id']}: expected rule {case.get('rule')!r}, actual rule {actual.rule_id!r}"
    )


# ---------------------------------------------------------------------------
# Meta-tests on fixture coverage
# ---------------------------------------------------------------------------

def test_every_rule_has_a_case() -> None:
    covered = {c.get("rule") for c in fixture_cases("mapper_cases")}
    missing = [r.id for r in load_definition().rules if r.id not in covered]
    assert not missing, f"rules without a conformance case: {missing}"


def test_advisory_case_exists() -> None:
    advisory = [c["id"] for c in fixture_cases("mapper_cases")
                if c["finding"]["severity"] == "advisory" and c["expected"] is None]
    assert advisory, "fixture needs an advisory case expecting no category"


def test_every_required_criterion_is_covered() -> None:
    covered = {cr for c in fixture_cases("mapper_cases") for cr in c.get("covers", [])}
    missing = [cr for cr in REQUIRED_CRITERIA if cr not in covered]
    assert not missing, f"criteria without a conformance case: {missing}"
