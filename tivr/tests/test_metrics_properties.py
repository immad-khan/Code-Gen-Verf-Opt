"""Property-based tests for tivr.metrics RSR and Bug_Evolution_Matrices.

Property 8: RSR is bounded and monotone.
**Validates: Requirements 14.1, 14.2, 18.8**

Property 9: Evolution matrices conserve programs and chain marginals.
**Validates: Requirements 15.1, 15.5, 15.6, 15.7, 18.11**

Generated outcome sets use a random k (1-5) and N (0-150) programs. Each
program's ``states`` starts with A/B/C, PASS is absorbing, and the tuple may
be shorter than k+1 (the loop ended early; metrics carry the last state
forward). Expected values are computed here from the raw tuples, independently
of ProgramOutcome's helper methods.
"""
from __future__ import annotations

from collections import Counter

from hypothesis import given, settings
from hypothesis import strategies as st

from tivr.metrics import ProgramOutcome, evolution_matrices, rsr

SETTINGS = settings(max_examples=150, deadline=None)

ORDER = ("A", "B", "C", "PASS")
FAILING = ("A", "B", "C")


@st.composite
def program_states(draw, k: int) -> tuple[str, ...]:
    """A valid state tuple of length 1..k+1 with PASS absorbing and index 0 failing."""
    length = draw(st.integers(min_value=1, max_value=k + 1))
    first = draw(st.sampled_from(FAILING))
    if length == 1:
        return (first,)
    # Number of failing repair iterations before an optional PASS run.
    n_fail = draw(st.integers(min_value=0, max_value=length - 1))
    fails = draw(st.lists(st.sampled_from(FAILING), min_size=n_fail, max_size=n_fail))
    return (first, *fails, *(["PASS"] * (length - 1 - n_fail)))


@st.composite
def outcome_sets(draw) -> tuple[int, list[ProgramOutcome]]:
    k = draw(st.integers(min_value=1, max_value=5))
    n = draw(st.integers(min_value=0, max_value=150))
    outcomes = [ProgramOutcome(task_id=f"T/{j}", states=draw(program_states(k)))
                for j in range(n)]
    return k, outcomes


def expected_state(states: tuple[str, ...], i: int) -> str:
    """Carry-forward oracle (15.5): states past the end repeat the last state."""
    return states[i] if i < len(states) else states[-1]


def state_counts(outcomes: list[ProgramOutcome], i: int) -> list[int]:
    c = Counter(expected_state(o.states, i) for o in outcomes)
    return [c[s] for s in ORDER]


# ---------------------------------------------------------------- Property 8 ---

@SETTINGS
@given(outcome_sets())
def test_property8_rsr_bounded_and_monotone(case):
    """Feature: paper-aligned-repair-tool, Property 8: RSR is bounded and monotone."""
    k, outcomes = case
    n = len(outcomes)
    result = rsr(outcomes, k)

    assert [r["iteration"] for r in result] == list(range(1, k + 1))
    prev_num = 0
    for r in result:
        i = r["iteration"]
        expected = sum(
            any(expected_state(o.states, j) == "PASS" for j in range(1, i + 1))
            for o in outcomes
        )
        assert r["den"] == n
        assert r["num"] == expected
        assert 0 <= r["num"] <= n
        if n == 0:
            assert r["pct"] is None
        else:
            assert 0.0 <= r["num"] / r["den"] <= 1.0
            assert 0.0 <= r["pct"] <= 100.0
        # Monotone: RSR_i <= RSR_(i+1) (same denominator N).
        assert r["num"] >= prev_num
        prev_num = r["num"]


# ---------------------------------------------------------------- Property 9 ---

@SETTINGS
@given(outcome_sets())
def test_property9_evolution_matrices_conserve_and_chain(case):
    """Feature: paper-aligned-repair-tool, Property 9: Evolution matrices conserve programs and chain marginals."""
    k, outcomes = case
    n = len(outcomes)
    mats = evolution_matrices(outcomes, k)

    assert len(mats) == k
    prev_cols = None
    for idx, m in enumerate(mats):
        i = idx + 1
        assert m["iteration"] == i
        assert tuple(m["states"]) == ORDER
        counts = m["counts"]
        assert len(counts) == 4 and all(len(row) == 4 for row in counts)
        assert all(isinstance(c, int) and c >= 0 for row in counts for c in row)

        row_sums = [sum(row) for row in counts]
        col_sums = [sum(counts[r][c] for r in range(4)) for c in range(4)]

        # 15.6 conservation
        assert sum(row_sums) == n
        # 15.7 marginals equal state counts at i-1 (rows) and i (cols), with carry-forward
        assert row_sums == state_counts(outcomes, i - 1)
        assert col_sums == state_counts(outcomes, i)
        # 18.11 chain: rows of matrix i equal columns of matrix i-1
        if prev_cols is not None:
            assert row_sums == prev_cols
        prev_cols = col_sums
