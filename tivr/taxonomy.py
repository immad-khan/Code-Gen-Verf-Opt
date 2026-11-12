"""
TIVR — Taxonomy-guided Iterative Verification and Repair.
taxonomy.py — rule-based mapper from verified findings to Dou et al.'s taxonomy
(design.md §1 "Ordered rules", §2 "TaxonomyMapper").

Every taxonomy value (categories, priorities, repair hints, rules) comes from
the shared Taxonomy_Definition loaded by ``taxonomy_def.load_definition``;
nothing is hard-coded here (Req. 7.5).

Semantics:
* Only blocking (correctness) findings are evaluated. Advisory findings never
  carry a category (Req. 20.2).
* Rules are evaluated in definition order; the first matching rule assigns the
  finding's single category (Req. 7.4, 8.9).
* A blocking finding matching no rule is ``UNMAPPED`` and stays visible in the
  report (Req. 8.8, 9.8, 20.7).
* Diagnoses: one per assigned category, sorted by priority, ``UNMAPPED`` last.
* ``primary_state``: ``PASS`` iff the gate passes; otherwise the primary type of
  the highest-priority category among correctness findings; ``UNMAPPED``-only
  failures become ``C`` flagged as an unmapped-as-C assignment (Req. 15.4).
"""
from __future__ import annotations

import dataclasses
from functools import lru_cache

from .schemas import (
    ADVISORY,
    BLOCKING,
    Diagnosis,
    Finding,
    MappedFinding,
    PrimaryState,
    VerificationReport,
)
from .taxonomy_def import TaxonomyDefinition, load_definition

_FINDING_FIELDS = tuple(f.name for f in dataclasses.fields(Finding))


def _first_line(text: str) -> str:
    return text.splitlines()[0] if text else ""


class TaxonomyMapper:
    """Evaluates the definition's ordered rules against findings."""

    def __init__(self, definition: TaxonomyDefinition):
        self.definition = definition

    # ---- single finding ---------------------------------------------
    def map_finding(self, f: Finding) -> MappedFinding:
        """First matching rule wins; no match -> ``UNMAPPED``; advisory -> no category."""
        base = {name: getattr(f, name) for name in _FINDING_FIELDS}
        if f.severity == ADVISORY:
            return MappedFinding(**base)
        for rule in self.definition.rules:
            if rule.matches(f.technique, f.signal, f.message):
                return MappedFinding(**base, category=rule.category,
                                     rule_id=rule.id, confidence=rule.confidence)
        return MappedFinding(**base, category=self.definition.unmapped.id)

    # ---- whole report -----------------------------------------------
    def map_report(self, report: VerificationReport) -> None:
        """Map every correctness finding in place and rebuild ``report.diagnoses``."""
        report.correctness = [self.map_finding(f) for f in report.correctness]
        report.diagnoses = self.diagnoses(report.correctness)

    def diagnoses(self, findings: list[MappedFinding]) -> list[Diagnosis]:
        """One diagnosis per category among blocking findings, sorted by priority."""
        defn = self.definition
        by_cat: dict[str, Diagnosis] = {}
        for f in findings:
            if f.severity != BLOCKING or f.category is None:
                continue
            d = by_cat.get(f.category)
            if d is None:
                if f.category == defn.unmapped.id:
                    d = Diagnosis(category=f.category, primary=None, secondary=None,
                                  priority=defn.unmapped.priority, confidence=None,
                                  repair_hint=defn.unmapped.repair_hint)
                else:
                    cat = defn.categories[f.category]
                    d = Diagnosis(category=cat.id, primary=cat.primary,
                                  secondary=cat.name, priority=cat.priority,
                                  confidence=f.confidence,
                                  repair_hint=cat.repair_hint)
                d.evidence_summary = f"{f.signal}: {_first_line(f.message)}"
                by_cat[f.category] = d
            elif f.confidence is not None:
                d.confidence = (f.confidence if d.confidence is None
                                else max(d.confidence, f.confidence))
            if f.signal not in d.signals:
                d.signals.append(f.signal)
            if f.rule_id is not None and f.rule_id not in d.rule_ids:
                d.rule_ids.append(f.rule_id)
        return sorted(by_cat.values(), key=lambda d: d.priority)


@lru_cache(maxsize=1)
def default_mapper() -> TaxonomyMapper:
    """Mapper over the default Taxonomy_Definition (loaded once per process)."""
    return TaxonomyMapper(load_definition())


def map_report(report: VerificationReport, definition: TaxonomyDefinition | None = None) -> None:
    """Module-level convenience: map ``report`` in place."""
    mapper = TaxonomyMapper(definition) if definition is not None else default_mapper()
    mapper.map_report(report)


def primary_state(report: VerificationReport,
                  definition: TaxonomyDefinition | None = None) -> tuple[str, bool]:
    """Return ``(state, unmapped_as_c)`` for ``report``.

    ``("PASS", False)`` iff the correctness gate passes. Otherwise the primary
    type of the highest-priority category among the correctness findings
    (advisory findings never count, Req. 20.3). A failure with no A/B/C
    category (UNMAPPED-only, or an incomplete verification with no findings)
    is ``C`` with ``unmapped_as_c=True`` (Req. 15.4).
    """
    if report.gate_passed():
        return PrimaryState.PASS, False
    mapper = TaxonomyMapper(definition) if definition is not None else default_mapper()
    defn = mapper.definition
    best = None
    for f in report.correctness:
        if f.severity != BLOCKING:
            continue
        category = getattr(f, "category", None)
        if category is None:
            category = mapper.map_finding(f).category
        if category == defn.unmapped.id:
            continue
        if best is None or defn.priority(category) < defn.priority(best):
            best = category
    if best is None:
        return defn.unmapped.primary_state, True
    return defn.categories[best].primary, False


__all__ = ["TaxonomyMapper", "default_mapper", "map_report", "primary_state"]
