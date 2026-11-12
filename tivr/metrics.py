"""
TIVR — paper-aligned repair metrics (design.md §4 "Metrics", Requirements 14, 15).

Every function here is pure: it takes program outcomes, generation entries,
LLM call records, and configuration values, and returns plain JSON-ready
dicts/lists (snake_case keys, no NaN/Infinity). Nothing is read or written.

Conventions
-----------
* ``states`` of a :class:`ProgramOutcome` hold the Hidden_Suite Primary_State
  per iteration: index 0 is the initial candidate (15.2), index i the candidate
  of repair iteration i. A program whose loop ended before iteration k keeps
  its last state for every later iteration (carry-forward, 15.5); metric
  functions apply that rule themselves when ``states`` is shorter than k+1.
* PASS is absorbing: once a program passes it stays passed (14.2, 15.9).
* Rates are ``{"num", "den", "pct"}`` with ``pct`` rounded half-up to one
  decimal place, or ``None`` when ``den == 0`` (14.8, 14.9).
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, localcontext
from typing import Any, Iterable, Mapping, Sequence

from .schemas import UNMAPPED, PrimaryState

SUMMARY_SCHEMA = "tivr.run_summary.v1"
MATRIX_STATES: tuple[str, ...] = PrimaryState.ALL          # ("A", "B", "C", "PASS")
FAILING_STATES: tuple[str, ...] = (PrimaryState.A, PrimaryState.B, PrimaryState.C)
PASS = PrimaryState.PASS


# ---------------------------------------------------------------------------
# Program outcome
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ProgramOutcome:
    """Result of one program's Repair_Loop (one ``programs.jsonl`` line).

    ``unmapped_as_c[i]`` is True only when iteration i's *new* candidate was
    assigned C because none of its findings had primary type A, B, or C
    (15.4); carried-forward iterations must be False so nothing is counted twice.
    """
    task_id: str
    states: tuple[str, ...]
    initial_category: str = UNMAPPED
    unmapped_as_c: tuple[bool, ...] = ()
    iterations_run: int | None = None
    stop_reason: str | None = None
    empty_visible_suite: bool = False

    def __post_init__(self) -> None:
        states = tuple(self.states)
        flags = tuple(bool(f) for f in self.unmapped_as_c)
        object.__setattr__(self, "states", states)
        object.__setattr__(self, "unmapped_as_c", flags)
        if not states:
            raise ValueError(f"{self.task_id}: states must contain the iteration-0 state")
        for s in states:
            if s not in MATRIX_STATES:
                raise ValueError(f"{self.task_id}: unknown primary state {s!r}")
        if states[0] not in FAILING_STATES:
            raise ValueError(f"{self.task_id}: iteration-0 state must be A, B, or C (got {states[0]!r})")
        if PASS in states:
            first = states.index(PASS)
            if any(s != PASS for s in states[first:]):
                raise ValueError(f"{self.task_id}: PASS is absorbing but states leave PASS: {states}")
        if len(flags) > len(states):
            raise ValueError(f"{self.task_id}: unmapped_as_c is longer than states")

    def state_at(self, i: int) -> str:
        """Primary_State at iteration ``i`` with carry-forward past the last state (15.5)."""
        if i < 0:
            raise ValueError("iteration must be >= 0")
        return self.states[min(i, len(self.states) - 1)]

    def first_pass(self) -> int | None:
        """First repair iteration (>= 1) whose candidate passed the Hidden_Suite."""
        return self.states.index(PASS) if PASS in self.states else None

    def passed_by(self, i: int) -> bool:
        """True when the program passed at some iteration 1 <= j <= i (14.1, 14.2)."""
        fp = self.first_pass()
        return fp is not None and fp <= i

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "states": list(self.states),
            "initial_category": self.initial_category,
            "unmapped_as_c": list(self.unmapped_as_c),
            "iterations_run": self.iterations_run,
            "stop_reason": self.stop_reason,
            "empty_visible_suite": self.empty_visible_suite,
        }

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> "ProgramOutcome":
        return cls(
            task_id=d["task_id"],
            states=tuple(d["states"]),
            initial_category=d.get("initial_category", UNMAPPED),
            unmapped_as_c=tuple(d.get("unmapped_as_c", ())),
            iterations_run=d.get("iterations_run"),
            stop_reason=d.get("stop_reason"),
            empty_visible_suite=bool(d.get("empty_visible_suite", False)),
        )


def highest_priority_category(category_ids: Iterable[str], definition: Any) -> str:
    """Highest-priority category of a diagnosis per the Taxonomy_Definition (14.5).

    Returns ``UNMAPPED`` when ``category_ids`` is empty.
    """
    ids = list(category_ids)
    if not ids:
        return UNMAPPED
    return min(ids, key=definition.priority)


# ---------------------------------------------------------------------------
# Rates
# ---------------------------------------------------------------------------

def _round_pct(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def rate(num: int, den: int) -> dict[str, Any]:
    """``{"num", "den", "pct"}``; pct = round-half-up(100*num/den, 1), None when den == 0."""
    for name, v in (("num", num), ("den", den)):
        if isinstance(v, bool) or not isinstance(v, int) or v < 0:
            raise ValueError(f"{name} must be a non-negative integer (got {v!r})")
    if den == 0:
        if num != 0:
            raise ValueError(f"num must be 0 when den is 0 (got {num})")
        return {"num": 0, "den": 0, "pct": None}
    if num > den:
        raise ValueError(f"num ({num}) cannot exceed den ({den})")
    with localcontext() as ctx:
        ctx.prec = 50
        pct = _round_pct(Decimal(100 * num) / Decimal(den))
    return {"num": num, "den": den, "pct": pct}


def _check_k(outcomes: Sequence[ProgramOutcome], k: int) -> None:
    if isinstance(k, bool) or not isinstance(k, int) or k < 1:
        raise ValueError(f"k must be an integer >= 1 (got {k!r})")
    for o in outcomes:
        if len(o.states) > k + 1:
            raise ValueError(f"{o.task_id}: {len(o.states)} states exceed k+1 = {k + 1}")


def rsr(outcomes: Sequence[ProgramOutcome], k: int) -> list[dict[str, Any]]:
    """RSR_i for i = 1..k: programs passing at any j <= i over N (14.1, 14.2)."""
    _check_k(outcomes, k)
    n = len(outcomes)
    return [{"iteration": i, **rate(sum(o.passed_by(i) for o in outcomes), n)}
            for i in range(1, k + 1)]


def conditional_rates(outcomes: Sequence[ProgramOutcome], k: int) -> list[dict[str, Any]]:
    """For i = 2..k: first passes at i over programs not passing after i-1 (14.3)."""
    _check_k(outcomes, k)
    out = []
    for i in range(2, k + 1):
        remaining = [o for o in outcomes if not o.passed_by(i - 1)]
        num = sum(o.first_pass() == i for o in remaining)
        out.append({"iteration": i, **rate(num, len(remaining))})
    return out


def per_primary_type(outcomes: Sequence[ProgramOutcome], k: int) -> list[dict[str, Any]]:
    """For i = 1..k and X in A, B, C: state X at i-1 → PASS at i (14.4).

    Numerator and denominator equal the PASS cell and row total of the
    iteration-i Bug_Evolution_Matrix row X.
    """
    _check_k(outcomes, k)
    out = []
    for i in range(1, k + 1):
        row: dict[str, Any] = {"iteration": i}
        for x in FAILING_STATES:
            start = [o for o in outcomes if o.state_at(i - 1) == x]
            row[x] = rate(sum(o.state_at(i) == PASS for o in start), len(start))
        out.append(row)
    return out


def _repaired(o: ProgramOutcome, k: int | None) -> bool:
    """Passed within k iterations; any recorded iteration when k is None."""
    return o.passed_by(k) if k is not None else o.first_pass() is not None


def _category_ids(categories: Any) -> list[str]:
    """Category IDs in priority order followed by UNMAPPED.

    Accepts a ``TaxonomyDefinition`` or an iterable of category IDs.
    """
    if hasattr(categories, "priority_order"):
        ids = list(categories.priority_order)
        unmapped = getattr(getattr(categories, "unmapped", None), "id", UNMAPPED)
    else:
        ids = [c for c in categories if c != UNMAPPED]
        unmapped = UNMAPPED
    return ids + [unmapped]


def per_category(outcomes: Sequence[ProgramOutcome], categories: Any,
                 k: int | None = None) -> dict[str, dict[str, Any]]:
    """Per-category repair rate over each program's initial top category (14.5).

    Keys are every Taxonomy_Definition category (12) plus ``UNMAPPED``; empty
    categories get ``{"num": 0, "den": 0, "pct": None}`` (14.9). When ``k`` is
    None, a program counts as repaired if it passed at any recorded iteration.
    """
    ids = _category_ids(categories)
    known = set(ids)
    buckets: dict[str, list[ProgramOutcome]] = {c: [] for c in ids}
    for o in outcomes:
        if o.initial_category not in known:
            raise ValueError(f"{o.task_id}: unknown initial category {o.initial_category!r}")
        buckets[o.initial_category].append(o)
    return {c: rate(sum(_repaired(o, k) for o in buckets[c]), len(buckets[c])) for c in ids}


def evolution_matrices(outcomes: Sequence[ProgramOutcome], k: int) -> list[dict[str, Any]]:
    """k Bug_Evolution_Matrices, rows = state at i-1, cols = state at i, order A,B,C,PASS (15.1).

    Row percentages are unrounded so non-zero rows sum to 100 within 0.01;
    zero rows are all ``None`` (15.10).
    """
    _check_k(outcomes, k)
    index = {s: j for j, s in enumerate(MATRIX_STATES)}
    out = []
    for i in range(1, k + 1):
        counts = [[0] * len(MATRIX_STATES) for _ in MATRIX_STATES]
        for o in outcomes:
            counts[index[o.state_at(i - 1)]][index[o.state_at(i)]] += 1
        row_pcts: list[list[float | None]] = []
        for row in counts:
            total = sum(row)
            row_pcts.append([100.0 * c / total for c in row] if total else [None] * len(row))
        out.append({"iteration": i, "states": list(MATRIX_STATES),
                    "counts": counts, "row_percentages": row_pcts})
    return out


def unmapped_as_c_by_iteration(outcomes: Sequence[ProgramOutcome], k: int) -> list[int]:
    """Number of UNMAPPED-only failures assigned C at each iteration 0..k (15.4)."""
    _check_k(outcomes, k)
    return [sum(1 for o in outcomes if i < len(o.unmapped_as_c) and o.unmapped_as_c[i])
            for i in range(k + 1)]


# ---------------------------------------------------------------------------
# pass@1 and cost
# ---------------------------------------------------------------------------

def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _entry_passed(entry: Any) -> bool:
    """Initial Hidden_Suite result of a Generation_Cache entry (dict or object)."""
    hidden = _get(entry, "hidden")
    if hidden is None:
        return bool(_get(entry, "passed", False))
    return bool(_get(hidden, "passed", False))


def pass_at_1(entries: Sequence[Any], outcomes: Sequence[ProgramOutcome],
              k: int | None = None) -> dict[str, dict[str, Any]]:
    """pass@1 before and after repair over all tasks in the dataset (14.6).

    A Repair_Sample task counts as passing after repair if it passed within k
    iterations; every other task keeps its initial Hidden_Suite result.
    """
    by_id = {o.task_id: o for o in outcomes}
    before = after = 0
    for e in entries:
        initial = _entry_passed(e)
        before += initial
        o = by_id.get(_get(e, "task_id"))
        if o is None:
            after += initial
        else:
            after += _repaired(o, k)
    n = len(entries)
    return {"before": rate(before, n), "after": rate(after, n)}


def _has_usage(call: Any) -> bool:
    return _get(call, "prompt_tokens") is not None and _get(call, "completion_tokens") is not None


def cost(calls: Iterable[Any], n: int) -> dict[str, Any]:
    """Repair_Loop LLM cost (14.7, 14.10).

    Only ``phase == "repair"`` calls are counted. Calls without token usage
    count toward ``llm_calls`` and ``calls_without_usage`` but are excluded from
    the token totals (not counted as 0). Token totals are ``None`` when every
    repair call lacks usage. ``per_program`` divides each total by N (``None``
    when N == 0 or the total is ``None``).
    """
    repair = [c for c in calls if _get(c, "phase") == "repair"]
    with_usage = [c for c in repair if _has_usage(c)]
    without = len(repair) - len(with_usage)
    if repair and not with_usage:
        prompt_tokens = completion_tokens = None
    else:
        prompt_tokens = sum(int(_get(c, "prompt_tokens")) for c in with_usage)
        completion_tokens = sum(int(_get(c, "completion_tokens")) for c in with_usage)

    def per(total: int | None) -> float | None:
        return None if total is None or n <= 0 else total / n

    return {
        "llm_calls": len(repair),
        "calls_without_usage": without,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "per_program": {
            "llm_calls": per(len(repair)),
            "prompt_tokens": per(prompt_tokens),
            "completion_tokens": per(completion_tokens),
        },
    }


# ---------------------------------------------------------------------------
# Run_Summary
# ---------------------------------------------------------------------------

def build_summary(outcomes: Sequence[ProgramOutcome], entries: Sequence[Any],
                  calls: Iterable[Any], config: Any, *, run_id: str, definition: Any,
                  dataset_sha256: str, api_host: str | None = None,
                  dataset_path: str | None = None) -> dict[str, Any]:
    """Assemble the Run_Summary (design.md §Data Models "Run_Summary").

    ``config`` is a ``RunConfig`` (or any object with the same attributes);
    ``definition`` is a ``TaxonomyDefinition``; ``entries`` are the
    Generation_Cache entries of every task in the dataset.
    """
    outcomes = list(outcomes)
    k = int(config.k)
    _check_k(outcomes, k)
    decoding = config.decoding
    return {
        "schema": SUMMARY_SCHEMA,
        "run_id": run_id,
        "llm_mode": config.llm_mode,
        "taxonomy_version": definition.version,
        "dataset": {
            "path": dataset_path if dataset_path is not None else str(config.dataset),
            "sha256": dataset_sha256,
            "task_count": len(entries),
        },
        "config": {
            "repair_mode": config.mode,
            "feedback_regime": config.feedback_regime,
            "k": k,
            "model": config.model,
            "api_host": api_host,
            "temperature": decoding.temperature,
            "top_p": decoding.top_p,
            "max_tokens": decoding.max_tokens,
            "generation_prompt_style": config.generation_prompt_style,
            "seed": config.seed,
        },
        "sample": {"requested": config.sample_size, "actual": len(outcomes)},
        "pass_at_1": pass_at_1(entries, outcomes, k),
        "rsr": rsr(outcomes, k),
        "conditional_repair_rate": conditional_rates(outcomes, k),
        "per_primary_type": per_primary_type(outcomes, k),
        "per_category": per_category(outcomes, definition, k),
        "bug_evolution": evolution_matrices(outcomes, k),
        "unmapped_as_c_by_iteration": unmapped_as_c_by_iteration(outcomes, k),
        "empty_visible_suite_programs": sum(1 for o in outcomes if o.empty_visible_suite),
        "cost": cost(calls, len(outcomes)),
    }
