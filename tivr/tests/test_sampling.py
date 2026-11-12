"""Unit tests for tivr.sampling (Requirements 13.4, 13.6, 13.7)."""
import pytest

from tivr.sampling import select_repair_sample

IDS = [f"HumanEval/{i}" for i in range(50)]


def test_same_seed_same_selection():
    a = select_repair_sample(IDS, 10, seed=42)
    b = select_repair_sample(IDS, 10, seed=42)
    assert a == b
    assert len(a) == 10
    assert len(set(a)) == 10
    assert set(a) <= set(IDS)


def test_different_seeds_usually_differ():
    assert select_repair_sample(IDS, 10, seed=1) != select_repair_sample(IDS, 10, seed=2)


def test_input_order_does_not_matter():
    shuffled = list(reversed(IDS))
    assert select_repair_sample(IDS, 7, seed=3) == select_repair_sample(shuffled, 7, seed=3)
    assert select_repair_sample(IDS, 7, seed=3) == select_repair_sample(iter(set(IDS)), 7, seed=3)


def test_n_larger_than_pool_returns_all_sorted():
    ids = ["b", "c", "a"]
    assert select_repair_sample(ids, 120, seed=0) == ["a", "b", "c"]
    assert select_repair_sample(ids, 3, seed=0) == ["a", "b", "c"]


def test_duplicates_removed():
    ids = ["x", "y", "x", "z", "y"]
    assert select_repair_sample(ids, 10, seed=5) == ["x", "y", "z"]
    picked = select_repair_sample(ids * 3, 2, seed=5)
    assert len(picked) == 2 and len(set(picked)) == 2
    assert picked == select_repair_sample(["z", "y", "x"], 2, seed=5)


def test_empty_pool_returns_empty():
    assert select_repair_sample([], 5, seed=0) == []


@pytest.mark.parametrize("n", [0, -1, 1.5, True])
def test_invalid_n_rejected(n):
    with pytest.raises(ValueError, match="n"):
        select_repair_sample(IDS, n, seed=0)


@pytest.mark.parametrize("seed", [-1, 0.5, None])
def test_invalid_seed_rejected(seed):
    with pytest.raises(ValueError, match="seed"):
        select_repair_sample(IDS, 3, seed=seed)
