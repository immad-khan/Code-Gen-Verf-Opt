"""Signal enrichment: verifier observations -> enriched blocking ``Finding``s.

All taxonomy-relevant semantics live here so the shared mapping rules stay
plain regexes over the enriched signal (design D2, "Enriched signal grammar"):

```
signal      := "no_code_output" | "timeout" | functional | staged
functional  := "functional:" ("format" | "logic" | "unextractable")
staged      := stage ":" ExceptionClass [ ":" qualifier ]
stage       := "syntax" | "import" | "collection" | "runtime"
qualifier   := "llm_defined" | "stdlib_unbound" | "candidate" | "external"
```

Inputs are plain data (compile exceptions, static-import results, the JSON
report written by ``tivr.pytest_plugin``, pytest output text); nothing here
runs a subprocess. Rules (design "Enrichment rules"):

* Origin (9.9): an ``AssertionError`` raised by the suite itself
  (``from_suite_assert``) is functional; every other exception is a runtime
  finding named by its exact outermost class (9.8).
* ``llm_defined`` (9.7): the exception class lives in a candidate module, or
  (for a non-builtin class) its name is defined by a ``class`` statement in a
  candidate source.
* ``stdlib_unbound`` (8.5): ``NameError`` for an identifier that is a stdlib
  module or public member and that no import in the candidate binds.
* ImportError target (8.4, 8.7): ``candidate`` when ``ImportError.name`` (or
  the ``from 'X'`` module in the message) is a candidate module or a submodule
  of one, otherwise ``external``. Undeterminable targets get no qualifier.
* Qualifier precedence: ``llm_defined`` > ``stdlib_unbound`` >
  ``candidate``/``external``.
* Grouping: runtime/collection findings sharing signal and first message line
  become one finding with ``occurrences``; at most ``MAX_RUNTIME_FINDINGS``.
* Functional aggregate (10.1, 10.5): every suite-assert failure goes into one
  finding classified by ``normalize.classify_functional`` over all failing
  assertions' actual/expected values (test names and messages never count).
* Text fallback: a collection error without a live exception is classified
  from its last ``E   <Exc>: <msg>`` line; nothing identifiable ->
  ``collection:unknown`` (no rule matches -> UNMAPPED, 8.8).
"""
from __future__ import annotations

import ast
import re
import traceback
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from tivr import normalize
from tivr.equivalence import SourceError, from_source
from tivr.schemas import BLOCKING, AssertionValues, Finding, Location
from tivr.stdlib_index import is_stdlib_name

__all__ = [
    "EVIDENCE_MAX_LINES",
    "MAX_RUNTIME_FINDINGS",
    "MAX_SHOWN_VALUES",
    "MAX_VALUE_CHARS",
    "EnrichContext",
    "collection_finding_from_text",
    "findings_from_report",
    "import_finding",
    "syntax_finding",
    "test_counts",
    "timeout_finding",
]

EVIDENCE_MAX_LINES = 40
MAX_RUNTIME_FINDINGS = 5
MAX_SHOWN_VALUES = 3
#: Captured values longer than this count as not extractable (design §2).
MAX_VALUE_CHARS = 100_000
_SHOWN_VALUE_CHARS = 200

# ``name 'x' is not defined`` (3.12+ may append ". Did you forget to import 'x'?").
_NAME_ERROR_RE = re.compile(r"name '([A-Za-z_][A-Za-z0-9_]*)' is not defined")
# ``cannot import name 'f' from 'solution' (...)`` / ``... from partially initialized module 'm' ...``
_FROM_TARGET_RE = re.compile(r"\bfrom (?:partially initialized module )?'([A-Za-z_][\w.]*)'")
# pytest ``E   <Exc>: <msg>`` lines; the class may be dotted (``pkg.errors.Bad``).
_E_LINE_RE = re.compile(
    r"^E\s+((?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*?"
    r"(?:Error|Exception|Exit|Interrupt|Iteration|Warning|Group))"
    r"(?::[ \t]*(.*?))?[ \t]*$",
    re.MULTILINE,
)
# ``--tb=short`` frame header: ``path/to/file.py:12: in func``.
_TB_FRAME_RE = re.compile(r"(?m)^\s*(\S.*?):(\d+): in \S")
# Wrapper classes pytest uses when it could not attach the real cause.
_WRAPPER_TYPES = frozenset({"CollectError"})


# --------------------------------------------------------------- context ---

@dataclass
class EnrichContext:
    """What enrichment needs to know about the candidate program.

    ``candidate_modules`` are dotted module names of the LLM-written code
    (``{"solution"}`` for benchmarks). ``candidate_sources`` are their source
    texts (a mapping path -> source, or an iterable of sources).
    """

    candidate_modules: Iterable[str] = ()
    candidate_sources: Mapping[str, str] | Iterable[str] = ()
    is_stdlib: Callable[[str], bool] = is_stdlib_name
    modules: frozenset[str] = field(init=False)
    class_names: frozenset[str] = field(init=False)
    import_bound: frozenset[str] = field(init=False)

    def __post_init__(self) -> None:
        self.modules = frozenset(m for m in self.candidate_modules if m)
        sources = (self.candidate_sources.values()
                   if isinstance(self.candidate_sources, Mapping)
                   else self.candidate_sources)
        classes: set[str] = set()
        bound: set[str] = set()
        for source in sources:
            try:
                tree = ast.parse(source)
            except (SyntaxError, ValueError, RecursionError):
                continue  # the syntax stage reports unparseable files
            for node in ast.walk(tree):
                if isinstance(node, ast.ClassDef):
                    classes.add(node.name)
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        bound.add(alias.asname or alias.name.split(".")[0])
                elif isinstance(node, ast.ImportFrom):
                    for alias in node.names:
                        if alias.name != "*":
                            bound.add(alias.asname or alias.name)
        self.class_names = frozenset(classes)
        self.import_bound = frozenset(bound)

    def is_candidate_module(self, name: str | None) -> bool:
        """``name`` is a candidate module or a submodule of one."""
        if not name:
            return False
        return any(name == m or name.startswith(m + ".") for m in self.modules)

    def is_llm_defined(self, exc_type: str, exc_module: str | None) -> bool:
        if self.is_candidate_module(exc_module):
            return True
        # A builtin class is never the one a candidate ``class`` statement made,
        # even when the candidate shadows its name.
        if exc_module == "builtins":
            return False
        return exc_type in self.class_names

    def is_stdlib_unbound(self, identifier: str) -> bool:
        return identifier not in self.import_bound and bool(self.is_stdlib(identifier))


# --------------------------------------------------------------- helpers ---

def _trim(text: str | None, max_lines: int = EVIDENCE_MAX_LINES) -> str:
    """Keep evidence within ``max_lines``, favouring the tail (the exception line)."""
    lines = (text or "").strip("\n").splitlines()
    if len(lines) <= max_lines:
        return "\n".join(lines)
    head = 3
    tail = max_lines - head - 1
    return "\n".join(lines[:head] + ["... [trimmed] ..."] + lines[-tail:])


def _first_line(text: str | None) -> str:
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()
    return ""


def _qualifier(ctx: EnrichContext, exc_type: str, exc_module: str | None,
               message: str, import_name: str | None) -> str | None:
    if ctx.is_llm_defined(exc_type, exc_module):
        return "llm_defined"
    if exc_type == "NameError":
        m = _NAME_ERROR_RE.search(message or "")
        if m and ctx.is_stdlib_unbound(m.group(1)):
            return "stdlib_unbound"
        return None
    if exc_type == "ImportError":
        target = import_name
        if not target:
            m = _FROM_TARGET_RE.search(message or "")
            target = m.group(1) if m else None
        if target:
            return "candidate" if ctx.is_candidate_module(target) else "external"
    return None


def _signal(stage: str, exc_type: str, qualifier: str | None) -> str:
    return f"{stage}:{exc_type}" + (f":{qualifier}" if qualifier else "")


def _location(raised_in: str | None, longrepr: str | None) -> Location | None:
    if not raised_in:
        return None
    line = None
    if longrepr:
        # ``--tb=short`` frame headers look like ``<path>:<line>: in <func>``; the
        # path may be relative to a different directory or use backslashes.
        want = raised_in.replace("\\", "/")
        for m in _TB_FRAME_RE.finditer(longrepr.replace("\\", "/")):
            path = m.group(1)
            if path == want or path.endswith("/" + want) or want.endswith("/" + path):
                line = int(m.group(2))
    return Location(file=raised_in, line=line)


def _exception_finding(ctx: EnrichContext, stage: str, technique: str,
                       exc: Mapping[str, Any], test_id: str | None,
                       longrepr: str | None) -> Finding:
    exc_type = str(exc.get("type") or "unknown")
    message = str(exc.get("message") or "")
    qualifier = _qualifier(ctx, exc_type, exc.get("module"), message, exc.get("import_name"))
    first = _first_line(message)
    header = f"{exc_type}: {first}" if first else exc_type
    body = _trim(longrepr, EVIDENCE_MAX_LINES - 1)
    evidence = header if not body else f"{header}\n{body}"
    return Finding(
        technique=technique,
        severity=BLOCKING,
        signal=_signal(stage, exc_type, qualifier),
        message=first or exc_type,
        evidence=evidence,
        exception=exc_type,
        location=_location(exc.get("raised_in"), longrepr),
        test_id=test_id,
    )


def _group(findings: list[Finding], limit: int = MAX_RUNTIME_FINDINGS) -> list[Finding]:
    """Merge findings sharing signal + message (first occurrence kept); cap at ``limit``."""
    grouped: dict[tuple[str, str], Finding] = {}
    for f in findings:
        key = (f.signal, f.message)
        if key in grouped:
            grouped[key].occurrences += f.occurrences
        else:
            grouped[key] = f
    return list(grouped.values())[:limit]


# ------------------------------------------------------ stage finders ---

def syntax_finding(exc: BaseException, file: str = "solution.py") -> Finding:
    """Finding for a ``compile()`` failure: ``syntax:<exact class>``."""
    exc_type = type(exc).__name__
    if isinstance(exc, SyntaxError):
        message = exc.msg or str(exc)
        line = exc.lineno
    else:  # e.g. ValueError for null bytes on older interpreters
        message, line = str(exc), None
    report = "".join(traceback.format_exception_only(type(exc), exc))
    return Finding(
        technique="syntax",
        severity=BLOCKING,
        signal=f"syntax:{exc_type}",
        message=_first_line(message) or exc_type,
        evidence=_trim(report),
        exception=exc_type,
        location=Location(file=file, line=line),
    )


def import_finding(module: str, file: str = "solution.py", line: int | None = None,
                   statement: str | None = None) -> Finding:
    """Finding for an unresolvable module-level import: ``import:ModuleNotFoundError``."""
    message = f"No module named '{module}'"
    evidence = message if not statement else f"{statement.strip()}\nModuleNotFoundError: {message}"
    return Finding(
        technique="imports",
        severity=BLOCKING,
        signal="import:ModuleNotFoundError",
        message=message,
        evidence=evidence,
        exception="ModuleNotFoundError",
        location=Location(file=file, line=line),
    )


def timeout_finding(limit_s: float) -> Finding:
    """Finding for a test subprocess that exceeded the time limit (9.6)."""
    limit = int(limit_s) if float(limit_s).is_integer() else limit_s
    return Finding(
        technique="tests",
        severity=BLOCKING,
        signal="timeout",
        message=f"test execution exceeded the {limit} s time limit",
        evidence=f"test subprocess killed after {limit} s (possible infinite loop "
                 "or excessive complexity)",
    )


def collection_finding_from_text(text: str | None, ctx: EnrichContext,
                                 nodeid: str | None = None) -> Finding:
    """Classify a collection error from pytest text via its last ``E   <Exc>: <msg>`` line."""
    matches = list(_E_LINE_RE.finditer(text or ""))
    if not matches:
        first = _first_line(text)
        return Finding(
            technique="tests",
            severity=BLOCKING,
            signal="collection:unknown",
            message=first or "test collection failed with no identifiable exception",
            evidence=_trim(text) or "test collection failed with no output",
            test_id=nodeid,
        )
    last = matches[-1]
    dotted, message = last.group(1), (last.group(2) or "")
    module, _, exc_type = dotted.rpartition(".")
    exc = {"type": exc_type, "module": module or None, "message": message}
    return _exception_finding(ctx, "collection", "tests", exc, nodeid, text)


# --------------------------------------------------- functional aggregate ---

def _parse_value(text: Any) -> Any:
    if not isinstance(text, str) or len(text) > MAX_VALUE_CHARS:
        return normalize.MISSING
    try:
        return from_source(text)
    except SourceError:
        return normalize.MISSING


@dataclass
class _Parsed:
    actual: Any
    expected: Any


def _assertion_values(entry: Mapping[str, Any]) -> AssertionValues:
    tivr = entry.get("tivr_values") or {}
    compare = entry.get("compare") or {}
    if compare.get("op", "==") != "==":
        compare = {}
    actual = tivr.get("actual")
    expected = tivr.get("expected")
    if actual is None:
        actual = compare.get("actual")
    if expected is None:
        expected = compare.get("expected")
    return AssertionValues(input=tivr.get("input"), actual=actual, expected=expected)


def _short(text: str | None) -> str:
    if text is None:
        return "<not extractable>"
    return text if len(text) <= _SHOWN_VALUE_CHARS else text[:_SHOWN_VALUE_CHARS] + "..."


def _functional_finding(entries: list[Mapping[str, Any]]) -> Finding:
    values = [_assertion_values(e) for e in entries]
    parsed = [_Parsed(_parse_value(v.actual), _parse_value(v.expected)) for v in values]
    kind = normalize.classify_functional(parsed)
    n = len(entries)
    first_msg = _first_line((entries[0].get("exception") or {}).get("message"))
    message = f"{n} failing suite assertion{'s' if n != 1 else ''}"
    if first_msg:
        message += f"; first: {first_msg}"
    lines: list[str] = []
    for entry, v in zip(entries[:MAX_SHOWN_VALUES], values):
        lines.append(f"{entry.get('nodeid')}: AssertionError: "
                     f"{_first_line((entry.get('exception') or {}).get('message'))}".rstrip())
        if v.input is not None:
            lines.append(f"  input:    {_short(v.input)}")
        lines.append(f"  actual:   {_short(v.actual)}")
        lines.append(f"  expected: {_short(v.expected)}")
    if n > MAX_SHOWN_VALUES:
        lines.append(f"... and {n - MAX_SHOWN_VALUES} more failing assertion(s)")
    return Finding(
        technique="tests",
        severity=BLOCKING,
        signal=f"functional:{kind}",
        message=message,
        evidence=_trim("\n".join(lines)),
        exception="AssertionError",
        test_id=entries[0].get("nodeid"),
        occurrences=n,
        values=values[:MAX_SHOWN_VALUES],
    )


# ------------------------------------------------------------ report ---

def findings_from_report(report: Mapping[str, Any] | None, ctx: EnrichContext, *,
                         fallback_text: str | None = None) -> list[Finding]:
    """Enriched findings from a ``tivr.pytest_plugin`` report.

    Order: collection findings, runtime findings (together grouped and capped
    at ``MAX_RUNTIME_FINDINGS``), then the single functional aggregate.
    When ``report`` is ``None`` (the plugin never wrote it) the run is treated
    as a collection failure classified from ``fallback_text``.
    """
    if report is None:
        return [collection_finding_from_text(fallback_text, ctx)]

    staged: list[Finding] = []
    for err in report.get("collection_errors") or []:
        exc = err.get("exception")
        nodeid = err.get("nodeid")
        if exc and exc.get("type") and exc.get("type") not in _WRAPPER_TYPES:
            staged.append(_exception_finding(ctx, "collection", "tests", exc, nodeid,
                                             exc.get("longrepr")))
        else:
            text = (exc or {}).get("longrepr") or err.get("longrepr") or (exc or {}).get("message")
            staged.append(collection_finding_from_text(text, ctx, nodeid))

    functional: list[Mapping[str, Any]] = []
    for entry in report.get("tests") or []:
        if entry.get("outcome") != "failed":
            continue
        exc = entry.get("exception")
        nodeid = entry.get("nodeid")
        if not exc:
            staged.append(_text_runtime_finding(entry.get("longrepr"), ctx, nodeid))
        elif exc.get("from_suite_assert"):
            functional.append(entry)
        else:
            staged.append(_exception_finding(ctx, "runtime", "runtime", exc, nodeid,
                                             exc.get("longrepr")))

    findings = _group(staged)
    if functional:
        findings.append(_functional_finding(functional))
    return findings


def _text_runtime_finding(text: str | None, ctx: EnrichContext, nodeid: str | None) -> Finding:
    """A failed test with no captured exception: classify from its ``E`` line."""
    finding = collection_finding_from_text(text, ctx, nodeid)
    finding.technique = "runtime"
    finding.signal = "runtime:" + finding.signal.split(":", 1)[1]
    return finding


def test_counts(report: Mapping[str, Any] | None) -> tuple[int, int]:
    """(passed, failed) tests; collection errors count as failures."""
    if not report:
        return 0, 0
    tests = report.get("tests") or []
    passed = sum(1 for t in tests if t.get("outcome") == "passed")
    failed = sum(1 for t in tests if t.get("outcome") == "failed")
    return passed, failed + len(report.get("collection_errors") or [])


# Not a pytest test despite the name.
test_counts.__test__ = False  # type: ignore[attr-defined]
