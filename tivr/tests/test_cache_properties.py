"""Property-based tests for tivr.cache validation.

Property 15: Cache validation lists exactly the mismatched fields.
**Validates: Requirements 13.3**

A cache header is built from a random base RunConfig and dataset hash, sent
through JSON (as it would be written and read back), and validated against a
run configuration that differs from the base in a random subset of the
compared fields. Validation must fail iff the subset is non-empty and must
report exactly that subset, in COMPARED_FIELDS order, with cached and run values.
"""
from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from tivr.cache import COMPARED_FIELDS, CacheMismatch, build_cache, format_mismatches, validate_cache
from tivr.config import PROMPT_STYLES, Decoding, RunConfig

SETTINGS = settings(max_examples=150, deadline=None)

FIELD_NAMES = tuple(name for name, _ in COMPARED_FIELDS)
HEX = "0123456789abcdef"

sha256s = st.text(HEX, min_size=64, max_size=64)
temperatures = st.floats(min_value=0.0, max_value=2.0)
top_ps = st.none() | st.floats(min_value=0.0, max_value=1.0, exclude_min=True)
max_tokens = st.none() | st.integers(min_value=1, max_value=100_000)
models = st.text(min_size=1, max_size=20)


@st.composite
def base_configs(draw) -> RunConfig:
    return RunConfig(
        dataset=Path("data/tasks.jsonl"),
        decoding=Decoding(temperature=draw(temperatures), top_p=draw(top_ps),
                          max_tokens=draw(max_tokens)),
        generation_prompt_style=draw(st.sampled_from(PROMPT_STYLES)),
        mock=draw(st.booleans()),
        model=draw(models),
    )


def different(draw, strategy, old):
    return draw(strategy.filter(lambda v: v != old))


def base_value(config: RunConfig, sha: str, field: str):
    return {
        "dataset_sha256": sha,
        "model": config.model,
        "decoding.temperature": config.decoding.temperature,
        "decoding.top_p": config.decoding.top_p,
        "decoding.max_tokens": config.decoding.max_tokens,
        "generation_prompt_style": config.generation_prompt_style,
        "llm_mode": "mock" if config.mock else "live",
    }[field]


@SETTINGS
@given(st.data())
def test_property15_validation_lists_exactly_mismatched_fields(data):
    """Feature: paper-aligned-repair-tool, Property 15: Cache validation lists exactly the mismatched fields."""
    base = data.draw(base_configs())
    base_sha = data.draw(sha256s)
    cache = json.loads(json.dumps(build_cache(
        base, dataset_sha256=base_sha, taxonomy_version="1.0.0",
        entries=[{"task_id": "T/0", "code": "", "hidden": {"passed": False}}])))

    changed = data.draw(st.sets(st.sampled_from(FIELD_NAMES)))
    run, sha, dec = base, base_sha, base.decoding
    d = data.draw
    if "dataset_sha256" in changed:
        sha = different(d, sha256s, base_sha)
    if "model" in changed:
        run = replace(run, model=different(d, models, base.model))
    if "decoding.temperature" in changed:
        dec = replace(dec, temperature=different(d, temperatures, dec.temperature))
    if "decoding.top_p" in changed:
        dec = replace(dec, top_p=different(d, top_ps, dec.top_p))
    if "decoding.max_tokens" in changed:
        dec = replace(dec, max_tokens=different(d, max_tokens, dec.max_tokens))
    if "generation_prompt_style" in changed:
        other = [s for s in PROMPT_STYLES if s != base.generation_prompt_style]
        run = replace(run, generation_prompt_style=d(st.sampled_from(other)))
    if "llm_mode" in changed:
        run = replace(run, mock=not base.mock)
    run = replace(run, decoding=dec)

    mismatches = validate_cache(cache, run, dataset_sha256=sha)

    assert (mismatches == []) == (not changed)
    assert [m.field for m in mismatches] == [f for f in FIELD_NAMES if f in changed]
    for m in mismatches:
        assert isinstance(m, CacheMismatch)
        assert m.cached == base_value(base, base_sha, m.field)
        assert m.run == base_value(run, sha, m.field)
        assert m.cached != m.run

    # split("\n"), not splitlines(): model names may contain U+2028 etc., which
    # json.dumps(ensure_ascii=False) leaves unescaped.
    lines = format_mismatches(mismatches).split("\n") if mismatches else []
    assert len(lines) == len(changed)
    for line, m in zip(lines, mismatches):
        assert line.strip().startswith(f"{m.field}: cached=")
        assert f"cached={json.dumps(m.cached, ensure_ascii=False)}" in line
        assert f"run={json.dumps(m.run, ensure_ascii=False)}" in line
