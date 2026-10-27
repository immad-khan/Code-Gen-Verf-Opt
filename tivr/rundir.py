"""Run_Directory management for ``python -m tivr.run_benchmark`` (design §4).

Layout of ``<runs_root>/<run_id>/``:

==========================  ===================================================
``manifest.json``           provenance; written at start, after sampling, at end
``progress.json``           ``{phase, completed, total}``; atomic ``os.replace``
``generation_cache.json``   Generation_Cache (only when no cache was supplied)
``trajectories.jsonl``      one entry per repair iteration (flushed per line)
``programs.jsonl``          one outcome per program when its loop ends
``summary.json``            Run_Summary, on successful completion only
==========================  ===================================================

Guarantees:

* The directory is created with ``os.mkdir`` (no ``exist_ok``), so a run-ID
  collision fails without touching the existing directory (16.1, 16.2).
* Every writer takes its path from :meth:`RunDir.path`, which only resolves
  names inside the run root (16.3).
* Every JSON/JSONL writer and the console printer go through a
  :class:`Redactor` that replaces the API key with ``[REDACTED]`` (1.9, 16.7).
* JSON output is UTF-8 with no NaN/Infinity (``null`` instead).

The Experiments API (C#) reads ``manifest.json`` and ``progress.json``; their
field names follow the design's Data Models section exactly.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import secrets as _secrets
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, TextIO

from tivr import __version__ as TIVR_VERSION
from tivr.config import RUN_ID_PATTERN, RunConfig

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MANIFEST_SCHEMA = "tivr.manifest.v1"
PROGRESS_SCHEMA = "tivr.progress.v1"
TRAJECTORY_SCHEMA = "tivr.trajectory.v1"

MANIFEST_FILE = "manifest.json"
PROGRESS_FILE = "progress.json"
GENERATION_CACHE_FILE = "generation_cache.json"
TRAJECTORIES_FILE = "trajectories.jsonl"
PROGRAMS_FILE = "programs.jsonl"
SUMMARY_FILE = "summary.json"

PHASES: tuple[str, ...] = ("generation", "repair", "summary", "done")
TERMINATIONS: tuple[str | None, ...] = (None, "llm_error", "interrupted", "error")

REDACTED = "[REDACTED]"

# Windows refuses os.replace while another process (e.g. the Experiments API)
# holds the target open; retry briefly before giving up.
_REPLACE_ATTEMPTS = 20
_REPLACE_DELAY_S = 0.05


# ---------------------------------------------------------------------------
# Time, hashing, run IDs
# ---------------------------------------------------------------------------

def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso_utc(dt: datetime) -> str:
    """ISO 8601 UTC timestamp with second precision, e.g. ``2026-01-01T12:00:00Z``."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso_utc(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def sha256_bytes(data: bytes) -> str:
    """64-character lowercase hexadecimal SHA-256 digest."""
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: str | os.PathLike[str]) -> str:
    """64-character lowercase hexadecimal SHA-256 digest of the file bytes (16.4)."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def is_valid_run_id(run_id: object) -> bool:
    return isinstance(run_id, str) and RUN_ID_PATTERN.fullmatch(run_id) is not None


def generate_run_id(mode: str, regime: str, *, now: datetime | None = None,
                    suffix: str | None = None) -> str:
    """``YYYYMMDDTHHMMSSZ-<mode>-<regime>-<6 hex>``."""
    stamp = (now or utc_now()).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = f"{stamp}-{mode}-{regime}-{suffix if suffix is not None else _secrets.token_hex(3)}"
    if not is_valid_run_id(run_id):
        raise ValueError(f"generated run ID is invalid: {run_id!r}")
    return run_id


# ---------------------------------------------------------------------------
# Redaction and JSON encoding
# ---------------------------------------------------------------------------

class Redactor:
    """Replaces every occurrence of the given secrets with ``[REDACTED]``.

    Empty and whitespace-only secrets are ignored. Longer secrets are replaced
    first so overlapping secrets never leave a partial key behind.
    """

    def __init__(self, *secrets: str | None) -> None:
        unique = {s for s in secrets if isinstance(s, str) and s.strip()}
        self._secrets: tuple[str, ...] = tuple(sorted(unique, key=len, reverse=True))

    @property
    def active(self) -> bool:
        return bool(self._secrets)

    def text(self, value: str) -> str:
        for secret in self._secrets:
            if secret in value:
                value = value.replace(secret, REDACTED)
        return value

    def value(self, obj: Any) -> Any:
        """Recursively redact strings (keys included) in a JSON-like value."""
        if isinstance(obj, str):
            return self.text(obj)
        if isinstance(obj, Mapping):
            return {self.text(str(k)): self.value(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [self.value(v) for v in obj]
        return obj

    def dumps(self, obj: Any, *, indent: int | None = None) -> str:
        """JSON text with secrets removed both before and after encoding.

        Redacting the decoded values covers secrets that JSON would escape
        (quotes, backslashes, non-ASCII); redacting the encoded text covers
        anything produced by ``default=str``.
        """
        text = json.dumps(
            _json_safe(self.value(obj)), ensure_ascii=False, allow_nan=False,
            indent=indent, separators=None if indent else (",", ":"), default=str,
        )
        return self.text(text)

    def print(self, *args: Any, sep: str = " ", end: str = "\n",
              file: TextIO | None = None, flush: bool = True) -> None:
        """Console printer: ``print`` with secrets removed."""
        out = sys.stdout if file is None else file
        out.write(self.text(sep.join(str(a) for a in args)) + end)
        if flush:
            out.flush()


def _json_safe(obj: Any) -> Any:
    """Replace non-finite floats with ``None``; tuples become lists."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# Run directory
# ---------------------------------------------------------------------------

class RunDirError(Exception):
    """The Run_Directory could not be created (exit 4). Message names the run ID."""

    def __init__(self, run_id: str, reason: str, *, exists: bool = False) -> None:
        self.run_id = run_id
        self.reason = reason
        self.exists = exists
        super().__init__(f"run ID {run_id!r}: {reason}")


class PathEscapeError(ValueError):
    """A writer asked for a path outside the run root (16.3)."""


class RunDir:
    """All file access for one run, confined to ``<runs_root>/<run_id>``."""

    def __init__(self, root: Path, run_id: str, redactor: Redactor | None = None) -> None:
        self.root = Path(root).resolve()
        self.run_id = run_id
        self.redactor = redactor or Redactor()

    # -- creation ----------------------------------------------------------

    @classmethod
    def create(cls, runs_root: str | os.PathLike[str], run_id: str,
               redactor: Redactor | None = None) -> "RunDir":
        """Exclusively create ``<runs_root>/<run_id>``; never touch an existing one."""
        if not is_valid_run_id(run_id):
            raise RunDirError(str(run_id), "invalid run ID (expected "
                              "^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$)")
        root = Path(runs_root)
        try:
            root.mkdir(parents=True, exist_ok=True)      # the runs root, not a run directory
        except OSError as exc:
            raise RunDirError(run_id, f"cannot create runs root {str(root)!r}: "
                              f"{type(exc).__name__}: {exc.strerror or exc}") from exc
        target = root / run_id
        try:
            os.mkdir(target)                             # exclusive: no exist_ok
        except FileExistsError as exc:
            raise RunDirError(run_id, f"run directory already exists: {str(target)!r}",
                              exists=True) from exc
        except OSError as exc:
            raise RunDirError(run_id, f"cannot create run directory {str(target)!r}: "
                              f"{type(exc).__name__}: {exc.strerror or exc}") from exc
        return cls(target, run_id, redactor)

    # -- path confinement --------------------------------------------------

    def path(self, name: str | os.PathLike[str]) -> Path:
        """Resolve ``name`` inside the run root; reject anything that escapes it."""
        rel = Path(name)
        if not str(name) or rel.is_absolute() or rel.drive or rel.anchor:
            raise PathEscapeError(f"not a relative path inside the run directory: {str(name)!r}")
        if any(part == ".." for part in rel.parts):
            raise PathEscapeError(f"path escapes the run directory: {str(name)!r}")
        resolved = (self.root / rel).resolve()
        if resolved == self.root or not resolved.is_relative_to(self.root):
            raise PathEscapeError(f"path escapes the run directory: {str(name)!r}")
        return resolved

    # -- generic writers ---------------------------------------------------

    def write_json(self, name: str, obj: Any) -> Path:
        """Atomically write redacted JSON (temp file in the run dir, then ``os.replace``)."""
        target = self.path(name)
        text = self.redactor.dumps(obj, indent=2) + "\n"
        fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=f".{target.name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(text)
                fh.flush()
                os.fsync(fh.fileno())
            _replace_with_retry(tmp, target)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return target

    def append_jsonl(self, name: str, obj: Any) -> Path:
        """Append one redacted JSON line and flush it to disk."""
        target = self.path(name)
        line = self.redactor.dumps(obj) + "\n"
        with open(target, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(line)
            fh.flush()
            os.fsync(fh.fileno())
        return target

    def read_json(self, name: str) -> Any:
        with open(self.path(name), encoding="utf-8") as fh:
            return json.load(fh)

    # -- typed writers -----------------------------------------------------

    def write_progress(self, phase: str, completed: int, total: int, *,
                       now: datetime | None = None) -> Path:
        """Atomic ``progress.json`` (read by the Experiments API)."""
        if phase not in PHASES:
            raise ValueError(f"phase must be one of {', '.join(PHASES)} (got {phase!r})")
        return self.write_json(PROGRESS_FILE, {
            "schema": PROGRESS_SCHEMA, "run_id": self.run_id, "phase": phase,
            "completed": int(completed), "total": int(total),
            "updated_at": iso_utc(now or utc_now()),
        })

    def append_trajectory(self, entry: Mapping[str, Any]) -> Path:
        """One ``trajectories.jsonl`` line; ``schema`` and ``run_id`` lead the entry."""
        record = {"schema": TRAJECTORY_SCHEMA, "run_id": self.run_id}
        record.update({k: v for k, v in entry.items() if k not in record})
        return self.append_jsonl(TRAJECTORIES_FILE, record)

    def append_program(self, outcome: Mapping[str, Any]) -> Path:
        return self.append_jsonl(PROGRAMS_FILE, dict(outcome))

    def write_summary(self, summary: Mapping[str, Any]) -> Path:
        return self.write_json(SUMMARY_FILE, summary)

    def write_generation_cache(self, cache: Mapping[str, Any]) -> Path:
        return self.write_json(GENERATION_CACHE_FILE, cache)

    def print(self, *args: Any, **kwargs: Any) -> None:
        """Redacted console output."""
        self.redactor.print(*args, **kwargs)


def _replace_with_retry(src: str, dst: Path) -> None:
    for attempt in range(_REPLACE_ATTEMPTS):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if attempt == _REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(_REPLACE_DELAY_S)


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

class Manifest:
    """``manifest.json`` writer/updater. Every change is rewritten atomically."""

    def __init__(self, rundir: RunDir, data: dict[str, Any]) -> None:
        self.rundir = rundir
        self.data = data

    @classmethod
    def start(
        cls,
        rundir: RunDir,
        config: RunConfig,
        *,
        dataset_sha256: str,
        task_count: int,
        api_host: str | None,
        taxonomy_version: str,
        advisory_techniques: bool = False,
        generation_cache: Mapping[str, Any] | None = None,
        start_time: datetime | None = None,
    ) -> "Manifest":
        """Write the start manifest (16.4) with ``completed: false``."""
        data: dict[str, Any] = {
            "schema": MANIFEST_SCHEMA,
            "run_id": rundir.run_id,
            "dataset_path": config.dataset.as_posix(),
            "dataset_sha256": dataset_sha256,
            "task_count": int(task_count),
            "repair_mode": config.mode,
            "feedback_regime": config.feedback_regime,
            "k": config.k,
            "model": config.model,
            "api_host": api_host,
            "decoding": config.decoding.as_dict(),
            "generation_prompt_style": config.generation_prompt_style,
            "sample_size": config.sample_size,
            "seed": config.seed,
            "llm_mode": config.llm_mode,
            "taxonomy_version": taxonomy_version,
            "tivr_version": TIVR_VERSION,
            "python_version": ".".join(str(p) for p in sys.version_info[:3]),
            "advisory_techniques": bool(advisory_techniques),
            "generation_cache": dict(generation_cache) if generation_cache is not None else None,
            "repair_sample": None,
            "start_time": iso_utc(start_time or utc_now()),
            "end_time": None,
            "completed": False,
            "termination": None,
            "error": None,
        }
        manifest = cls(rundir, data)
        manifest.write()
        return manifest

    def write(self) -> Path:
        return self.rundir.write_json(MANIFEST_FILE, self.data)

    def update(self, **fields: Any) -> Path:
        self.data.update(fields)
        return self.write()

    def set_generation_cache(self, path: str | os.PathLike[str], sha256: str, reused: bool) -> Path:
        return self.update(generation_cache={
            "path": Path(path).as_posix(), "sha256": sha256, "reused": bool(reused),
        })

    def record_sample(self, *, requested: int, actual: int, seed: int,
                      cache_dataset_sha256: str, task_ids: Iterable[str]) -> Path:
        """Record the Repair_Sample before any repair begins (13.4-13.9)."""
        return self.update(repair_sample={
            "requested": int(requested), "actual": int(actual), "seed": int(seed),
            "cache_dataset_sha256": cache_dataset_sha256, "task_ids": list(task_ids),
        })

    def _end_time(self, end_time: datetime | None) -> str:
        """End time, clamped so it is never earlier than the start time (16.5)."""
        end = end_time or utc_now()
        start = parse_iso_utc(self.data["start_time"])
        return iso_utc(max(end, start))

    def finish(self, *, end_time: datetime | None = None) -> Path:
        """Successful completion: ``end_time`` and ``completed: true`` (16.5)."""
        return self.update(end_time=self._end_time(end_time), completed=True,
                           termination=None, error=None)

    def terminate(self, termination: str, error: str | None = None, *,
                  end_time: datetime | None = None) -> Path:
        """Early termination: ``end_time``, ``completed: false``, reason (16.6)."""
        if termination is None or termination not in TERMINATIONS:
            raise ValueError(f"termination must be one of llm_error, interrupted, error "
                             f"(got {termination!r})")
        return self.update(end_time=self._end_time(end_time), completed=False,
                           termination=termination, error=error)
