"""Property-based tests for tivr.metrics: cross-metric consistency, rate
formatting, per-category / pass@1 accounting, cost, and Run_Summary JSON.

Property 10: Cross-metric consistency.
**Validates: Requirements 14.3, 14.4, 15.8, 15.9**

Property 11: Rate and percentage formatting.
**Validates: Requirements 14.8, 14.9, 15.10**

Property 12: Per-category and pass@1 accounting.
**Validates: Requirements 14.5, 14.6**

Property 13: Cost accounting excludes missing usage.
**Validates: Requirements 14.7, 14.10**

Property 16: Run_Summary JSON round trip.
**Validates: Requirements 16.9**

Generated datasets hold M tasks with a random initial Hidden_Suite result. The
Repair_Sample is a random subset of the initially failing tasks; each sampled
program gets a valid state tuple (index 0 failing, PASS absorbing, length
1..k+1 with carry-forward past the end) and a random initial diagnosis (a list
of category IDs, possibly empty). Oracles are computed from the raw data, not
from ProgramOutcome helper methods.
"""
from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tivr.config import ALL_MODES, FEEDBACK_REGIMES, PROMPT_STYLES, Decoding, RunConfig
from tivr.llm_client import CallRecord
from tivr.metrics import (
    ProgramOutcome,
    build_summary,
    conditional_rates,
    cost,
    evolution_matrices,
    highest_priority_category,
    pass_at_1,
    per_category,
    per_primary_type,
    rate,
    rsr,
)
from tivr.taxonomy_def import load_definition

SETTINGS = settings(max_examples=150, deadline=None)

ORDER = ("A", "B", "C", "PASS")
FAILING = ("A", "B", "C")
PASS_IDX = ORDER.index("PASS")

DEFINITION = load_definition()
CATEGORY_IDS = tuple(DEFINITION.priority_order) + (DEFINITION.unmapped.id,)


# ------------------------------------------------------------- generators ---

@st.composite
def program_states(draw, k: int) -> tuple[str, ...]:
    """A valid state tuple of length 1..k+1 with PASS absorbing and index 0 failing."""
    length = draw(st.integers(min_value=1, max_value=k + 1))
    first = draw(st.sampled_from(FAILING))
    if length == 1:
        return (first,)
    n_fail = draw(st.integers(min_value=0, max_value=length - 1))
    fails = draw(st.lists(st.sampled_from(FAILING), min_size=n_fail, max_size=n_fail))
    return (first, *fails, *(["PASS"] * (length - 1 - n_fail)))


@st.composite
def datasets(draw, max_tasks: int = 150):
    """(k, entries, outcomes, diagnoses) with outcomes drawn from failing entries only."""
    k = draw(st.integers(min_value=1, max_value=5))
    m = draw(st.integers(min_value=0, max_value=max_tasks))
    passed = draw(st.lists(st.booleans(), min_size=m, max_size=m))
    entries = [{"task_id": f"T/{j}", "hidden": {"passed": p}} for j, p in enumerate(passed)]
    failing_ids = [e["task_id"] for e in entries if not e["hidden"]["passed"]]
    sample = draw(st.lists(st.sampled_from(failing_ids), unique=True)) if failing_ids else []
    outcomes, diagnoses = [], {}
    for tid in sample:
        diag = draw(st.lists(st.sampled_from(CATEGORY_IDS), max_size=4))
        diagnoses[tid] = diag
        states = draw(program_states(k))
        flags = draw(st.lists(st.booleans(), min_size=0, max_size=len(states)))
        outcomes.append(ProgramOutcome(
            task_id=tid,
            states=states,
            initial_category=highest_priority_category(diag, DEFINITION),
            unmapped_as_c=tuple(flags),
            iterations_run=len(states) - 1,
            stop_reason=draw(st.sampled_from([None, "passed", "k_reached", "llm_error"])),
            empty_visible_suite=draw(st.booleans()),
        ))
    return k, entries, outcomes, diagnoses


def expected_state(states: tuple[str, ...], i: int) -> str:
    return states[i] if i < len(states) else states[-1]


def passed_within(states: tuple[str, ...], i: int) -> bool:
    return any(expected_state(states, j) == "PASS" for j in range(1, i + 1))


def half_up_pct(num: int, den: int) -> float:
    """Oracle: 100*num/den rounded half-up to one decimal, via integer arithmetic."""
    tenths = (2000 * num + den) // (2 * den)   # floor(1000*num/den + 1/2)
    return tenths / 10


def assert_rate(r: dict, num: int, den: int) -> None:
    assert type(r["num"]) is int and type(r["den"]) is int
    assert (r["num"], r["den"]) == (num, den)
    if den == 0:
        assert r["pct"] is None
    else:
        assert r["pct"] == half_up_pct(num, den)


# --------------------------------------------------------------- Property 10 ---

@SETTINGS
@given(datasets())
def test_property10_cross_metric_consistency(case):
    """Feature: paper-aligned-repair-tool, Property 10: Cross-metric consistency."""
    k, _entries, outcomes, _diag = case
    n = len(outcomes)
    mats = evolution_matrices(outcomes, k)
    rsrs = rsr(outcomes, k)
    conds = conditional_rates(outcomes, k)
    ppt = per_primary_type(outcomes, k)

    assert [c["iteration"] for c in conds] == list(range(2, k + 1))
    assert [p["iteration"] for p in ppt] == list(range(1, k + 1))

    for idx, m in enumerate(mats):
        i = idx + 1
        counts = m["counts"]
        # 15.9: PASS is absorbing; at iteration 1 nothing starts in PASS.
        assert counts[PASS_IDX][:3] == [0, 0, 0]
        if i == 1:
            assert counts[PASS_IDX] == [0, 0, 0, 0]
        # 15.8: PASS column / N == RSR_i.
        pass_col = sum(row[PASS_IDX] for row in counts)
        assert rsrs[idx]["num"] == pass_col and rsrs[idx]["den"] == n
        # 14.4: per-primary-type counts equal row totals and PASS cells.
        for x in FAILING:
            r = ORDER.index(x)
            assert ppt[idx][x]["den"] == sum(counts[r])
            assert ppt[idx][x]["num"] == counts[r][PASS_IDX]
            assert_rate(ppt[idx][x], counts[r][PASS_IDX], sum(counts[r]))

    # 14.3: RSR_i = RSR_(i-1) + conditional_i; conditional_i den = N - RSR_(i-1).
    for c in conds:
        i = c["iteration"]
        prev, cur = rsrs[i - 2]["num"], rsrs[i - 1]["num"]
        assert cur == prev + c["num"]
        assert c["den"] == n - prev
        assert_rate(c, c["num"], n - prev)


# --------------------------------------------------------------- Property 11 ---

@SETTINGS
@given(st.integers(min_value=0, max_value=10**7).flatmap(
    lambda den: st.tuples(st.integers(min_value=0, max_value=den), st.just(den))))
def test_property11_rate_formatting(pair):
    """Feature: paper-aligned-repair-tool, Property 11: Rate and percentage formatting."""
    num, den = pair
    r = rate(num, den)
    assert set(r) == {"num", "den", "pct"}
    assert_rate(r, num, den)
    if den:
        # Rounded value is within half a tenth of the exact percentage.
        assert abs(Fraction(r["pct"]).limit_denominator(10) - Fraction(100 * num, den)) <= Fraction(1, 20)
        assert 0.0 <= r["pct"] <= 100.0


def test_property11_half_up_ties():
    """Exact .x5 ties round up (ROUND_HALF_UP), not to even."""
    assert rate(1, 8)["pct"] == 12.5      # 12.5 exactly
    assert rate(1, 16)["pct"] == 6.3      # 6.25 -> 6.3
    assert rate(3, 16)["pct"] == 18.8     # 18.75 -> 18.8
    assert rate(0, 0) == {"num": 0, "den": 0, "pct": None}


@SETTINGS
@given(datasets())
def test_property11_matrix_row_percentages(case):
    """Feature: paper-aligned-repair-tool, Property 11: Rate and percentage formatting (matrix rows)."""
    k, _entries, outcomes, _diag = case
    for m in evolution_matrices(outcomes, k):
        for row, pcts in zip(m["counts"], m["row_percentages"]):
            assert len(pcts) == 4
            if sum(row) == 0:
                assert pcts == [None, None, None, None]
            else:
                assert all(0.0 <= p <= 100.0 for p in pcts)
                assert abs(sum(pcts) - 100.0) <= 0.01
                for c, p in zip(row, pcts):
                    assert abs(p - 100.0 * c / sum(row)) <= 1e-9


# --------------------------------------------------------------- Property 12 ---

def oracle_top_category(diag: list[str]) -> str:
    unmapped = DEFINITION.unmapped.id
    if not diag:
        return unmapped
    rank = {c: j for j, c in enumerate(DEFINITION.priority_order)}
    return min(diag, key=lambda c: rank.get(c, len(rank)))


@SETTINGS
@given(datasets())
def test_property12_per_category_and_pass_at_1(case):
    """Feature: paper-aligned-repair-tool, Property 12: Per-category and pass@1 accounting."""
    k, entries, outcomes, diagnoses = case

    # Each program sits in the category of its highest-priority initial diagnosis.
    for o in outcomes:
        assert o.initial_category == oracle_top_category(diagnoses[o.task_id])

    pc = per_category(outcomes, DEFINITION, k)
    assert list(pc) == list(CATEGORY_IDS)
    for cat in CATEGORY_IDS:
        members = [o for o in outcomes if oracle_top_category(diagnoses[o.task_id]) == cat]
        repaired = sum(passed_within(o.states, k) for o in members)
        assert_rate(pc[cat], repaired, len(members))
    # Each sampled program is counted exactly once.
    assert sum(r["den"] for r in pc.values()) == len(outcomes)

    p1 = pass_at_1(entries, outcomes, k)
    initially = sum(e["hidden"]["passed"] for e in entries)
    repaired_total = sum(passed_within(o.states, k) for o in outcomes)
    assert_rate(p1["before"], initially, len(entries))
    assert_rate(p1["after"], initially + repaired_total, len(entries))


# --------------------------------------------------------------- Property 13 ---

usage = st.one_of(
    st.none(),
    st.tuples(st.integers(min_value=0, max_value=10**6), st.integers(min_value=0, max_value=10**6)),
)
call_records = st.builds(
    lambda phase, u: CallRecord(prompt_tokens=u[0] if u else None,
                                completion_tokens=u[1] if u else None, phase=phase),
    st.sampled_from(["generation", "repair"]),
    usage,
)


@SETTINGS
@given(st.lists(call_records, max_size=60), st.integers(min_value=0, max_value=200))
def test_property13_cost_excludes_missing_usage(calls, n):
    """Feature: paper-aligned-repair-tool, Property 13: Cost accounting excludes missing usage."""
    result = cost(calls, n)
    repair = [c for c in calls if c.phase == "repair"]
    present = [c for c in repair if c.prompt_tokens is not None]

    assert result["llm_calls"] == len(repair)
    assert result["calls_without_usage"] == len(repair) - len(present)
    if repair and not present:
        exp_prompt = exp_completion = None
    else:
        exp_prompt = sum(c.prompt_tokens for c in present)
        exp_completion = sum(c.completion_tokens for c in present)
    assert result["prompt_tokens"] == exp_prompt
    assert result["completion_tokens"] == exp_completion

    per = result["per_program"]
    if n == 0:
        assert per == {"llm_calls": None, "prompt_tokens": None, "completion_tokens": None}
    else:
        assert per["llm_calls"] == len(repair) / n
        assert per["prompt_tokens"] == (None if exp_prompt is None else exp_prompt / n)
        assert per["completion_tokens"] == (None if exp_completion is None else exp_completion / n)


# --------------------------------------------------------------- Property 16 ---

@st.composite
def run_configs(draw, k: int) -> RunConfig:
    return RunConfig(
        dataset=Path(draw(st.sampled_from(["data/humaneval.jsonl", "d.jsonl", "a b/ü.jsonl"]))),
        mode=draw(st.sampled_from(ALL_MODES)),
        enable_intervenor=True,
        feedback_regime=draw(st.sampled_from(FEEDBACK_REGIMES)),
        k=k,
        decoding=Decoding(
            temperature=draw(st.floats(min_value=0.0, max_value=2.0)),
            top_p=draw(st.none() | st.floats(min_value=0.0, max_value=1.0, exclude_min=True)),
            max_tokens=draw(st.none() | st.integers(min_value=1, max_value=100_000)),
        ),
        generation_prompt_style=draw(st.sampled_from(PROMPT_STYLES)),
        sample_size=draw(st.integers(min_value=1, max_value=10_000)),
        seed=draw(st.integers(min_value=0, max_value=2**31 - 1)),
        mock=draw(st.booleans()),
        model=draw(st.text(min_size=1, max_size=20)),
    )


@SETTINGS
@given(st.data())
def test_property16_run_summary_json_round_trip(data):
    """Feature: paper-aligned-repair-tool, Property 16: Run_Summary JSON round trip."""
    k, entries, outcomes, _diag = data.draw(datasets(max_tasks=60))
    config = data.draw(run_configs(k))
    calls = data.draw(st.lists(call_records, max_size=30))
    summary = build_summary(
        outcomes, entries, calls, config,
        run_id=data.draw(st.text(min_size=1, max_size=20)),
        definition=DEFINITION,
        dataset_sha256=data.draw(st.text("0123456789abcdef", min_size=64, max_size=64)),
        api_host=data.draw(st.none() | st.sampled_from(["api.deepseek.com", "localhost:8080"])),
    )
    text = json.dumps(summary, allow_nan=False)   # no NaN/Infinity, every value serializable
    # Strict equality: tuples, Paths, or non-str keys would not survive the trip.
    assert json.loads(text) == summary
    assert json.loads(json.dumps(json.loads(text))) == summary


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-q"]))
