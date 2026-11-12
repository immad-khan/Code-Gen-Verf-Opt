"""Generation_Cache read/write/validate (design §4 and §Data Models, Requirement 13.1-13.3).

``generation_cache.json`` holds one initial candidate per Task_Record together
with its Hidden_Suite result and the run values that produced it::

    {
      "schema": "tivr.generation_cache.v1",
      "dataset_path": "...", "dataset_sha256": "<64 hex>",
      "model": "gpt-4", "llm_mode": "live",
      "decoding": {"temperature": 0.1, "top_p": null, "max_tokens": null},
      "generation_prompt_style": "dou", "taxonomy_version": "1.0.0",
      "created_at": "2026-01-01T00:00:00Z",
      "entries": [{"task_id": ..., "prompt": ..., "raw_response": ..., "code": ...,
                   "had_code_block": ..., "usage": ..., "hidden": {"passed": ..., ...}}]
    }

Entries stay plain dicts so :func:`tivr.metrics.pass_at_1` can read
``entry["task_id"]`` and ``entry["hidden"]["passed"]`` directly.

A supplied cache is reused only when every compared field matches the run
(13.2, 13.3): ``dataset_sha256``, ``model``, ``decoding.temperature``,
``decoding.top_p``, ``decoding.max_tokens``, ``generation_prompt_style`` and
``llm_mode`` (so mock caches are never reused in live runs). Every mismatch is
reported as ``field: cached=<v> run=<v>``.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

from tivr.config import RunConfig
from tivr.rundir import RunDir, iso_utc, utc_now

CACHE_SCHEMA = "tivr.generation_cache.v1"
CACHE_EXIT_CODE = 5

# (reported field name, path inside the cache document)
COMPARED_FIELDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("dataset_sha256", ("dataset_sha256",)),
    ("model", ("model",)),
    ("decoding.temperature", ("decoding", "temperature")),
    ("decoding.top_p", ("decoding", "top_p")),
    ("decoding.max_tokens", ("decoding", "max_tokens")),
    ("generation_prompt_style", ("generation_prompt_style",)),
    ("llm_mode", ("llm_mode",)),
)

_MISSING = object()


# ---------------------------------------------------------------------------
# Errors and mismatches
# ---------------------------------------------------------------------------

class CacheError(Exception):
    """A supplied Generation_Cache is missing, unreadable, malformed, or mismatched (exit 5).

    ``str(err)`` always names the cache file.
    """

    def __init__(self, path: str | os.PathLike[str], reason: str,
                 mismatches: Sequence["CacheMismatch"] = ()) -> None:
        self.path = str(path)
        self.reason = reason
        self.mismatches = tuple(mismatches)
        # Plain quoting (not repr) so Windows paths appear exactly as given.
        super().__init__(f"generation cache '{self.path}': {reason}")


def _fmt(value: Any) -> str:
    if value is _MISSING:
        return "<missing>"
    return json.dumps(value, ensure_ascii=False, default=str)


@dataclass(frozen=True)
class CacheMismatch:
    field: str
    cached: Any
    run: Any

    def __str__(self) -> str:
        return f"{self.field}: cached={_fmt(self.cached)} run={_fmt(self.run)}"


# ---------------------------------------------------------------------------
# Building and writing
# ---------------------------------------------------------------------------

def run_values(config: RunConfig, dataset_sha256: str) -> dict[str, Any]:
    """The run's value for every compared field, keyed by reported field name."""
    decoding = config.decoding.as_dict()
    return {
        "dataset_sha256": dataset_sha256,
        "model": config.model,
        "decoding.temperature": decoding["temperature"],
        "decoding.top_p": decoding["top_p"],
        "decoding.max_tokens": decoding["max_tokens"],
        "generation_prompt_style": config.generation_prompt_style,
        "llm_mode": config.llm_mode,
    }


def make_entry(*, task_id: str, prompt: str, raw_response: str, code: str,
               had_code_block: bool, usage: Mapping[str, Any] | None,
               hidden: Mapping[str, Any]) -> dict[str, Any]:
    """One cache entry in the design's schema; ``hidden`` must include ``passed``."""
    if "passed" not in hidden:
        raise ValueError("hidden result must include 'passed'")
    return {
        "task_id": task_id,
        "prompt": prompt,
        "raw_response": raw_response,
        "code": code,
        "had_code_block": bool(had_code_block),
        "usage": dict(usage) if usage is not None else None,
        "hidden": dict(hidden),
    }


def build_cache(config: RunConfig, *, dataset_sha256: str, taxonomy_version: str,
                entries: Sequence[Mapping[str, Any]],
                created_at: datetime | None = None) -> dict[str, Any]:
    """The full ``generation_cache.json`` document for this run (13.1)."""
    return {
        "schema": CACHE_SCHEMA,
        "dataset_path": config.dataset.as_posix(),
        "dataset_sha256": dataset_sha256,
        "model": config.model,
        "llm_mode": config.llm_mode,
        "decoding": config.decoding.as_dict(),
        "generation_prompt_style": config.generation_prompt_style,
        "taxonomy_version": taxonomy_version,
        "created_at": iso_utc(created_at or utc_now()),
        "entries": [dict(e) for e in entries],
    }


def write_cache(rundir: RunDir, cache: Mapping[str, Any]) -> Path:
    """Atomically write the redacted cache to ``<run_dir>/generation_cache.json``."""
    return rundir.write_generation_cache(cache)


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def read_cache(path: str | os.PathLike[str]) -> dict[str, Any]:
    """Load and structurally check a Generation_Cache; raise :class:`CacheError` naming the file."""
    p = Path(path)
    if not p.is_file():
        raise CacheError(p, "file does not exist" if not p.exists() else "not a regular file")
    try:
        with open(p, encoding="utf-8") as fh:
            data = json.load(fh)
    except UnicodeDecodeError as exc:
        raise CacheError(p, f"cannot be parsed: not valid UTF-8 ({exc.reason})") from exc
    except json.JSONDecodeError as exc:
        raise CacheError(p, f"cannot be parsed as JSON: {exc.msg} "
                            f"(line {exc.lineno}, column {exc.colno})") from exc
    except OSError as exc:
        raise CacheError(p, f"cannot be read: {type(exc).__name__}: {exc.strerror or exc}") from exc
    _check_structure(p, data)
    return data


def _check_structure(path: Path, data: Any) -> None:
    def bad(reason: str) -> CacheError:
        return CacheError(path, f"invalid Generation_Cache: {reason}")

    if not isinstance(data, dict):
        raise bad("top-level value must be a JSON object")
    if data.get("schema") != CACHE_SCHEMA:
        raise bad(f"'schema' must be {CACHE_SCHEMA!r} (got {_fmt(data.get('schema', _MISSING))})")
    if not isinstance(data.get("decoding"), dict):
        raise bad("'decoding' must be an object")
    for name, keys in COMPARED_FIELDS:
        if _lookup(data, keys) is _MISSING:
            raise bad(f"missing field '{name}'")
    entries = data.get("entries")
    if not isinstance(entries, list):
        raise bad("'entries' must be a list")
    seen: set[str] = set()
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise bad(f"entries[{i}] must be an object")
        task_id = entry.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            raise bad(f"entries[{i}].task_id must be a non-empty string")
        if task_id in seen:
            raise bad(f"duplicate task_id {task_id!r} at entries[{i}]")
        seen.add(task_id)
        if not isinstance(entry.get("code"), str):
            raise bad(f"entries[{i}].code must be a string")
        hidden = entry.get("hidden")
        if not isinstance(hidden, dict) or not isinstance(hidden.get("passed"), bool):
            raise bad(f"entries[{i}].hidden.passed must be a boolean")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _lookup(doc: Any, keys: tuple[str, ...]) -> Any:
    for key in keys:
        if not isinstance(doc, Mapping) or key not in doc:
            return _MISSING
        doc = doc[key]
    return doc


def _same(cached: Any, run: Any) -> bool:
    # bool is an int subclass; True must not match 1 (or 1.0).
    if isinstance(cached, bool) != isinstance(run, bool):
        return False
    return cached == run


def validate_cache(cache: Mapping[str, Any], run: RunConfig, *,
                   dataset_sha256: str) -> list[CacheMismatch]:
    """Every compared field whose cached value differs from the run's value (13.3).

    Returns an empty list when the cache may be reused. Order follows
    :data:`COMPARED_FIELDS`. A field absent from the cache is a mismatch.
    """
    values = run_values(run, dataset_sha256)
    mismatches: list[CacheMismatch] = []
    for name, keys in COMPARED_FIELDS:
        cached = _lookup(cache, keys)
        if cached is _MISSING or not _same(cached, values[name]):
            mismatches.append(CacheMismatch(name, cached, values[name]))
    return mismatches


def format_mismatches(mismatches: Sequence[CacheMismatch]) -> str:
    """``field: cached=<v> run=<v>`` lines, one per mismatch."""
    return "\n".join(f"  {m}" for m in mismatches)


def load_cache_for_run(path: str | os.PathLike[str], run: RunConfig, *,
                       dataset_sha256: str) -> dict[str, Any]:
    """Read ``path`` and require every compared field to match the run (13.2, 13.3).

    Raises :class:`CacheError` naming the file when it is missing, unparseable,
    malformed, or when any field mismatches (all mismatches are listed).
    """
    cache = read_cache(path)
    mismatches = validate_cache(cache, run, dataset_sha256=dataset_sha256)
    if mismatches:
        raise CacheError(path, "does not match this run:\n" + format_mismatches(mismatches),
                         mismatches)
    return cache
