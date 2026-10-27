"""Seeded selection of the Repair_Sample (Requirement 13.4, 13.6, 13.7).

The pool is the set of distinct Initially_Incorrect_Program task IDs sorted in
code-point order, so the result depends only on (set of IDs, n, seed) and not
on input order, Repair_Mode, or Feedback_Regime. Callers record the requested
``n`` alongside ``len(result)`` as the actual sample size (13.7).
"""
from __future__ import annotations

import random
from typing import Iterable


def select_repair_sample(incorrect_ids: Iterable[str], n: int, seed: int) -> list[str]:
    """Return ``min(n, |distinct ids|)`` distinct task IDs chosen with ``seed``.

    When the pool has at most ``n`` IDs, every ID is returned in sorted order.
    Otherwise ``random.Random(seed).sample`` picks ``n`` IDs uniformly at random
    from the sorted pool; the returned order is the sampler's selection order.
    """
    if isinstance(n, bool) or not isinstance(n, int) or n < 1:
        raise ValueError(f"sample size n must be an integer >= 1, got {n!r}")
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise ValueError(f"seed must be a non-negative integer, got {seed!r}")

    pool = sorted(set(incorrect_ids))  # code-point order of task_id
    if n >= len(pool):
        return pool
    return random.Random(seed).sample(pool, n)
