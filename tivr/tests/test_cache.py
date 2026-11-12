"""Unit tests for tivr.cache (Requirements 13.1-13.3)."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from tivr import cache as gc
from tivr import metrics
from tivr.config import Decoding, RunConfig
from tivr.rundir import GENERATION_CACHE_FILE, Redactor, RunDir

SHA = "a" * 64


def _config(**kw) -> RunConfig:
    base = dict(dataset=Path("data/tasks.jsonl"), model="gpt-4", mock=True,
                decoding=Decoding(temperature=0.1, top_p=None, max_tokens=None),
                generation_prompt_style="dou")
    base.update(kw)
    return RunConfig(**base)


def _entries() -> list[dict]:
    return [
        gc.make_entry(task_id="T/0", prompt="p0", raw_response="```python\nx=1\n```", code="x=1",
                      had_code_block=True, usage={"prompt_tokens": 10, "completion_tokens": 5},
                      hidden={"passed": True, "primary_state": "P", "unmapped_as_c": False,
                              "categories": [], "top_category": None, "signals": []}),
        gc.make_entry(task_id="T/1", prompt="p1", raw_response="x=2", code="x=2",
                      had_code_block=False, usage=None,
                      hidden={"passed": False, "primary_state": "C", "unmapped_as_c": False,
                              "categories": ["C.1"], "top_category": "C.1",
                              "signals": ["functional:logic"]}),
    ]


def _cache(config: RunConfig | None = None) -> dict:
    return gc.build_cache(config or _config(), dataset_sha256=SHA, taxonomy_version="1.0.0",
                          entries=_entries(),
                          created_at=datetime(2026, 1, 1, tzinfo=timezone.utc))


def _write_run_cache(tmp_path: Path, cache: dict) -> Path:
    run = RunDir.create(tmp_path / "runs", "run-1", Redactor())
    return gc.write_cache(run, cache)


# ---------------------------------------------------------------------------
# Schema and round trip (13.1, 13.2)
# ---------------------------------------------------------------------------

def test_build_cache_follows_design_schema():
    cache = _cache()
    assert cache["schema"] == "tivr.generation_cache.v1"
    assert cache["dataset_path"] == "data/tasks.jsonl"
    assert cache["dataset_sha256"] == SHA
    assert cache["model"] == "gpt-4"
    assert cache["llm_mode"] == "mock"
    assert cache["decoding"] == {"temperature": 0.1, "top_p": None, "max_tokens": None}
    assert cache["generation_prompt_style"] == "dou"
    assert cache["created_at"] == "2026-01-01T00:00:00Z"
    assert set(cache["entries"][0]) == {"task_id", "prompt", "raw_response", "code",
                                        "had_code_block", "usage", "hidden"}


def test_round_trip_through_run_directory(tmp_path):
    cache = _cache()
    path = _write_run_cache(tmp_path, cache)
    assert path.name == GENERATION_CACHE_FILE
    loaded = gc.read_cache(path)
    assert loaded == cache
    assert gc.validate_cache(loaded, _config(), dataset_sha256=SHA) == []
    assert gc.load_cache_for_run(path, _config(), dataset_sha256=SHA) == cache


def test_entries_are_compatible_with_pass_at_1(tmp_path):
    loaded = gc.read_cache(_write_run_cache(tmp_path, _cache()))
    before = metrics.pass_at_1(loaded["entries"], [])["before"]
    assert (before["num"], before["den"]) == (1, 2)


def test_make_entry_requires_passed():
    with pytest.raises(ValueError):
        gc.make_entry(task_id="T/0", prompt="", raw_response="", code="", had_code_block=False,
                      usage=None, hidden={"primary_state": "C"})


# ---------------------------------------------------------------------------
# Mismatch reporting (13.3)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("field, run_kw, sha, cached, run_value", [
    ("dataset_sha256", {}, "b" * 64, SHA, "b" * 64),
    ("model", {"model": "deepseek-chat"}, SHA, "gpt-4", "deepseek-chat"),
    ("decoding.temperature", {"decoding": Decoding(temperature=0.7)}, SHA, 0.1, 0.7),
    ("decoding.top_p", {"decoding": Decoding(temperature=0.1, top_p=0.9)}, SHA, None, 0.9),
    ("decoding.max_tokens", {"decoding": Decoding(temperature=0.1, max_tokens=256)}, SHA, None, 256),
    ("generation_prompt_style", {"generation_prompt_style": "tivr"}, SHA, "dou", "tivr"),
    ("llm_mode", {"mock": False}, SHA, "mock", "live"),
])
def test_each_mismatched_field_is_reported(field, run_kw, sha, cached, run_value):
    mismatches = gc.validate_cache(_cache(), _config(**run_kw), dataset_sha256=sha)
    assert mismatches == [gc.CacheMismatch(field, cached, run_value)]
    text = str(mismatches[0])
    assert text == f"{field}: cached={json.dumps(cached)} run={json.dumps(run_value)}"


def test_all_mismatches_are_listed_together(tmp_path):
    path = _write_run_cache(tmp_path, _cache())
    run = _config(model="m2", mock=False, generation_prompt_style="tivr",
                  decoding=Decoding(temperature=1.0, top_p=0.5, max_tokens=64))
    mismatches = gc.validate_cache(gc.read_cache(path), run, dataset_sha256="c" * 64)
    assert [m.field for m in mismatches] == [name for name, _ in gc.COMPARED_FIELDS]

    with pytest.raises(gc.CacheError) as info:
        gc.load_cache_for_run(path, run, dataset_sha256="c" * 64)
    message = str(info.value)
    assert str(path) in message
    for m in mismatches:
        assert str(m) in message
    assert info.value.mismatches == tuple(mismatches)


def test_bool_does_not_match_integer_and_missing_field_is_a_mismatch():
    cache = _cache()
    cache["decoding"]["max_tokens"] = True
    del cache["model"]
    mismatches = gc.validate_cache(cache, _config(decoding=Decoding(temperature=0.1, max_tokens=1)),
                                   dataset_sha256=SHA)
    assert [m.field for m in mismatches] == ["model", "decoding.max_tokens"]
    assert str(mismatches[0]) == 'model: cached=<missing> run="gpt-4"'


def test_integer_and_float_temperature_match():
    cache = _cache(_config(decoding=Decoding(temperature=1.0)))
    cache["decoding"]["temperature"] = 1
    assert gc.validate_cache(cache, _config(decoding=Decoding(temperature=1.0)),
                             dataset_sha256=SHA) == []


# ---------------------------------------------------------------------------
# Missing / unparseable files name the file (13.3)
# ---------------------------------------------------------------------------

def test_missing_file_error_names_the_file(tmp_path):
    path = tmp_path / "nope" / "generation_cache.json"
    with pytest.raises(gc.CacheError) as info:
        gc.read_cache(path)
    assert str(path) in str(info.value)
    assert "does not exist" in str(info.value)


def test_directory_is_rejected(tmp_path):
    with pytest.raises(gc.CacheError) as info:
        gc.read_cache(tmp_path)
    assert str(tmp_path) in str(info.value)


@pytest.mark.parametrize("content", [b"{not json", b"", b"\xff\xfe\x00garbage"])
def test_unparseable_file_error_names_the_file(tmp_path, content):
    path = tmp_path / "bad.json"
    path.write_bytes(content)
    with pytest.raises(gc.CacheError) as info:
        gc.read_cache(path)
    assert str(path) in str(info.value)
    assert "cannot be parsed" in str(info.value)


@pytest.mark.parametrize("mutate, needle", [
    (lambda c: c.clear() or c.update({"x": 1}), "schema"),
    (lambda c: c.pop("llm_mode"), "llm_mode"),
    (lambda c: c["decoding"].pop("top_p"), "decoding.top_p"),
    (lambda c: c.update(entries={}), "entries"),
    (lambda c: c["entries"][1].update(task_id="T/0"), "duplicate"),
    (lambda c: c["entries"][0]["hidden"].pop("passed"), "entries[0].hidden.passed"),
])
def test_malformed_cache_error_names_the_file_and_field(tmp_path, mutate, needle):
    cache = _cache()
    mutate(cache)
    path = tmp_path / "cache.json"
    path.write_text(json.dumps(cache), encoding="utf-8")
    with pytest.raises(gc.CacheError) as info:
        gc.read_cache(path)
    assert str(path) in str(info.value)
    assert needle in str(info.value)


def test_top_level_array_is_rejected(tmp_path):
    path = tmp_path / "cache.json"
    path.write_text("[]", encoding="utf-8")
    with pytest.raises(gc.CacheError, match="JSON object"):
        gc.read_cache(path)
