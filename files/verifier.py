"""
verifier.py — orchestrates the 7 verification techniques into one
fail-fast pipeline that emits a canonical VerificationReport.

INTEGRATION: you already implemented Techniques 1-7. Each _stage_* method
below is a compact reference implementation with the SAME contract
(returns list[Finding] and optionally updates self.metrics). Either keep
these, or replace the body of any stage with a call to your existing
function — the orchestration, ordering, and report stay identical.

STAGE ORDER + FAIL-FAST POLICY (rationale in DESIGN.md §4):
  1. syntax      -> if FAIL: stop. Every other tool would just re-report it.
  2. imports     -> if FAIL: skip tests (they'd fail with ImportError noise),
                    still run types/quality/security (static, still useful).
  3. tests+runtime (pytest, one subprocess; runtime scan parses its output)
  4. types (mypy)         [major]
  5. quality (radon)      [advisory + metrics]
  6. security (semgrep)   [major for ERROR severity, else advisory]

SAFETY: generated code is NEVER exec'd in-process. Tests run in a
subprocess inside a temp dir with a hard timeout. NOTE on your
Technique 2: importlib.import_module() EXECUTES the module's top-level
code — for hallucination detection use importlib.util.find_spec(),
which only resolves the module without running it (done below).
For untrusted/production use, wrap _stage_tests in a container
(docker run --network=none --memory=512m) — see DESIGN.md §12.
"""
from __future__ import annotations
import ast
import importlib.util
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from schemas import (Finding, VerificationReport, compute_verdict,
                     BLOCKING, MAJOR, ADVISORY)
from taxonomy import map_report

PYTEST_TIMEOUT = 60          # hard cap for the whole test subprocess (s)
TOOL_TIMEOUT = 45            # mypy / semgrep cap (s)
MAX_FINDINGS_PER_STAGE = 3   # feedback quality > feedback quantity (Olausson)
EVIDENCE_MAX_LINES = 20

STDLIB = set(getattr(sys, "stdlib_module_names", ()))


def _trim(text: str, max_lines: int = EVIDENCE_MAX_LINES) -> str:
    lines = text.strip().splitlines()
    if len(lines) <= max_lines:
        return "\n".join(lines)
    return "\n".join(lines[:3] + ["... [trimmed] ..."] + lines[-(max_lines - 4):])


class Verifier:
    def __init__(self, workdir: str | None = None):
        self.workdir = workdir
        self.metrics: dict = {}
        self.timing: dict = {}

    # ------------------------------------------------------------------
    def run(self, code: str, visible_tests: str | None,
            iteration: int = 0) -> VerificationReport:
        """Verify one candidate program. visible_tests is pytest source
        (or None for static-only verification)."""
        self.metrics, self.timing = {}, {}
        findings: list[Finding] = []
        tmp = Path(self.workdir or tempfile.mkdtemp(prefix="tivr_"))
        tmp.mkdir(parents=True, exist_ok=True)
        try:
            (tmp / "solution.py").write_text(code, encoding="utf-8")

            syn = self._timed("syntax", self._stage_syntax, code)
            findings += syn
            if any(f.severity == BLOCKING for f in syn):
                return self._finish(findings, iteration)          # fail-fast

            imp = self._timed("imports", self._stage_imports, code)
            findings += imp
            imports_ok = not any(f.severity == BLOCKING for f in imp)

            if imports_ok and visible_tests is not None:
                (tmp / "test_solution.py").write_text(visible_tests,
                                                      encoding="utf-8")
                findings += self._timed("tests", self._stage_tests_and_runtime, tmp)

            findings += self._timed("types", self._stage_types, tmp)
            findings += self._timed("quality", self._stage_quality, code)
            findings += self._timed("security", self._stage_security, tmp)
            return self._finish(findings, iteration)
        finally:
            if self.workdir is None:
                shutil.rmtree(tmp, ignore_errors=True)

    def _finish(self, findings, iteration) -> VerificationReport:
        report = VerificationReport(
            verdict=compute_verdict(findings), iteration=iteration,
            findings=findings, metrics=self.metrics, timing=self.timing)
        map_report(report)                       # fills diagnoses + priority
        return report

    def _timed(self, name, fn, *args):
        t0 = time.time()
        try:
            return fn(*args)
        finally:
            self.timing[name] = round(time.time() - t0, 3)

    # ---- Technique 1: syntax / AST -----------------------------------
    def _stage_syntax(self, code: str) -> list[Finding]:
        try:
            ast.parse(code)
            return []
        except SyntaxError as e:
            line = ""
            if e.text:
                line = e.text.strip()
            truncated = "unexpected EOF" in str(e.msg or "").lower() or \
                        "was never closed" in str(e.msg or "").lower()
            return [Finding(
                technique="syntax", severity=BLOCKING,
                signal="SyntaxError:truncated" if truncated else type(e).__name__,
                message=f"{type(e).__name__}: {e.msg} (line {e.lineno})",
                evidence=line, location=f"solution.py:{e.lineno}")]

    # ---- Technique 2: import / API hallucination ---------------------
    def _stage_imports(self, code: str) -> list[Finding]:
        out: list[Finding] = []
        tree = ast.parse(code)
        seen: set[str] = set()
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                names = [node.module]
            for name in names:
                top = name.split(".")[0]
                if top in seen:
                    continue
                seen.add(top)
                if top in STDLIB:
                    continue
                try:
                    spec = importlib.util.find_spec(top)   # resolves WITHOUT executing
                except (ImportError, ValueError, ModuleNotFoundError):
                    spec = None
                if spec is None:
                    out.append(Finding(
                        technique="imports", severity=BLOCKING,
                        signal="ModuleNotFoundError",
                        message=f"Import '{name}' cannot be resolved — likely a "
                                f"hallucinated or unavailable module.",
                        evidence=f"import {name}",
                        location=f"solution.py:{node.lineno}"))
        return out[:MAX_FINDINGS_PER_STAGE]

    # ---- Techniques 3 + 4: pytest + runtime-error scan ----------------
    def _stage_tests_and_runtime(self, tmp: Path) -> list[Finding]:
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "pytest", "-q", "-ra", "--tb=short",
                 "-p", "no:cacheprovider", "test_solution.py"],
                cwd=tmp, capture_output=True, text=True, timeout=PYTEST_TIMEOUT)
            output = proc.stdout + "\n" + proc.stderr
        except subprocess.TimeoutExpired:
            self.metrics.update(tests_passed=0, tests_failed=None)
            return [Finding(technique="tests", severity=BLOCKING,
                            signal="Timeout",
                            message=f"Test execution exceeded {PYTEST_TIMEOUT}s — "
                                    "likely infinite loop or pathological complexity.",
                            evidence="")]
        m_pass = re.search(r"(\d+) passed", output)
        m_fail = re.search(r"(\d+) failed", output)
        m_err = re.search(r"(\d+) error", output)
        passed = int(m_pass.group(1)) if m_pass else 0
        failed = (int(m_fail.group(1)) if m_fail else 0) + \
                 (int(m_err.group(1)) if m_err else 0)
        self.metrics.update(tests_passed=passed, tests_failed=failed)
        if proc.returncode == 0:
            return []
        out: list[Finding] = []
        # one finding per failing test (from the short-summary lines),
        # evidence from that test's own traceback block; runtime scan per block
        exc_re = re.compile(r"\b([A-Z][A-Za-z]*(?:Error|Exception))\b")
        failed_names = re.findall(r"^FAILED\s+\S+::(\w+)", output, re.M) or \
                       re.findall(r"^ERROR\s+\S+::(\w+)", output, re.M)
        for name in failed_names[:MAX_FINDINGS_PER_STAGE]:
            m_block = re.search(rf"_{{2,}}[^\n]*\b{name}\b[^\n]*_{{2,}}(.*?)(?=\n_{{2,}}|\n=+|\Z)",
                                output, re.S)
            block = m_block.group(1) if m_block else output
            excs = [e for e in exc_re.findall(block) if e != "AssertionError"]
            if excs:
                sig = f"runtime:{excs[0]}:{name}"             # crashed
            else:
                sig = f"test_failure:{name}"                  # wrong output
            out.append(Finding(
                technique="runtime" if excs else "tests",
                severity=BLOCKING, signal=sig,
                message=f"{name} failed"
                        + (f" with {excs[0]}" if excs else " (output mismatch)"),
                evidence=_trim(block)))
        if not out:   # pytest failed but parsing found nothing → collection error
            out.append(Finding(technique="runtime", severity=BLOCKING,
                               signal="pytest_collection_error",
                               message="Tests could not be executed.",
                               evidence=_trim(output)))
        return out

    # ---- Technique 5: mypy --------------------------------------------
    def _stage_types(self, tmp: Path) -> list[Finding]:
        try:
            proc = subprocess.run(
                [sys.executable, "-m", "mypy", "--ignore-missing-imports",
                 "--no-error-summary", "solution.py"],
                cwd=tmp, capture_output=True, text=True, timeout=TOOL_TIMEOUT)
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return []
        out = []
        for line in proc.stdout.splitlines():
            m = re.match(r"solution\.py:(\d+):.*?error:\s*(.+?)(?:\s+\[(.+)\])?$", line)
            if m:
                out.append(Finding(
                    technique="types", severity=MAJOR,
                    signal=f"mypy:{m.group(3) or 'error'}",
                    message=m.group(2), location=f"solution.py:{m.group(1)}"))
            if len(out) >= 5:
                break
        return out

    # ---- Technique 6: radon complexity & maintainability --------------
    def _stage_quality(self, code: str) -> list[Finding]:
        try:
            from radon.complexity import cc_visit, cc_rank
            from radon.metrics import mi_visit, mi_rank
            from radon.raw import analyze
        except ImportError:
            return []
        out: list[Finding] = []
        blocks = cc_visit(code)
        worst = max((b.complexity for b in blocks), default=1)
        mi = mi_visit(code, multi=True)
        raw = analyze(code)
        comment_ratio = round(raw.comments / max(raw.loc, 1), 3)
        api_count = len({n.attr for n in ast.walk(ast.parse(code))
                         if isinstance(n, ast.Attribute)})
        self.metrics.update(cc_worst=worst, cc_rank=cc_rank(worst),
                            mi=round(mi, 1), mi_rank=mi_rank(mi),
                            loc=raw.loc, comment_ratio=comment_ratio,
                            api_count=api_count)
        if cc_rank(worst) not in ("A", "B"):
            out.append(Finding(technique="quality", severity=ADVISORY,
                               signal=f"radon:cc_rank_{cc_rank(worst)}",
                               message=f"Cyclomatic complexity {worst} "
                                       f"(rank {cc_rank(worst)})."))
        if mi_rank(mi) != "A":
            out.append(Finding(technique="quality", severity=ADVISORY,
                               signal=f"radon:mi_rank_{mi_rank(mi)}",
                               message=f"Maintainability Index {mi:.0f} "
                                       f"(rank {mi_rank(mi)})."))
        return out

    # ---- Technique 7: semgrep ------------------------------------------
    def _stage_security(self, tmp: Path) -> list[Finding]:
        if shutil.which("semgrep") is None:
            return []
        try:
            proc = subprocess.run(
                ["semgrep", "--config", "p/python", "--json", "--quiet",
                 "solution.py"],
                cwd=tmp, capture_output=True, text=True, timeout=TOOL_TIMEOUT)
            import json as _json
            results = _json.loads(proc.stdout or "{}").get("results", [])
        except Exception:
            return []
        out = []
        for r in results[:MAX_FINDINGS_PER_STAGE]:
            sev = (r.get("extra", {}).get("severity") or "").upper()
            out.append(Finding(
                technique="security",
                severity=MAJOR if sev == "ERROR" else ADVISORY,
                signal=f"semgrep:{r.get('check_id', 'rule')}",
                message=r.get("extra", {}).get("message", "")[:200],
                location=f"solution.py:{r.get('start', {}).get('line', '?')}"))
        return out
