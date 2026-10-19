"""JSON CLI over ``ProjectVerifier`` for the C# backend (design.md §5 "verify_cli contract").

Usage::

    python -m tivr.verify_cli --project DIR --out FILE [--test-timeout 60]
                              [--candidate-module NAME ...]

Runs the four correctness techniques (syntax, imports, tests, runtime) on DIR and
writes FILE (UTF-8, strict JSON, written atomically)::

    {"techniques": {"syntax"|"imports"|"tests"|"runtime": {"status", "complete", "details"}},
     "correctness": [Finding...], "tests_passed": n, "tests_failed": n}

``correctness`` holds the *enriched, unmapped* findings (tivr/schemas.py ``Finding``
fields only); the backend maps them with its own Taxonomy_Mapper (Req. 19.7, 20.5).
Advisory techniques are not run here; the backend runs them itself.

Candidate modules default to every non-test ``.py`` module of the project.

Exit codes: 0 the report was written (whatever the findings); 2 usage error;
1 harness failure (message on stderr, no report written).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import tempfile
import time
import traceback
from dataclasses import asdict, fields
from pathlib import Path
from typing import Any, Sequence

from tivr.schemas import (CORRECTNESS_TECHNIQUES, STATUS_ERROR, Finding,
                          VerificationReport, _json_safe)
from tivr.verifier import DEFAULT_TEST_TIMEOUT_S, ProjectVerifier

__all__ = ["EXIT_OK", "EXIT_HARNESS", "EXIT_USAGE", "build_report", "main"]

EXIT_OK = 0
EXIT_HARNESS = 1
EXIT_USAGE = 2

_FINDING_KEYS = tuple(f.name for f in fields(Finding))
_REPLACE_ATTEMPTS = 20  # Windows: the reader may briefly hold the target open


def _finding_dict(finding: Finding) -> dict[str, Any]:
    """Only the ``Finding`` fields (no category/rule_id/confidence): the backend maps."""
    d = asdict(finding)
    return {k: d[k] for k in _FINDING_KEYS}


def build_report(report: VerificationReport) -> dict[str, Any]:
    """The verify_cli JSON object for ``report`` (strict JSON, snake_case)."""
    techniques: dict[str, Any] = {}
    for technique in CORRECTNESS_TECHNIQUES:
        status = report.techniques.get(technique)
        if status is None:  # never expected; an absent technique is incomplete
            techniques[technique] = {"status": STATUS_ERROR, "complete": False,
                                     "details": "technique returned no result"}
        else:
            techniques[technique] = {"status": status.status,
                                     "complete": bool(status.complete),
                                     "details": status.details or ""}
    return _json_safe({
        "techniques": techniques,
        "correctness": [_finding_dict(f) for f in report.correctness if f.is_blocking],
        "tests_passed": int(report.tests_passed),
        "tests_failed": int(report.tests_failed),
    })


def _write_atomic(path: Path, obj: Any) -> None:
    text = json.dumps(obj, ensure_ascii=False, allow_nan=False, indent=1) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        for attempt in range(_REPLACE_ATTEMPTS):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if attempt == _REPLACE_ATTEMPTS - 1:
                    raise
                time.sleep(0.05)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m tivr.verify_cli",
        description="Run the TIVR correctness techniques on a project and write a JSON report.")
    p.add_argument("--project", required=True, metavar="DIR", help="project directory")
    p.add_argument("--out", required=True, metavar="FILE", help="report file to write")
    p.add_argument("--test-timeout", type=float, default=float(DEFAULT_TEST_TIMEOUT_S),
                   metavar="N", help=f"pytest timeout in seconds (default {DEFAULT_TEST_TIMEOUT_S})")
    p.add_argument("--candidate-module", action="append", default=None, metavar="M",
                   dest="candidate_modules",
                   help="dotted name of an LLM-written module (repeatable; "
                        "default: every non-test module)")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:  # argparse: 2 on usage errors, 0 for --help
        return int(exc.code) if isinstance(exc.code, int) else EXIT_USAGE

    timeout = args.test_timeout
    if not math.isfinite(timeout) or timeout <= 0:
        parser.print_usage(sys.stderr)
        print("verify_cli: error: --test-timeout must be a positive number", file=sys.stderr)
        return EXIT_USAGE
    project = Path(args.project)
    if not project.is_dir():
        parser.print_usage(sys.stderr)
        print(f"verify_cli: error: --project {args.project!r} is not a directory",
              file=sys.stderr)
        return EXIT_USAGE
    candidates = None
    if args.candidate_modules is not None:
        candidates = {m.strip() for m in args.candidate_modules if m.strip()}
        if not candidates:
            parser.print_usage(sys.stderr)
            print("verify_cli: error: --candidate-module must not be empty", file=sys.stderr)
            return EXIT_USAGE

    try:
        verifier = ProjectVerifier(test_timeout_s=timeout, advisory=False)
        report = verifier.verify_project(project, candidates)
        payload = build_report(report)
        _write_atomic(Path(args.out), payload)
    except Exception as exc:  # harness failure: the backend treats it as incomplete
        print(f"verify_cli: harness failure: {type(exc).__name__}: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return EXIT_HARNESS
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
