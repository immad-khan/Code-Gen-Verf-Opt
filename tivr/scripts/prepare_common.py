"""Shared building blocks for the benchmark preparers (design.md §5, D5).

* ``CanonicalRunner``: computes expected outputs by running a task's canonical
  program in a persistent worker subprocess. Every input is deep-copied before
  the call (3.1); a call that exceeds the per-input limit (10 s by default)
  kills the worker, which is restarted for the next input (3.2). Results are
  ``ok`` (with the output serialized by ``to_source``), ``exception``,
  ``timeout`` or ``unserializable``.
* ``build_case_suite``: emits a self-contained pytest source (inlined
  ``SUITE_HELPER_SOURCE``, inputs/expected outputs inlined as ``to_source``
  text, one parametrized test per case) that asserts every output (3.3, 4.2).
* ``validate_suites``: runs each record's canonical program as ``solution.py``
  against its emitted suites through ``ProjectVerifier`` (3.9, 4.5).
* Report writers (``<out>.report.json``, ``<out>.skipped.json``) and atomic
  output writes (temp file in the target directory, then ``os.replace``).
"""
from __future__ import annotations

import json
import keyword
import os
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from tivr.equivalence import SUITE_HELPER_SOURCE, Unserializable, to_source

__all__ = [
    "CANONICAL_TIMEOUT_S",
    "Case",
    "CaseCollection",
    "CaseResult",
    "CanonicalRunner",
    "OmittedInput",
    "SuiteFailure",
    "atomic_write_text",
    "build_case_suite",
    "collect_cases",
    "report_path_for",
    "skipped_path_for",
    "validate_suites",
    "write_jsonl_atomic",
    "write_report",
    "write_skipped",
]

CANONICAL_TIMEOUT_S = 10.0       # per input (3.1, 4.6)
STARTUP_GRACE_S = 20.0           # interpreter start + program load, on top of the limit
_KILL_WAIT_S = 10.0
_DETAIL_LIMIT = 300
REPO_ROOT = Path(__file__).resolve().parents[2]

STATUS_OK = "ok"
STATUS_EXCEPTION = "exception"
STATUS_TIMEOUT = "timeout"
STATUS_UNSERIALIZABLE = "unserializable"


# --------------------------------------------------------------- results ---

@dataclass(frozen=True)
class CaseResult:
    """Outcome of one canonical call."""

    status: str                       # ok | exception | timeout | unserializable
    value_source: str | None = None   # to_source(output) when status == "ok"
    exception: str | None = None      # exception class name when status == "exception"
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status == STATUS_OK


@dataclass(frozen=True)
class Case:
    """One test case: an argument tuple and its expected output, both as source."""

    args_source: str        # source of a tuple, e.g. "(1, [2, 3])"
    expected_source: str

    @classmethod
    def from_values(cls, args: Sequence[Any], expected: Any) -> "Case":
        """Build a case from Python values; raises ``Unserializable``."""
        return cls(to_source(tuple(args)), to_source(expected))

    @property
    def key(self) -> tuple[str, str]:
        """(input arguments, expected output) identity used for subset checks."""
        return (self.args_source, self.expected_source)


@dataclass(frozen=True)
class OmittedInput:
    index: int
    status: str             # exception | timeout | unserializable
    detail: str = ""


@dataclass
class CaseCollection:
    cases: list[Case] = field(default_factory=list)
    omitted: list[OmittedInput] = field(default_factory=list)
    # index into ``inputs`` of each entry in ``cases`` (same order)
    input_indices: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class SuiteFailure:
    task_id: str
    suite: str              # visible | hidden
    reason: str
    tests_passed: int = 0
    tests_failed: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _short(text: str, limit: int = _DETAIL_LIMIT) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[:limit] + "..."


# ---------------------------------------------------------------- worker ---
#
# Runs as ``python -c WORKER_SOURCE <repo_root> <entry_point>``. Protocol: one
# ASCII JSON object per line on the original stdin/stdout file descriptors.
# Those are duplicated first and fds 0/1 are pointed at the null device, so a
# canonical program that prints or reads stdin cannot corrupt the protocol.
_WORKER_SOURCE = r'''
import copy, json, os, sys, types

sys.path.insert(0, sys.argv[1])
_entry = sys.argv[2]
_proto_in = os.fdopen(os.dup(0), "rb")
_proto_out = os.fdopen(os.dup(1), "wb")
_null = os.open(os.devnull, os.O_RDWR)
os.dup2(_null, 0)
os.dup2(_null, 1)
sys.stdin = open(os.devnull, "r")
sys.stdout = open(os.devnull, "w")

from tivr.equivalence import SourceError, Unserializable, from_source, to_source


def _send(obj):
    _proto_out.write(json.dumps(obj, ensure_ascii=True).encode("ascii") + b"\n")
    _proto_out.flush()


def _detail(exc):
    try:
        text = " ".join(str(exc).split())
    except BaseException:
        text = ""
    return text[:300]


_program = _proto_in.readline().decode("utf-8")
_program = json.loads(_program)["program"]
try:
    _module = types.ModuleType("solution")
    _module.__file__ = os.path.join(os.getcwd(), "solution.py")
    sys.modules["solution"] = _module
    exec(compile(_program, "solution.py", "exec"), _module.__dict__)
    _fn = getattr(_module, _entry, None)
    if not callable(_fn):
        raise AttributeError("entry point %r is not defined by the program" % _entry)
except BaseException as exc:
    _send({"ready": False, "exception": type(exc).__name__, "detail": _detail(exc)})
    sys.exit(0)
_send({"ready": True})

for _line in _proto_in:
    _req = json.loads(_line.decode("ascii"))
    try:
        _args = from_source(_req["args"])
        if type(_args) is not tuple:
            raise SourceError("arguments must be a tuple")
    except BaseException as exc:
        _send({"id": _req["id"], "status": "unserializable", "detail": "input: " + _detail(exc)})
        continue
    try:
        _value = _fn(*copy.deepcopy(_args))
    except BaseException as exc:
        _send({"id": _req["id"], "status": "exception", "exception": type(exc).__name__,
               "detail": _detail(exc)})
        continue
    try:
        _src = to_source(_value)
        from_source(_src)
    except BaseException as exc:
        _send({"id": _req["id"], "status": "unserializable", "detail": "output: " + _detail(exc)})
        continue
    _send({"id": _req["id"], "status": "ok", "value": _src})
'''


def _kill_tree(proc: subprocess.Popen) -> None:
    """Kill ``proc`` and anything it started (Windows-safe)."""
    if proc.poll() is None:
        if os.name == "nt":
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=_KILL_WAIT_S, check=False)
            except (OSError, subprocess.TimeoutExpired):
                pass
        else:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (OSError, ProcessLookupError):
                pass
        try:
            proc.kill()
        except OSError:
            pass
    try:
        proc.wait(timeout=_KILL_WAIT_S)
    except subprocess.TimeoutExpired:
        pass


class _Worker:
    """One live worker process with a reader thread feeding a line queue."""

    def __init__(self, cmd: list[str], cwd: Path):
        kwargs: dict[str, Any] = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            kwargs["start_new_session"] = True
        self.proc = subprocess.Popen(cmd, cwd=str(cwd), stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     **kwargs)
        self.lines: "queue.Queue[bytes | None]" = queue.Queue()
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _read(self) -> None:
        stream = self.proc.stdout
        assert stream is not None
        try:
            for line in iter(stream.readline, b""):
                self.lines.put(line)
        except (OSError, ValueError):
            pass
        finally:
            self.lines.put(None)

    def send(self, obj: dict[str, Any]) -> None:
        stdin = self.proc.stdin
        assert stdin is not None
        stdin.write(json.dumps(obj, ensure_ascii=True).encode("ascii") + b"\n")
        stdin.flush()

    def receive(self, timeout_s: float) -> dict[str, Any] | None:
        """Next message; ``None`` on EOF. Raises ``queue.Empty`` on timeout."""
        line = self.lines.get(timeout=timeout_s)
        if line is None:
            return None
        return json.loads(line.decode("ascii"))

    def kill(self) -> None:
        _kill_tree(self.proc)
        for stream in (self.proc.stdin, self.proc.stdout):
            try:
                if stream is not None:
                    stream.close()
            except OSError:
                pass


class CanonicalRunner:
    """Runs a canonical program's entry point on inputs in a persistent worker.

    ``run(args)`` deep-copies ``args`` inside the worker before the call and
    waits at most ``timeout_s`` seconds; on timeout the worker process tree is
    killed and a fresh worker is started on the next call. A program that
    fails to load (exception, load timeout, entry point missing) yields the
    same ``exception``/``timeout`` result for every input.
    """

    def __init__(self, program_source: str, entry_point: str,
                 timeout_s: float = CANONICAL_TIMEOUT_S, *, python: str = sys.executable,
                 startup_grace_s: float = STARTUP_GRACE_S):
        if not isinstance(entry_point, str) or not entry_point.isidentifier():
            raise ValueError(f"entry point must be an identifier, got {entry_point!r}")
        if not timeout_s > 0:
            raise ValueError("timeout_s must be positive")
        self.program_source = program_source
        self.entry_point = entry_point
        self.timeout_s = float(timeout_s)
        self.startup_grace_s = float(startup_grace_s)
        self.python = python
        self.starts = 0          # worker processes started so far
        self._worker: _Worker | None = None
        self._load_failure: CaseResult | None = None
        self._next_id = 0
        self._workdir = Path(tempfile.mkdtemp(prefix="tivr_canon_"))

    # ---- lifecycle --------------------------------------------------
    def __enter__(self) -> "CanonicalRunner":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        self._stop_worker()
        shutil.rmtree(self._workdir, ignore_errors=True)

    def __del__(self) -> None:  # best effort; close() is the supported path
        try:
            self._stop_worker()
        except Exception:
            pass

    def _stop_worker(self) -> None:
        worker, self._worker = self._worker, None
        if worker is not None:
            worker.kill()

    def _start_worker(self) -> CaseResult | None:
        """Start a worker and wait for it to load the program.

        Returns ``None`` when ready, else the load-failure result.
        """
        self._workdir.mkdir(parents=True, exist_ok=True)
        cmd = [self.python, "-c", _WORKER_SOURCE, str(REPO_ROOT), self.entry_point]
        worker = _Worker(cmd, self._workdir)
        self.starts += 1
        try:
            worker.send({"program": self.program_source})
        except OSError:
            pass  # the worker died at once; EOF is reported below
        try:
            msg = worker.receive(self.timeout_s + self.startup_grace_s)
        except queue.Empty:
            worker.kill()
            return CaseResult(STATUS_TIMEOUT, detail="program load exceeded the time limit")
        if msg is None or not msg.get("ready"):
            worker.kill()
            if msg is None:
                code = worker.proc.returncode
                return CaseResult(STATUS_EXCEPTION, exception="WorkerExit",
                                  detail=f"worker exited during program load (code {code})")
            return CaseResult(STATUS_EXCEPTION, exception=msg.get("exception") or "Exception",
                              detail="program failed to load: " + str(msg.get("detail") or ""))
        self._worker = worker
        return None

    # ---- execution --------------------------------------------------
    def run(self, args: Sequence[Any]) -> CaseResult:
        """Run the entry point on ``*args`` (a tuple or list of arguments)."""
        try:
            args_source = to_source(tuple(args))
        except Unserializable as exc:
            return CaseResult(STATUS_UNSERIALIZABLE, detail="input: " + _short(str(exc)))
        return self.run_source(args_source)

    def run_source(self, args_source: str) -> CaseResult:
        """Run the entry point on the argument tuple given as ``to_source`` text."""
        if self._load_failure is not None:
            return self._load_failure
        for attempt in (0, 1):
            if self._worker is None:
                failure = self._start_worker()
                if failure is not None:
                    self._load_failure = failure
                    return failure
            worker = self._worker
            assert worker is not None
            self._next_id += 1
            req_id = self._next_id
            try:
                worker.send({"id": req_id, "args": args_source})
            except OSError:
                # Worker died between calls: restart once and retry.
                self._stop_worker()
                if attempt == 0:
                    continue
                return CaseResult(STATUS_EXCEPTION, exception="WorkerExit",
                                  detail="worker is not accepting input")
            deadline = time.monotonic() + self.timeout_s
            while True:
                remaining = deadline - time.monotonic()
                try:
                    if remaining <= 0:
                        raise queue.Empty
                    msg = worker.receive(remaining)
                except queue.Empty:
                    # Kill the whole tree; the next call starts a fresh worker.
                    self._stop_worker()
                    return CaseResult(STATUS_TIMEOUT,
                                      detail=f"exceeded {self.timeout_s:g} s")
                if msg is None:
                    code = worker.proc.poll()
                    self._stop_worker()
                    return CaseResult(STATUS_EXCEPTION, exception="WorkerExit",
                                      detail=f"worker exited during the call (code {code})")
                if msg.get("id") == req_id:
                    break
            status = msg.get("status")
            if status == STATUS_OK:
                return CaseResult(STATUS_OK, value_source=msg["value"])
            if status == STATUS_EXCEPTION:
                return CaseResult(STATUS_EXCEPTION, exception=msg.get("exception"),
                                  detail=str(msg.get("detail") or ""))
            return CaseResult(STATUS_UNSERIALIZABLE, detail=str(msg.get("detail") or ""))
        raise AssertionError("unreachable")


def collect_cases(runner: CanonicalRunner, inputs: Iterable[Sequence[Any]]) -> CaseCollection:
    """Run every input through ``runner``; keep ``ok`` results as cases (3.1)
    and record the others as omitted inputs with their status (3.2)."""
    result = CaseCollection()
    for index, args in enumerate(inputs):
        try:
            args_source = to_source(tuple(args))
        except (Unserializable, TypeError) as exc:
            result.omitted.append(OmittedInput(index, STATUS_UNSERIALIZABLE,
                                               "input: " + _short(str(exc))))
            continue
        outcome = runner.run_source(args_source)
        if outcome.ok:
            assert outcome.value_source is not None
            result.cases.append(Case(args_source, outcome.value_source))
            result.input_indices.append(index)
        else:
            detail = outcome.detail
            if outcome.exception:
                detail = f"{outcome.exception}: {detail}" if detail else outcome.exception
            result.omitted.append(OmittedInput(index, outcome.status, _short(detail)))
    return result


# ----------------------------------------------------------------- suites ---

SUITE_HEADER = "# --- generated by tivr.scripts.prepare_common ---"


def _suite_identifier(suite_name: str) -> str:
    name = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in suite_name)
    if not name or not name.isidentifier():
        raise ValueError(f"invalid suite name {suite_name!r}")
    return name


def build_case_suite(entry_point: str, cases: Sequence[Case], atol: float, *,
                     suite_name: str) -> str:
    """Return a self-contained pytest source with one parametrized test per case.

    Each test calls the candidate entry point (imported from ``solution``) on a
    deep copy of the inputs and asserts equivalence with the expected output
    via the inlined ``_tivr_check`` (3.3-3.5); failures name the case index and
    input. All suite-level names are ``_tivr``-prefixed so they cannot shadow
    or be shadowed by the entry point.
    """
    if not isinstance(entry_point, str) or not entry_point.isidentifier() \
            or keyword.iskeyword(entry_point):
        raise ValueError(f"entry point must be an identifier, got {entry_point!r}")
    if isinstance(atol, bool) or not isinstance(atol, (int, float)) \
            or not (atol >= 0 and atol != float("inf")):
        raise ValueError(f"atol must be a finite number >= 0, got {atol!r}")
    test_name = "test_" + _suite_identifier(suite_name)
    lines = [
        SUITE_HEADER,
        "import copy as _tivr_copy",
        "",
        "import pytest as _tivr_pytest",
        "",
        f"from solution import {entry_point}",
        "",
        SUITE_HELPER_SOURCE.rstrip("\n"),
        "",
        f"_TIVR_ATOL = {float(atol)!r}",
        "_TIVR_CASES = [",
    ]
    for case in cases:
        lines.append(f"    ({case.args_source}, {case.expected_source}),")
    lines += [
        "]",
        "",
        "",
        '@_tivr_pytest.mark.parametrize("_tivr_idx", range(len(_TIVR_CASES)),',
        '                               ids=lambda i: "case%d" % i)',
        f"def {test_name}(_tivr_idx):",
        "    _tivr_args, _tivr_expected = _TIVR_CASES[_tivr_idx]",
        f"    _tivr_actual = {entry_point}(*_tivr_copy.deepcopy(_tivr_args))",
        "    _tivr_check(_tivr_actual, _tivr_expected, _TIVR_ATOL, _tivr_idx, _tivr_args)",
        "",
    ]
    return "\n".join(lines)


# ------------------------------------------------------------- validation ---

def _failure_reason(report: Any) -> str:
    if not report.complete():
        broken = [f"{name}: {status.details}".rstrip(": ")
                  for name, status in report.techniques.items()
                  if not status.complete]
        return _short("verification incomplete (" + "; ".join(broken) + ")")
    if report.correctness:
        first = report.correctness[0]
        reason = f"{first.signal}: {first.message}"
        extra = len(report.correctness) - 1
        if extra > 0:
            reason += f" (+{extra} more finding(s))"
        return _short(reason)
    return "gate failed"


def validate_suites(records: Iterable[Mapping[str, Any]],
                    suites: Sequence[str] = ("visible", "hidden"), timeout_s: float = 60, *,
                    verifier: Any = None, max_workers: int = 1,
                    progress: Callable[[str, str, bool], None] | None = None,
                    ) -> list[SuiteFailure]:
    """Run each record's ``canonical_solution`` as ``solution.py`` against its
    ``<suite>_tests`` source and return one ``SuiteFailure`` per (task, suite)
    whose verification gate does not pass (3.9, 4.5, 5.8).

    Results are in record order, then ``suites`` order. ``max_workers > 1``
    verifies in parallel threads (each verification is its own subprocess).
    """
    for suite in suites:
        if suite not in ("visible", "hidden"):
            raise ValueError(f"unknown suite {suite!r}")
    if verifier is None:
        from tivr.verifier import ProjectVerifier
        verifier = ProjectVerifier(test_timeout_s=timeout_s)

    jobs = [(record, suite) for record in records for suite in suites]

    def check(job: tuple[Mapping[str, Any], str]) -> SuiteFailure | None:
        record, suite = job
        task_id = str(record.get("task_id"))
        report = verifier.verify_candidate(record.get("canonical_solution") or "",
                                           record.get(f"{suite}_tests"), suite=suite)
        passed = report.gate_passed()
        if progress is not None:
            progress(task_id, suite, passed)
        if passed:
            return None
        return SuiteFailure(task_id, suite, _failure_reason(report),
                            report.tests_passed, report.tests_failed)

    if max_workers > 1 and len(jobs) > 1:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            outcomes = list(pool.map(check, jobs))
    else:
        outcomes = [check(job) for job in jobs]
    return [failure for failure in outcomes if failure is not None]


# ---------------------------------------------------------------- writers ---

def report_path_for(out: str | os.PathLike[str]) -> Path:
    """``<out>.report.json`` next to the output file."""
    return Path(os.fspath(out) + ".report.json")


def skipped_path_for(out: str | os.PathLike[str]) -> Path:
    """``<out>.skipped.json`` next to the output file."""
    return Path(os.fspath(out) + ".skipped.json")


def atomic_write_text(path: str | os.PathLike[str], text: str) -> Path:
    """Write ``text`` (UTF-8) to a temp file in the target directory, then
    ``os.replace`` it over ``path``. On any error the target is untouched."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp",
                                    dir=str(target.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, target)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return target


def write_jsonl_atomic(path: str | os.PathLike[str],
                       records: Iterable[Mapping[str, Any]]) -> Path:
    """One JSON object per line; NaN/Infinity are rejected before writing."""
    lines = [json.dumps(dict(record), ensure_ascii=False, allow_nan=False)
             for record in records]
    return atomic_write_text(path, "".join(line + "\n" for line in lines))


def _jsonable(value: Any) -> Any:
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


def _write_json(path: Path, payload: Any) -> Path:
    text = json.dumps(payload, ensure_ascii=False, allow_nan=False, indent=2,
                      default=_jsonable)
    return atomic_write_text(path, text + "\n")


def write_report(path: str | os.PathLike[str], report: Mapping[str, Any]) -> Path:
    """Write the preparation report (omitted inputs, skips, canonical failures)."""
    return _write_json(Path(path), dict(report))


def write_skipped(path: str | os.PathLike[str], skipped: Sequence[Mapping[str, Any]]) -> Path:
    """Write the skipped-records report: a JSON array of ``{id, reason, ...}``."""
    return _write_json(Path(path), [dict(item) for item in skipped])
