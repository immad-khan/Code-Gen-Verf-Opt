"""Property-based tests for tivr.sampling.select_repair_sample.

Feature: paper-aligned-repair-tool, Property 14
Property 14: Seeded sampling is deterministic and order-independent.
**Validates: Requirements 13.4, 13.6, 13.7, 18.12**

For any seed, N >= 1, and set of task IDs presented in any order (and with
duplicates), two selections return identical IDs in identical order, the
result has min(N, |set|) distinct members, and every member belongs to the
set.
"""
from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from tivr.sampling import select_repair_sample

SETTINGS = settings(max_examples=200, deadline=None)

# Task IDs: realistic "Dataset/123" style plus arbitrary text (code-point order
# must hold for any string, including non-ASCII).
_task_ids = st.one_of(
    st.builds(lambda p, k: f"{p}/{k}", st.sampled_from(["HumanEval", "MBPP", "APPS"]), st.integers(0, 999)),
    st.text(min_size=1, max_size=12),
)
_id_sets = st.sets(_task_ids, min_size=0, max_size=40)
_seeds = st.integers(min_value=0, max_value=2**63 - 1)
_sizes = st.integers(min_value=1, max_value=60)


@st.composite
def _two_presentations(draw):
    """A distinct ID set and two independent presentations of it.

    Each presentation is a permutation of the set with arbitrary extra
    duplicates of its members appended and the whole list shuffled.
    """
    ids = sorted(draw(_id_sets))

    def present():
        dups = draw(st.lists(st.sampled_from(ids), max_size=10)) if ids else []
        return draw(st.permutations(ids + dups))

    return set(ids), present(), present()


@SETTINGS
@given(data=_two_presentations(), n=_sizes, seed=_seeds)
def test_property14_seeded_sampling_deterministic_and_order_independent(data, n, seed):
    id_set, first, second = data

    a = select_repair_sample(first, n, seed)
    b = select_repair_sample(second, n, seed)
    # Same seed + same set (any order, any duplicates) -> identical list, identical order.
    assert a == b
    # Repeated call on the same input is also stable.
    assert select_repair_sample(first, n, seed) == a
    # Generators (single-pass iterables) give the same answer.
    assert select_repair_sample(iter(second), n, seed) == a

    # Size is min(N, |distinct|); members are distinct and drawn from the set.
    assert len(a) == min(n, len(id_set))
    assert len(set(a)) == len(a)
    assert set(a) <= id_set

    # When N covers the pool, every ID is returned in code-point sorted order.
    if n >= len(id_set):
        assert a == sorted(id_set)
