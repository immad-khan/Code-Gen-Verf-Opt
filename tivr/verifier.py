"""ProjectVerifier: syntax, imports, tests and runtime (+ optional advisory techniques).

design.md §2 "ProjectVerifier". Stages run fail-fast:

1. ``no_code_output`` (8.6, ``verify_candidate`` only): the LLM response had no
   fenced Python block and its text is empty or does not compile -> exactly one
   blocking finding (technique ``syntax``) and stop.
2. syntax: ``compile(source, path, "exec")`` per ``.py`` file of the project
   (``compile`` rather than ``ast.parse`` so symtable errors such as
   ``import *`` inside a function are caught, 8.3).
3. imports (static): module-level ``import``/``from`` statements of candidate
   files only. Statements inside ``def``/``class`` bodies, inside a ``try``
   whose handlers catch ``ImportError`` (or a superclass), under
   ``if TYPE_CHECKING:`` or under ``if __name__ == "__main__":`` are left to
   runtime, so a never-executed import does not fail a passing candidate.
   Resolution: stdlib names, project-local modules, else
   ``importlib.util.find_spec`` (top-level name only; nothing is executed).
   Relative imports are left to runtime.
4. tests + runtime: ``python -m pytest -q -p no:cacheprovider
   -p tivr.pytest_plugin --tb=short`` in the project dir with
   ``PYTHONPATH=<project>;<repo root>`` and ``TIVR_PYTEST_REPORT``. An empty
   scratch ini (``-c``) plus ``--rootdir``/``--confcutdir`` pinned to the
   project keep any surrounding ``pytest.ini``/``conftest.py`` (e.g. this
   repository's) out of the run; third-party plugin autoload is disabled by
   default (``plugin_autoload``). Exceeding ``test_timeout_s`` kills the whole
   process tree and yields one ``timeout`` finding (9.6). Without test files an
   import-smoke module importing every candidate module is run instead, so
   module-level errors still surface (12.8).
5. advisory (optional, off by default): mypy / radon / semgrep findings, all
   ``advisory`` and never mapped (20.1). A tool that cannot run yields one
   advisory "technique did not run" finding (20.8) and never touches the gate.

Correctness findings are mapped with ``TaxonomyMapper``; the gate is
``VerificationReport.gate_passed()`` (19.5). Technique status ``error``
(harness failure, e.g. the interpreter cannot be started) makes the report
incomplete.
"""
from __future__ import annotations

import ast
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import traceback
import warnings
from dataclasses import dataclass
from pathlib import Path

from tivr import enrich
from tivr.enrich import EnrichContext
from tivr.schemas import (
    ADVISORY,
    BLOCKING,
    STATUS_ERROR,
    STATUS_FAIL,
    STATUS_NO_TESTS,
    STATUS_PASS,
    STATUS_SKIPPED_UPSTREAM,
    Finding,
    Location,
    TechniqueStatus,
    VerificationReport,
)
from tivr.taxonomy import TaxonomyMapper, default_mapper
from tivr.taxonomy_def import TaxonomyDefinition

__all__ = [
    "DEFAULT_TEST_TIMEOUT_S",
    "TOOL_TIMEOUT_S",
    "ProjectVerifier",
]

DEFAULT_TEST_TIMEOUT_S = 60
TOOL_TIMEOUT_S = 45            # per advisory tool
MAX_IMPORT_FINDINGS = 5
MAX_ADVISORY_PER_TOOL = 5
_KILL_WAIT_S = 10

REPO_ROOT = Path(__file__).resolve().parents[1]
SOLUTION_FILE = "solution.py"
TEST_FILE = "test_solution.py"
_SMOKE_FILE = "test_tivr_import_smoke.py"

_STDLIB = frozenset(sys.stdlib_module_names)
_SKIP_DIRS = frozenset({"__pycache__", "node_modules", "site-packages", "venv", "env",
                        "build", "dist"})
_IMPORT_ERROR_CATCHERS = frozenset({"ImportError", "ModuleNotFoundError",
                                    "Exception", "BaseException"})
_MYPY_LINE_RE = re.compile(r"^(?P<file>[^:\n]+\.py):(?P<line>\d+):(?:\d+:)?\s*error:\s*"
                           r"(?P<msg>.*?)(?:\s+\[(?P<code>[\w-]+)\])?\s*$")


# ------------------------------------------------------------ subprocess ---

@dataclass
class _ProcResult:
    returncode: int | None
    output: str
    timed_out: bool


def _kill_tree(proc: subprocess.Popen) -> None:
    """Kill ``proc`` and every process it started (Windows-safe)."""
    if proc.poll() is not None:
        return
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


def _run(cmd: list[str], *, cwd: Path, env: dict[str, str] | None,
         timeout_s: float) -> _ProcResult:
    """Run ``cmd`` in its own process group; on timeout kill the whole tree.

    Raises ``OSError`` when the program cannot be started.
    """
    kwargs: dict = {}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    proc = subprocess.Popen(cmd, cwd=str(cwd), env=env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)
    timed_out = False
    try:
        try:
            out, _ = proc.communicate(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            _kill_tree(proc)
            try:
                out, _ = proc.communicate(timeout=_KILL_WAIT_S)
            except subprocess.TimeoutExpired:
                out = b""
    except BaseException:
        _kill_tree(proc)
        raise
    text = (out or b"").decode("utf-8", errors="replace")
    return _ProcResult(None if timed_out else proc.returncode, text, timed_out)


def _tail(text: str, lines: int = 20) -> str:
    return "\n".join(text.strip().splitlines()[-lines:])


# ------------------------------------------------------------ project files ---

@dataclass
class _SourceFile:
    rel: str            # posix path relative to the project dir
    module: str         # dotted module name
    data: bytes


def _is_test_file(name: str) -> bool:
    return (name.startswith("test_") and name.endswith(".py")) or name.endswith("_test.py")


def _module_name(rel: Path) -> str:
    parts = list(rel.with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def _discover(project_dir: Path) -> list[_SourceFile]:
    files: list[_SourceFile] = []
    for root, dirs, names in os.walk(project_dir):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in _SKIP_DIRS)
        for name in sorted(names):
            if not name.endswith(".py"):
                continue
            path = Path(root) / name
            rel = path.relative_to(project_dir)
            try:
                data = path.read_bytes()
            except OSError:
                continue
            files.append(_SourceFile(rel.as_posix(), _module_name(rel), data))
    return files


def _in_modules(module: str, modules: set[str]) -> bool:
    return any(module == m or module.startswith(m + ".") for m in modules)


def _decode(data: bytes) -> str:
    try:
        return importlib.util.decode_source(data)
    except (SyntaxError, UnicodeDecodeError, LookupError):
        return data.decode("utf-8", errors="replace")




def _handler_names(node: ast.expr | None) -> set[str]:
    if node is None:
        return {"BaseException"}  # bare except
    if isinstance(node, ast.Tuple):
        out: set[str] = set()
        for elt in node.elts:
            out |= _handler_names(elt)
        return out
    if isinstance(node, ast.Name):
        return {node.id}
    if isinstance(node, ast.Attribute):
        return {node.attr}
    return set()


def _catches_import_error(handlers: list[ast.ExceptHandler]) -> bool:
    return any(_handler_names(h.type) & _IMPORT_ERROR_CATCHERS for h in handlers)


def _is_type_checking(test: ast.expr) -> bool:
    return ((isinstance(test, ast.Name) and test.id == "TYPE_CHECKING")
            or (isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING"))


def _is_main_guard(test: ast.expr) -> bool:
    if not (isinstance(test, ast.Compare) and len(test.ops) == 1
            and isinstance(test.ops[0], ast.Eq)):
        return False
    sides = [test.left, test.comparators[0]]
    has_name = any(isinstance(s, ast.Name) and s.id == "__name__" for s in sides)
    has_main = any(isinstance(s, ast.Constant) and s.value == "__main__" for s in sides)
    return has_name and has_main


def module_level_imports(tree: ast.Module) -> list[ast.Import | ast.ImportFrom]:
    """Import statements executed when the module is imported (see module docstring)."""
    out: list[ast.Import | ast.ImportFrom] = []
    try_types = tuple(t for t in (ast.Try, getattr(ast, "TryStar", None)) if t)

    def visit(stmts: list[ast.stmt]) -> None:
        for node in stmts:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                out.append(node)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            elif isinstance(node, try_types):
                if not _catches_import_error(node.handlers):
                    visit(node.body)
                for handler in node.handlers:
                    visit(handler.body)
                visit(node.orelse)
                visit(node.finalbody)
            elif isinstance(node, ast.If):
                if not (_is_type_checking(node.test) or _is_main_guard(node.test)):
                    visit(node.body)
                visit(node.orelse)
            elif isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
                visit(node.body)
                visit(node.orelse)
            elif isinstance(node, (ast.With, ast.AsyncWith)):
                visit(node.body)
            elif isinstance(node, ast.Match):
                for case in node.cases:
                    visit(case.body)

    visit(tree.body)
    return out


def _local_tops(files: list[_SourceFile]) -> set[str]:
    return {f.module.split(".")[0] for f in files if f.module}


def _missing_local(project_dir: Path, dotted: str) -> str | None:
    """First dotted prefix of ``dotted`` that does not exist in the project, else ``None``."""
    path = project_dir
    parts = dotted.split(".")
    for i, part in enumerate(parts):
        pkg = path / part
        if (pkg / "__init__.py").is_file():
            path = pkg
        elif (path / f"{part}.py").is_file():
            if i != len(parts) - 1:
                return ".".join(parts[: i + 2])  # submodule of a plain module
            return None
        elif pkg.is_dir():
            path = pkg  # namespace package
        else:
            return ".".join(parts[: i + 1])
    return None


def _missing_import(name: str, project_dir: Path, local_tops: set[str]) -> str | None:
    """Module name that cannot be resolved for ``import name``, else ``None``."""
    top = name.split(".")[0]
    if top in _STDLIB:
        return None
    if top in local_tops:
        return _missing_local(project_dir, name)
    try:
        spec = importlib.util.find_spec(top)
    except (ImportError, ValueError):
        spec = None
    except Exception:
        return None  # a broken finder is not evidence of a missing module
    return None if spec is not None else top


# ------------------------------------------------------------ verifier ---

class ProjectVerifier:
    """Runs the verification pipeline on a project directory or a single candidate."""

    def __init__(self, definition: TaxonomyDefinition | None = None, *,
                 test_timeout_s: float = DEFAULT_TEST_TIMEOUT_S, advisory: bool = False,
                 python: str = sys.executable, tool_timeout_s: float = TOOL_TIMEOUT_S,
                 semgrep: str = "semgrep", semgrep_config: str | None = None,
                 plugin_autoload: bool = False):
        """``plugin_autoload=False`` (default) sets ``PYTEST_DISABLE_PLUGIN_AUTOLOAD``
        in the test subprocess: installed third-party pytest plugins neither slow
        down nor influence verification; ``tivr.pytest_plugin`` is loaded explicitly.
        """
        self.mapper = TaxonomyMapper(definition) if definition is not None else default_mapper()
        self.definition = self.mapper.definition
        self.test_timeout_s = test_timeout_s
        self.advisory = advisory
        self.python = python
        self.tool_timeout_s = tool_timeout_s
        self.semgrep = semgrep
        self.plugin_autoload = plugin_autoload
        self.semgrep_config = (semgrep_config or os.environ.get("TIVR_SEMGREP_CONFIG")
                               or "p/python")

    # ---- entry points ------------------------------------------------
    def verify_candidate(self, code: str, tests: str | None, *, had_code_block: bool = True,
                         suite: str = "hidden") -> VerificationReport:
        """Write ``solution.py`` (+ ``test_solution.py``) to a temp dir and verify it.

        ``tests`` of ``None`` or blank means no suite: only syntax, imports and
        the import-smoke runtime check apply (12.8).
        """
        code = code or ""
        if not had_code_block:
            finding = self._no_code_finding(code)
            if finding is not None:
                report = VerificationReport(suite=suite, techniques={
                    "syntax": TechniqueStatus(STATUS_FAIL, details="no code in the response"),
                    "imports": TechniqueStatus(STATUS_SKIPPED_UPSTREAM),
                    "tests": TechniqueStatus(STATUS_SKIPPED_UPSTREAM),
                    "runtime": TechniqueStatus(STATUS_SKIPPED_UPSTREAM),
                }, correctness=[finding])
                if self.advisory:
                    for t in ("types", "quality", "security"):
                        report.techniques[t] = TechniqueStatus(STATUS_SKIPPED_UPSTREAM)
                self.mapper.map_report(report)
                return report
        work = Path(tempfile.mkdtemp(prefix="tivr_cand_"))
        try:
            (work / SOLUTION_FILE).write_text(code, encoding="utf-8")
            if tests is not None and tests.strip():
                (work / TEST_FILE).write_text(tests, encoding="utf-8")
            return self.verify_project(work, {"solution"}, suite=suite)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def verify_project(self, project_dir: str | os.PathLike[str],
                       candidate_modules: set[str] | None = None, *,
                       suite: str = "project") -> VerificationReport:
        """Verify every ``.py`` file under ``project_dir``.

        ``candidate_modules`` are dotted names of the LLM-written modules;
        default: every non-test module in the project.
        """
        project = Path(project_dir).resolve()
        files = _discover(project)
        if candidate_modules is None:
            candidate_modules = {f.module for f in files
                                 if f.module and not _is_test_file(Path(f.rel).name)
                                 and Path(f.rel).name != "conftest.py"}
        modules = {m for m in candidate_modules if m}
        candidates = [f for f in files if f.module and _in_modules(f.module, modules)]
        sources = {f.rel: _decode(f.data) for f in candidates}
        ctx = EnrichContext(candidate_modules=modules, candidate_sources=sources)
        report = VerificationReport(suite=suite)
        techniques = report.techniques

        # ---- stage 2: syntax ----
        syntax = self._syntax_findings(files)
        techniques["syntax"] = TechniqueStatus(
            STATUS_FAIL if syntax else STATUS_PASS,
            details=f"compiled {len(files)} file(s)")
        if syntax:
            report.correctness = syntax
            for t in ("imports", "tests", "runtime"):
                techniques[t] = TechniqueStatus(STATUS_SKIPPED_UPSTREAM)
            if self.advisory:
                for t in ("types", "quality", "security"):
                    techniques[t] = TechniqueStatus(STATUS_SKIPPED_UPSTREAM)
            self.mapper.map_report(report)
            return report

        # ---- stage 3: static imports ----
        imports = self._import_findings(project, files, candidates, sources)
        techniques["imports"] = TechniqueStatus(
            STATUS_FAIL if imports else STATUS_PASS,
            details=f"checked module-level imports of {len(candidates)} candidate file(s)")
        if imports:
            report.correctness = imports
            techniques["tests"] = TechniqueStatus(STATUS_SKIPPED_UPSTREAM)
            techniques["runtime"] = TechniqueStatus(STATUS_SKIPPED_UPSTREAM)
        else:
            # ---- stage 4: tests + runtime ----
            has_tests = any(_is_test_file(Path(f.rel).name) for f in files)
            findings, passed, failed, statuses = self._run_tests(
                project, has_tests, sorted(modules), ctx)
            report.correctness = findings
            report.tests_passed, report.tests_failed = passed, failed
            techniques.update(statuses)

        # ---- stage 5: advisory ----
        if self.advisory:
            advisory, statuses = self._advisory(project, candidates, sources)
            report.advisory = advisory
            techniques.update(statuses)

        self.mapper.map_report(report)
        return report

    # ---- stage 1 -----------------------------------------------------
    def _no_code_finding(self, code: str) -> Finding | None:
        """``no_code_output`` finding, or ``None`` when the bare text is valid code."""
        text = code.strip()
        if not text:
            evidence = self.definition.dou_feedback["no_code"]
            line = None
        else:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    compile(text, SOLUTION_FILE, "exec", dont_inherit=True)
                return None
            except (SyntaxError, ValueError, RecursionError, MemoryError) as exc:
                evidence = "".join(traceback.format_exception_only(type(exc), exc)).strip()
                line = getattr(exc, "lineno", None)
        return Finding(
            technique="syntax", severity=BLOCKING, signal="no_code_output",
            message="the response contains no Python code block and no parseable code",
            evidence=evidence, location=Location(file=SOLUTION_FILE, line=line))

    # ---- stage 2 -----------------------------------------------------
    @staticmethod
    def _syntax_findings(files: list[_SourceFile]) -> list[Finding]:
        out: list[Finding] = []
        for f in files:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    compile(f.data, f.rel, "exec", dont_inherit=True)
            except (SyntaxError, ValueError, RecursionError, MemoryError) as exc:
                out.append(enrich.syntax_finding(exc, file=f.rel))
        return out

    # ---- stage 3 -----------------------------------------------------
    @staticmethod
    def _import_findings(project: Path, files: list[_SourceFile],
                         candidates: list[_SourceFile],
                         sources: dict[str, str]) -> list[Finding]:
        local = _local_tops(files)
        out: list[Finding] = []
        for f in candidates:
            source = sources[f.rel]
            try:
                tree = ast.parse(source, filename=f.rel)
            except (SyntaxError, ValueError, RecursionError):
                continue  # compile() accepted it; nothing reliable to check
            seen: set[str] = set()
            for node in module_level_imports(tree):
                if isinstance(node, ast.Import):
                    names = [a.name for a in node.names]
                elif node.level == 0 and node.module:
                    names = [node.module]
                else:
                    continue  # relative imports are resolved at runtime
                for name in names:
                    missing = _missing_import(name, project, local)
                    if missing is None or missing in seen:
                        continue
                    seen.add(missing)
                    out.append(enrich.import_finding(
                        missing, file=f.rel, line=node.lineno,
                        statement=ast.get_source_segment(source, node)))
                    if len(out) >= MAX_IMPORT_FINDINGS:
                        return out
        return out

    # ---- stage 4 -----------------------------------------------------
    def _run_tests(self, project: Path, has_tests: bool, modules: list[str],
                   ctx: EnrichContext):
        scratch = Path(tempfile.mkdtemp(prefix="tivr_pytest_"))
        try:
            ini = scratch / "pytest.ini"
            ini.write_text("[pytest]\n", encoding="utf-8")
            report_path = scratch / "report.json"
            if has_tests:
                targets = [str(project)]
            elif modules:
                smoke = scratch / _SMOKE_FILE
                smoke.write_text(_smoke_source(modules), encoding="utf-8")
                targets = [str(smoke)]
            else:
                return [], 0, 0, {
                    "tests": TechniqueStatus(STATUS_NO_TESTS, details="no test files"),
                    "runtime": TechniqueStatus(STATUS_NO_TESTS, details="no candidate modules"),
                }
            cmd = [self.python, "-m", "pytest", "-q", "-p", "no:cacheprovider",
                   "-p", "tivr.pytest_plugin", "--tb=short", "-c", str(ini),
                   "--rootdir", str(project), "--confcutdir", str(project), *targets]
            env = dict(os.environ)
            for key in ("PYTEST_ADDOPTS", "PYTEST_PLUGINS", "PYTEST_CURRENT_TEST"):
                env.pop(key, None)
            env["PYTHONPATH"] = os.pathsep.join([str(project), str(REPO_ROOT)])
            env["TIVR_PYTEST_REPORT"] = str(report_path)
            env["PYTHONDONTWRITEBYTECODE"] = "1"
            env["PYTHONIOENCODING"] = "utf-8"
            if self.plugin_autoload:
                env.pop("PYTEST_DISABLE_PLUGIN_AUTOLOAD", None)
            else:
                env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"
            try:
                result = _run(cmd, cwd=project, env=env, timeout_s=self.test_timeout_s)
            except OSError as exc:
                details = f"could not start the test interpreter {self.python!r}: {exc}"
                return [], 0, 0, {"tests": TechniqueStatus(STATUS_ERROR, details=details),
                                  "runtime": TechniqueStatus(STATUS_ERROR, details=details)}
            if result.timed_out:
                details = f"test subprocess exceeded {self.test_timeout_s} s and was killed"
                return [enrich.timeout_finding(self.test_timeout_s)], 0, 0, {
                    "tests": TechniqueStatus(STATUS_FAIL, details=details),
                    "runtime": TechniqueStatus(STATUS_FAIL, details=details)}
            data = _read_json(report_path)
            findings = enrich.findings_from_report(data, ctx, fallback_text=result.output)
            passed, failed = enrich.test_counts(data)
            ran = passed + failed - len((data or {}).get("collection_errors") or [])
            if not has_tests:
                passed = failed = 0  # smoke tests are not suite tests
            details = f"exit status {result.returncode}; {passed} passed, {failed} failed"
            test_findings = [f for f in findings if f.technique == "tests"]
            runtime_findings = [f for f in findings if f.technique == "runtime"]
            if not has_tests:
                tests_status = TechniqueStatus(
                    STATUS_FAIL if test_findings else STATUS_NO_TESTS,
                    details="no test files; ran import-smoke test")
            elif test_findings:
                tests_status = TechniqueStatus(STATUS_FAIL, details=details)
            elif passed == 0 and failed == 0:
                tests_status = TechniqueStatus(STATUS_NO_TESTS, details=details)
            else:
                tests_status = TechniqueStatus(STATUS_PASS, details=details)
            if runtime_findings:
                runtime_status = TechniqueStatus(STATUS_FAIL, details=details)
            elif test_findings and ran <= 0:
                runtime_status = TechniqueStatus(STATUS_SKIPPED_UPSTREAM,
                                                 details="no test executed")
            else:
                runtime_status = TechniqueStatus(STATUS_PASS, details=details)
            return findings, passed, failed, {"tests": tests_status, "runtime": runtime_status}
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    # ---- stage 5 -----------------------------------------------------
    def _advisory(self, project: Path, candidates: list[_SourceFile],
                  sources: dict[str, str]):
        findings: list[Finding] = []
        statuses: dict[str, TechniqueStatus] = {}
        for technique, fn in (("types", self._mypy), ("quality", self._radon),
                              ("security", self._semgrep)):
            if not candidates:
                statuses[technique] = TechniqueStatus(STATUS_PASS, details="no candidate files")
                continue
            try:
                found = fn(project, candidates, sources)
            except _DidNotRun as exc:
                findings.append(_did_not_run(technique, str(exc)))
                statuses[technique] = TechniqueStatus(STATUS_ERROR, details=str(exc))
                continue
            except Exception as exc:  # a crashing tool never affects correctness
                reason = f"{type(exc).__name__}: {exc}"
                findings.append(_did_not_run(technique, reason))
                statuses[technique] = TechniqueStatus(STATUS_ERROR, details=reason)
                continue
            findings.extend(found)
            statuses[technique] = TechniqueStatus(STATUS_FAIL if found else STATUS_PASS)
        return findings, statuses

    def _tool(self, cmd: list[str], project: Path) -> _ProcResult:
        try:
            result = _run(cmd, cwd=project, env=None, timeout_s=self.tool_timeout_s)
        except OSError as exc:
            raise _DidNotRun(f"{cmd[0]} could not be started: {exc}") from exc
        if result.timed_out:
            raise _DidNotRun(f"timed out after {self.tool_timeout_s} s")
        return result

    def _mypy(self, project: Path, candidates: list[_SourceFile], sources) -> list[Finding]:
        cache = Path(tempfile.mkdtemp(prefix="tivr_mypy_"))
        try:
            result = self._tool([self.python, "-m", "mypy", "--ignore-missing-imports",
                                 "--no-error-summary", "--show-error-codes",
                                 "--cache-dir", str(cache),
                                 *[f.rel for f in candidates]], project)
        finally:
            shutil.rmtree(cache, ignore_errors=True)
        out: list[Finding] = []
        for line in result.output.splitlines():
            m = _MYPY_LINE_RE.match(line.strip())
            if not m:
                continue
            out.append(Finding(technique="types", severity=ADVISORY,
                               signal=f"mypy:{m.group('code') or 'error'}",
                               message=m.group("msg"),
                               location=Location(file=m.group("file").replace("\\", "/"),
                                                 line=int(m.group("line")))))
        if result.returncode not in (0, 1) or (result.returncode == 1 and not out):
            raise _DidNotRun(f"mypy exited with status {result.returncode}: "
                             f"{_tail(result.output, 3)}")
        return out[:MAX_ADVISORY_PER_TOOL]

    @staticmethod
    def _radon(project: Path, candidates: list[_SourceFile], sources) -> list[Finding]:
        try:
            from radon.complexity import cc_rank, cc_visit
            from radon.metrics import mi_rank, mi_visit
        except ImportError as exc:
            raise _DidNotRun(f"radon is not installed ({exc})") from exc
        out: list[Finding] = []
        for f in candidates:
            code = sources[f.rel]
            for block in cc_visit(code):
                rank = cc_rank(block.complexity)
                if rank not in ("A", "B"):
                    out.append(Finding(
                        technique="quality", severity=ADVISORY, signal=f"radon:cc_rank_{rank}",
                        message=f"{block.name}: cyclomatic complexity {block.complexity} "
                                f"(rank {rank})",
                        location=Location(file=f.rel, line=block.lineno)))
            mi = mi_visit(code, multi=True)
            if mi_rank(mi) != "A":
                out.append(Finding(
                    technique="quality", severity=ADVISORY, signal=f"radon:mi_rank_{mi_rank(mi)}",
                    message=f"maintainability index {mi:.0f} (rank {mi_rank(mi)})",
                    location=Location(file=f.rel)))
        return out[:MAX_ADVISORY_PER_TOOL]

    def _semgrep(self, project: Path, candidates: list[_SourceFile], sources) -> list[Finding]:
        exe = shutil.which(self.semgrep)
        if exe is None:
            raise _DidNotRun(f"{self.semgrep} is not installed")
        result = self._tool([exe, "--config", self.semgrep_config, "--json", "--quiet",
                             "--metrics=off", *[f.rel for f in candidates]], project)
        start = result.output.find("{")
        try:
            data = json.loads(result.output[start:]) if start >= 0 else None
        except ValueError:
            data = None
        if not isinstance(data, dict):
            raise _DidNotRun(f"semgrep produced no JSON report: {_tail(result.output, 3)}")
        out: list[Finding] = []
        for r in data.get("results") or []:
            extra = r.get("extra") or {}
            path = str(r.get("path") or "").replace("\\", "/")
            lines = [ln.strip() for ln in str(extra.get("message") or "").splitlines()]
            message = next((ln for ln in lines if ln), "")[:200]
            out.append(Finding(
                technique="security", severity=ADVISORY,
                signal=f"semgrep:{r.get('check_id', 'rule')}",
                message=message or str(r.get("check_id", "semgrep finding")),
                location=Location(file=path or candidates[0].rel,
                                  line=(r.get("start") or {}).get("line"))))
        return out[:MAX_ADVISORY_PER_TOOL]


class _DidNotRun(Exception):
    """An advisory tool could not produce a result."""


def _did_not_run(technique: str, reason: str) -> Finding:
    return Finding(technique=technique, severity=ADVISORY, signal=f"{technique}:did_not_run",
                   message=f"{technique} technique did not run: {reason}")


def _smoke_source(modules: list[str]) -> str:
    lines = ['"""Generated by tivr.verifier: import every candidate module."""',
             "import importlib", ""]
    for i, module in enumerate(modules):
        lines += ["", f"def test_import_{i}():",
                  f"    importlib.import_module({module!r})", ""]
    return "\n".join(lines)


def _read_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None
