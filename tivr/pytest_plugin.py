"""pytest plugin that records structured test outcomes for the verifier.

Loaded in the verifier's pytest subprocess with ``-p tivr.pytest_plugin``.
When the ``TIVR_PYTEST_REPORT`` environment variable names a file, the plugin
writes a JSON report there at session end (design "pytest plugin report"):

* per test: outcome, phase, the exact class/module of the raised exception,
  the file the exception was raised in, whether an ``AssertionError`` came
  from the suite itself (``from_suite_assert``, Requirement 9.9), the
  ``--tb`` text, the operands of a failing ``==`` assertion and the
  ``_tivr_*`` values attached by the inlined suite helper (Requirement 10.5);
* per collection error: the underlying live exception (unwrapped from
  pytest's ``CollectError``), including ``ImportError.name`` (Requirement 8.7).

Exception classes are taken from the exception object itself, never from the
pytest text, so the taxonomy can rely on exact outermost class names
(Requirement 9.8). Without ``TIVR_PYTEST_REPORT`` the plugin does nothing.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

import pytest

from tivr.equivalence import Unserializable, to_source

REPORT_ENV = "TIVR_PYTEST_REPORT"

# Caps that keep the report bounded. A captured value whose text exceeds
# VALUE_MAX_CHARS is recorded as null (treated downstream as "cannot be
# extracted") rather than truncated into an unparseable or misleading value.
VALUE_MAX_CHARS = 200_000
MESSAGE_MAX_CHARS = 10_000
LONGREPR_MAX_CHARS = 20_000

_MISSING = object()


def _cap(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n... [truncated]"


def _value_text(value: Any) -> Optional[str]:
    """``to_source`` text for ``value``; ``repr`` when it is not serializable."""
    try:
        text = to_source(value)
    except Unserializable:
        try:
            text = repr(value)
        except Exception:
            return None
    except Exception:
        return None
    if len(text) > VALUE_MAX_CHARS:
        return None
    return text


def _message(exc: BaseException) -> str:
    try:
        text = str(exc)
    except Exception:
        text = f"<unprintable {type(exc).__name__}>"
    return _cap(text, MESSAGE_MAX_CHARS)


def _innermost_file(exc: BaseException) -> Optional[str]:
    """Source file of the frame where ``exc`` was raised.

    Uses the raw ``__traceback__`` rather than pytest's pruned traceback so
    hidden or filtered frames cannot change the answer.
    """
    tb = exc.__traceback__
    if tb is None:
        return None
    while tb.tb_next is not None:
        tb = tb.tb_next
    return tb.tb_frame.f_code.co_filename


def _norm(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return _value_text(value)


class _Recorder:
    """Collects outcomes during the session and writes them as JSON."""

    def __init__(self, report_path: str) -> None:
        self.report_path = report_path
        self.rootpath: Optional[Path] = None
        self.current_item: Optional[pytest.Item] = None
        self.compares: dict[str, dict[str, Any]] = {}
        self.tests: dict[str, dict[str, Any]] = {}
        self.collection_errors: dict[str, dict[str, Any]] = {}
        self.test_files: set[str] = set()

    # -- helpers ---------------------------------------------------------

    def _rel(self, filename: Optional[str]) -> Optional[str]:
        if filename is None:
            return None
        if self.rootpath is not None:
            try:
                return Path(filename).resolve().relative_to(self.rootpath).as_posix()
            except (ValueError, OSError):
                pass
        return Path(filename).as_posix()

    def _exception_info(
        self, exc: BaseException, longrepr: Any, item_file: Optional[str]
    ) -> dict[str, Any]:
        raised_file = _innermost_file(exc)
        from_suite_assert = False
        if isinstance(exc, AssertionError) and raised_file is not None:
            norm = _norm(raised_file)
            from_suite_assert = norm in self.test_files or (
                item_file is not None and norm == _norm(item_file)
            )
        info: dict[str, Any] = {
            "type": type(exc).__name__,
            "module": type(exc).__module__,
            "message": _message(exc),
            "from_suite_assert": from_suite_assert,
            "raised_in": self._rel(raised_file),
            "longrepr": _cap(str(longrepr), LONGREPR_MAX_CHARS) if longrepr is not None else None,
        }
        if isinstance(exc, ImportError):
            info["import_name"] = exc.name
        return info

    @staticmethod
    def _tivr_values(exc: BaseException) -> Optional[dict[str, Any]]:
        attrs = {
            key: getattr(exc, f"_tivr_{key}", _MISSING)
            for key in ("case", "input", "actual", "expected")
        }
        if all(value is _MISSING for value in attrs.values()):
            return None
        values: dict[str, Any] = {}
        for key, value in attrs.items():
            if value is _MISSING:
                values[key] = None
            elif key == "case":
                values[key] = _jsonable(value)
            else:
                values[key] = _value_text(value)
        return values

    # -- hooks -----------------------------------------------------------

    @pytest.hookimpl(trylast=True)
    def pytest_collection_modifyitems(self, items: list[pytest.Item]) -> None:
        for item in items:
            path = getattr(item, "path", None)
            if path is not None:
                self.test_files.add(_norm(str(path)))

    @pytest.hookimpl(hookwrapper=True)
    def pytest_runtest_call(self, item: pytest.Item):
        self.current_item = item
        self.compares.pop(item.nodeid, None)
        try:
            yield
        finally:
            self.current_item = None

    def pytest_assertrepr_compare(self, config: pytest.Config, op: str, left: Any, right: Any):
        try:
            if op == "==" and self.current_item is not None:
                self.compares[self.current_item.nodeid] = {
                    "op": "==",
                    "actual": _value_text(left),
                    "expected": _value_text(right),
                }
        except Exception:
            pass
        return None

    @pytest.hookimpl(hookwrapper=True)
    def pytest_runtest_makereport(self, item: pytest.Item, call: pytest.CallInfo):
        outcome = yield
        try:
            report = outcome.get_result()
            self._record_test(item, call, report)
        except Exception:
            pass

    def _record_test(self, item: pytest.Item, call: pytest.CallInfo, report: Any) -> None:
        existing = self.tests.get(report.nodeid)
        if report.failed:
            if existing is not None and existing["outcome"] == "failed":
                return
        elif existing is not None or not (report.when == "call" or report.skipped):
            return

        entry: dict[str, Any] = {
            "nodeid": report.nodeid,
            "outcome": report.outcome,
            "when": report.when,
        }
        excinfo = call.excinfo
        if report.failed and excinfo is not None:
            exc = excinfo.value
            item_path = getattr(item, "path", None)
            entry["exception"] = self._exception_info(
                exc, report.longrepr, str(item_path) if item_path is not None else None
            )
            if report.when == "call":
                compare = self.compares.get(report.nodeid)
                if compare is not None:
                    entry["compare"] = compare
            tivr_values = self._tivr_values(exc)
            if tivr_values is not None:
                entry["tivr_values"] = tivr_values
        elif report.failed and report.longrepr is not None:
            entry["longrepr"] = _cap(str(report.longrepr), LONGREPR_MAX_CHARS)
        self.tests[report.nodeid] = entry

    def pytest_exception_interact(self, node: Any, call: pytest.CallInfo, report: Any) -> None:
        try:
            if not isinstance(report, pytest.CollectReport) or call.excinfo is None:
                return
            exc = call.excinfo.value
            # pytest wraps ImportError/SyntaxError in CollectError ``from e``.
            if isinstance(exc, pytest.Collector.CollectError) and exc.__cause__ is not None:
                exc = exc.__cause__
            info = self._exception_info(exc, report.longrepr, None)
            info.pop("from_suite_assert", None)
            self.collection_errors[report.nodeid] = {"nodeid": report.nodeid, "exception": info}
        except Exception:
            pass

    def pytest_collectreport(self, report: pytest.CollectReport) -> None:
        # Fallback for collection failures that never reach exception_interact:
        # keep the text so the verifier can still parse it.
        try:
            if report.failed and report.nodeid not in self.collection_errors:
                self.collection_errors[report.nodeid] = {
                    "nodeid": report.nodeid,
                    "exception": None,
                    "longrepr": _cap(str(report.longrepr), LONGREPR_MAX_CHARS),
                }
        except Exception:
            pass

    def pytest_sessionstart(self, session: pytest.Session) -> None:
        try:
            self.rootpath = Path(session.config.rootpath).resolve()
        except Exception:
            self.rootpath = None

    def pytest_sessionfinish(self, session: pytest.Session, exitstatus: Any) -> None:
        data = {
            "exitstatus": int(exitstatus),
            "tests": list(self.tests.values()),
            "collection_errors": list(self.collection_errors.values()),
        }
        target = Path(self.report_path)
        tmp = target.with_name(target.name + ".tmp")
        tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
        os.replace(tmp, target)


def pytest_configure(config: pytest.Config) -> None:
    report_path = os.environ.get(REPORT_ENV)
    if report_path:
        config.pluginmanager.register(_Recorder(report_path), "tivr_recorder")
