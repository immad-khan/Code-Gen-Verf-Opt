"""Index of standard-library module names and their public members (Requirement 8.5).

The enrichment layer uses :func:`is_stdlib_name` to decide whether a
``NameError: name '<id>' is not defined`` refers to a standard-library module
(``math``) or a public member of one (``sqrt``, ``defaultdict``) that the
candidate forgot to import (signal qualifier ``stdlib_unbound`` -> A.3).

The index is built once per interpreter in a separate, isolated subprocess
(``python -I``) so importing ~200 stdlib modules never pollutes the calling
process, and is cached as JSON at
``<cache_dir>/stdlib_index-<impl>-<major>.<minor>.json`` where ``cache_dir`` is
``$TIVR_CACHE_DIR`` or ``~/.cache/tivr``.

Robustness:

* each module import in the child is wrapped individually; failures are skipped;
* the child streams one JSON line per module, so a crash or timeout still
  yields the members collected so far;
* the whole build has a timeout (``BUILD_TIMEOUT_S``); an incomplete build is
  used for the current process but never written to the cache;
* a missing or corrupt cache file is rebuilt.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

__all__ = [
    "BUILD_TIMEOUT_S",
    "DENYLIST",
    "FORMAT_VERSION",
    "StdlibIndex",
    "cache_dir",
    "cache_path",
    "clear_memo",
    "is_stdlib_module",
    "is_stdlib_name",
    "load_index",
]

#: Modules never imported while building the index (side effects, GUI, slow, or test-only).
DENYLIST: frozenset[str] = frozenset(
    {"antigravity", "this", "idlelib", "tkinter", "turtle", "turtledemo", "ensurepip", "venv", "test"}
)

#: Overall time budget for the index-building subprocess, in seconds.
BUILD_TIMEOUT_S: float = 120.0

#: Bumped when the cache layout changes; older cache files are rebuilt.
FORMAT_VERSION = 1

_DONE_MARKER = "__tivr_done__"

# Executed in the child interpreter. argv[1] = output path, argv[2] = JSON list of modules.
_CHILD_SCRIPT = r"""
import importlib, json, os, sys, warnings
warnings.simplefilter("ignore")
out_path, modules = sys.argv[1], json.loads(sys.argv[2])
with open(out_path, "w", encoding="utf-8") as out:
    for name in modules:
        try:
            mod = importlib.import_module(name)
            names = getattr(mod, "__all__", None)
            if not isinstance(names, (list, tuple, set, frozenset)):
                names = dir(mod)
            members = sorted({n for n in names
                              if isinstance(n, str) and n.isidentifier() and not n.startswith("_")})
        except BaseException:
            continue
        out.write(json.dumps({"module": name, "members": members}) + "\n")
        out.flush()
    out.write(json.dumps({"module": %(done)r, "members": []}) + "\n")
    out.flush()
os._exit(0)
""" % {"done": _DONE_MARKER}


@dataclass(frozen=True)
class StdlibIndex:
    """Top-level stdlib module names plus the union of their public member names."""

    modules: frozenset[str]
    members: frozenset[str]
    complete: bool = True

    def is_module(self, identifier: str) -> bool:
        return identifier in self.modules

    def contains(self, identifier: str) -> bool:
        return identifier in self.modules or identifier in self.members


def cache_dir() -> Path:
    """``$TIVR_CACHE_DIR`` if set and non-empty, else ``~/.cache/tivr``."""
    env = os.environ.get("TIVR_CACHE_DIR", "").strip()
    return Path(env).expanduser() if env else Path.home() / ".cache" / "tivr"


def cache_path(directory: Path | None = None) -> Path:
    impl = sys.implementation.name
    major, minor = sys.version_info[:2]
    return (directory or cache_dir()) / f"stdlib_index-{impl}-{major}.{minor}.json"


def _public_stdlib_modules() -> list[str]:
    return sorted(n for n in sys.stdlib_module_names if not n.startswith("_"))


def _build(timeout_s: float) -> StdlibIndex:
    modules = _public_stdlib_modules()
    to_import = [m for m in modules if m not in DENYLIST]
    members: set[str] = set()
    complete = False
    fd, tmp_name = tempfile.mkstemp(prefix="tivr_stdlib_", suffix=".jsonl")
    os.close(fd)
    try:
        try:
            subprocess.run(
                [sys.executable, "-I", "-c", _CHILD_SCRIPT, tmp_name, json.dumps(to_import)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                cwd=tempfile.gettempdir(),
                timeout=timeout_s,
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError):
            pass  # use whatever the child streamed before it was stopped
        try:
            with open(tmp_name, encoding="utf-8") as fh:
                for line in fh:
                    try:
                        record = json.loads(line)
                    except ValueError:
                        continue  # truncated last line after a crash/kill
                    if record.get("module") == _DONE_MARKER:
                        complete = True
                        continue
                    members.update(n for n in record.get("members", []) if isinstance(n, str))
        except OSError:
            pass
    finally:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
    return StdlibIndex(frozenset(modules), frozenset(members), complete)


def _read_cache(path: Path) -> StdlibIndex | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("format_version") != FORMAT_VERSION:
        return None
    modules, members = data.get("modules"), data.get("members")
    if not isinstance(modules, list) or not isinstance(members, list):
        return None
    if not all(isinstance(n, str) for n in modules + members):
        return None
    return StdlibIndex(frozenset(modules), frozenset(members), True)


def _write_cache(path: Path, index: StdlibIndex) -> None:
    payload = {
        "format_version": FORMAT_VERSION,
        "implementation": sys.implementation.name,
        "version": f"{sys.version_info[0]}.{sys.version_info[1]}",
        "modules": sorted(index.modules),
        "members": sorted(index.members),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=path.name, suffix=".tmp", dir=path.parent)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp, path)
    except OSError:
        pass  # caching is an optimization; an unwritable cache dir is not an error


_memo: dict[Path, StdlibIndex] = {}
_lock = threading.Lock()


def load_index(directory: Path | None = None, *, timeout_s: float | None = None) -> StdlibIndex:
    """Return the stdlib index, from the in-process memo, the cache file, or a fresh build."""
    path = cache_path(directory)
    with _lock:
        cached = _memo.get(path)
        if cached is not None:
            return cached
        index = _read_cache(path)
        if index is None:
            index = _build(BUILD_TIMEOUT_S if timeout_s is None else timeout_s)
            if index.complete:
                _write_cache(path, index)
        _memo[path] = index
        return index


def clear_memo() -> None:
    """Forget in-process results so the next call re-reads the cache file."""
    with _lock:
        _memo.clear()


def is_stdlib_module(identifier: str) -> bool:
    """True iff ``identifier`` is a public top-level stdlib module name."""
    return identifier in load_index().modules


def is_stdlib_name(identifier: str) -> bool:
    """True iff ``identifier`` is a top-level stdlib module or a public member of one."""
    return load_index().contains(identifier)
