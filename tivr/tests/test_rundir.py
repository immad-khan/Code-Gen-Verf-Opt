"""Unit tests for tivr.rundir (Requirements 1.9, 16.1-16.7)."""
from __future__ import annotations

import hashlib
import io
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from tivr import rundir as rd
from tivr.config import Decoding, RunConfig

SECRET = 'sk-test-"secret\\key-1234567890'   # includes characters JSON must escape


def _config(**kw) -> RunConfig:
    base = dict(dataset=Path("data/tasks.jsonl"), mode="dou", feedback_regime="strict", k=3,
                decoding=Decoding(temperature=0.2, top_p=None, max_tokens=512),
                sample_size=10, seed=7, mock=True, model="gpt-4")
    base.update(kw)
    return RunConfig(**base)


def _start(run: rd.RunDir, **kw) -> rd.Manifest:
    return rd.Manifest.start(run, _config(), dataset_sha256="a" * 64, task_count=3,
                             api_host="api.example.com:443", taxonomy_version="1.0.0", **kw)


# ---------------------------------------------------------------------------
# Run IDs and exclusive creation (16.1, 16.2)
# ---------------------------------------------------------------------------

def test_generated_run_id_format_and_validity():
    now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    run_id = rd.generate_run_id("dou", "strict", now=now)
    assert re.fullmatch(r"20260101T120000Z-dou-strict-[0-9a-f]{6}", run_id)
    assert rd.is_valid_run_id(run_id)
    assert rd.generate_run_id("dou", "dou") != rd.generate_run_id("dou", "dou")


@pytest.mark.parametrize("bad", ["", "-x", ".x", "a/b", "a\\b", "..", "a b", "x" * 101])
def test_invalid_run_ids_rejected(tmp_path, bad):
    assert not rd.is_valid_run_id(bad)
    with pytest.raises(rd.RunDirError):
        rd.RunDir.create(tmp_path, bad)
    assert list(tmp_path.iterdir()) == []


def test_create_is_exclusive_and_collision_leaves_existing_untouched(tmp_path):
    first = rd.RunDir.create(tmp_path / "runs", "run-1")
    assert first.root == (tmp_path / "runs" / "run-1").resolve()
    marker = first.path("marker.txt")
    marker.write_text("original", encoding="utf-8")
    mtime = marker.stat().st_mtime_ns

    with pytest.raises(rd.RunDirError) as err:
        rd.RunDir.create(tmp_path / "runs", "run-1")
    assert err.value.exists is True
    assert "run-1" in str(err.value)
    assert sorted(p.name for p in first.root.iterdir()) == ["marker.txt"]
    assert marker.read_text(encoding="utf-8") == "original"
    assert marker.stat().st_mtime_ns == mtime


# ---------------------------------------------------------------------------
# Path confinement (16.3)
# ---------------------------------------------------------------------------

def test_paths_are_confined_to_run_root(tmp_path):
    run = rd.RunDir.create(tmp_path, "r1")
    other = rd.RunDir.create(tmp_path, "r2")
    assert run.path("manifest.json") == run.root / "manifest.json"
    for bad in ["../r2/manifest.json", "..", ".", "", str(other.root / "x.json"),
                "sub/../../r2/x.json"]:
        with pytest.raises(rd.PathEscapeError):
            run.path(bad)
    with pytest.raises(rd.PathEscapeError):
        run.write_json("../r2/summary.json", {})
    assert list(other.root.iterdir()) == []


# ---------------------------------------------------------------------------
# Manifest (16.4, 16.5, 16.6)
# ---------------------------------------------------------------------------

def test_manifest_start_fields(tmp_path):
    run = rd.RunDir.create(tmp_path, "r1")
    start = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    _start(run, start_time=start)
    m = run.read_json("manifest.json")
    assert m["schema"] == "tivr.manifest.v1"
    assert m["run_id"] == "r1"
    assert m["dataset_path"] == "data/tasks.jsonl"
    assert m["dataset_sha256"] == "a" * 64
    assert m["task_count"] == 3
    assert (m["repair_mode"], m["feedback_regime"], m["k"]) == ("dou", "strict", 3)
    assert (m["model"], m["api_host"]) == ("gpt-4", "api.example.com:443")
    assert m["decoding"] == {"temperature": 0.2, "top_p": None, "max_tokens": 512}
    assert m["generation_prompt_style"] == "dou"
    assert (m["sample_size"], m["seed"], m["llm_mode"]) == (10, 7, "mock")
    assert m["taxonomy_version"] == "1.0.0"
    assert m["start_time"] == "2026-01-01T12:00:00Z"
    assert (m["end_time"], m["completed"], m["termination"], m["error"]) == (None, False, None, None)
    for key in ("tivr_version", "python_version", "advisory_techniques",
                "generation_cache", "repair_sample"):
        assert key in m


def test_manifest_sample_and_finish(tmp_path):
    run = rd.RunDir.create(tmp_path, "r1")
    start = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    man = _start(run, start_time=start)
    man.set_generation_cache("data/caches/x.json", "b" * 64, reused=True)
    man.record_sample(requested=10, actual=2, seed=7, cache_dataset_sha256="a" * 64,
                      task_ids=["T/1", "T/2"])
    # An end time earlier than the start (clock skew) is clamped to the start.
    man.finish(end_time=start - timedelta(seconds=5))
    m = run.read_json("manifest.json")
    assert m["generation_cache"] == {"path": "data/caches/x.json", "sha256": "b" * 64, "reused": True}
    assert m["repair_sample"] == {"requested": 10, "actual": 2, "seed": 7,
                                  "cache_dataset_sha256": "a" * 64, "task_ids": ["T/1", "T/2"]}
    assert m["completed"] is True and m["termination"] is None
    assert m["end_time"] >= m["start_time"]
    assert rd.parse_iso_utc(m["end_time"]) >= rd.parse_iso_utc(m["start_time"])


def test_manifest_termination_keeps_jsonl(tmp_path):
    run = rd.RunDir.create(tmp_path, "r1")
    man = _start(run)
    run.append_trajectory({"task_id": "T/1", "iteration": 1})
    man.terminate("interrupted", "KeyboardInterrupt")
    m = run.read_json("manifest.json")
    assert (m["completed"], m["termination"], m["error"]) == (False, "interrupted", "KeyboardInterrupt")
    assert m["end_time"] is not None and m["end_time"] >= m["start_time"]
    assert run.path("trajectories.jsonl").read_text(encoding="utf-8").count("\n") == 1
    with pytest.raises(ValueError):
        man.terminate("bogus")


# ---------------------------------------------------------------------------
# Progress and JSONL
# ---------------------------------------------------------------------------

def test_progress_is_atomic_and_overwritten(tmp_path):
    run = rd.RunDir.create(tmp_path, "r1")
    run.write_progress("generation", 1, 164)
    run.write_progress("repair", 2, 10)
    p = run.read_json("progress.json")
    assert {k: p[k] for k in ("schema", "run_id", "phase", "completed", "total")} == {
        "schema": "tivr.progress.v1", "run_id": "r1", "phase": "repair", "completed": 2, "total": 10}
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", p["updated_at"])
    # No temp files left behind by the atomic replace.
    assert sorted(f.name for f in run.root.iterdir()) == ["progress.json"]
    with pytest.raises(ValueError):
        run.write_progress("bogus", 0, 0)


def test_jsonl_appenders_and_non_finite_floats(tmp_path):
    run = rd.RunDir.create(tmp_path, "r1")
    run.append_trajectory({"task_id": "T/1", "iteration": 1, "llm_mode": "mock", "x": float("nan")})
    run.append_trajectory({"task_id": "T/1", "iteration": 2, "run_id": "ignored"})
    run.append_program({"task_id": "T/1", "states": ["C", "PASS"], "stop_reason": "hidden_pass"})
    lines = [json.loads(l) for l in run.path("trajectories.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [e["iteration"] for e in lines] == [1, 2]
    assert all(e["schema"] == "tivr.trajectory.v1" and e["run_id"] == "r1" for e in lines)
    assert lines[0]["x"] is None
    progs = run.path("programs.jsonl").read_text(encoding="utf-8").splitlines()
    assert json.loads(progs[0])["states"] == ["C", "PASS"]


# ---------------------------------------------------------------------------
# Redaction (1.9, 16.7)
# ---------------------------------------------------------------------------

def test_redactor_removes_key_from_all_writers_and_console(tmp_path):
    red = rd.Redactor(SECRET, "", None)
    run = rd.RunDir.create(tmp_path, "r1", red)
    man = _start(run)
    man.terminate("error", f"boom: {SECRET}")
    run.append_trajectory({"task_id": "T/1", "prompt": f"key={SECRET}", SECRET: [SECRET]})
    run.append_program({"task_id": "T/1", "stop_reason": SECRET})
    run.write_summary({"nested": {"v": (SECRET, 1)}})
    run.write_generation_cache({"entries": [{"raw_response": SECRET + SECRET}]})

    for f in run.root.iterdir():
        raw = f.read_bytes()
        text = raw.decode("utf-8")
        assert SECRET not in text, f.name
        assert json.dumps(SECRET)[1:-1] not in text, f.name    # JSON-escaped form
        assert rd.REDACTED in text, f.name
    m = run.read_json("manifest.json")
    assert m["error"] == f"boom: {rd.REDACTED}"

    buf = io.StringIO()
    run.print("calling with", SECRET, file=buf)
    assert buf.getvalue() == f"calling with {rd.REDACTED}\n"


def test_redactor_without_secret_is_identity():
    red = rd.Redactor(None, "   ")
    assert not red.active
    assert red.text("abc") == "abc"
    assert red.value({"a": ["b", 1]}) == {"a": ["b", 1]}


# ---------------------------------------------------------------------------
# SHA-256 (16.4)
# ---------------------------------------------------------------------------

def test_sha256_hex_lowercase_64(tmp_path):
    data = b'{"task_id": "T/1"}\n' * 1000
    f = tmp_path / "d.jsonl"
    f.write_bytes(data)
    digest = rd.sha256_file(f)
    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    assert digest == hashlib.sha256(data).hexdigest() == rd.sha256_bytes(data)
