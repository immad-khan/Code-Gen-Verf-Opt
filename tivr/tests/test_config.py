"""Unit tests for tivr.config (Requirements 2.8, 11.13, 12.1, 12.2, 13.5, 1.6)."""
from __future__ import annotations

from pathlib import Path

import pytest

from tivr.config import ALL_MODES, CORE_MODES, Decoding, RunConfig, parse_config

DS = "data.jsonl"


def _fail(capsys: pytest.CaptureFixture[str], argv: list[str]) -> str:
    """Run parse_config expecting exit 2; return stderr."""
    with pytest.raises(SystemExit) as exc:
        parse_config(argv, env={})
    assert exc.value.code == 2
    return capsys.readouterr().err


def test_defaults() -> None:
    cfg = parse_config([DS], env={})
    assert isinstance(cfg, RunConfig)
    assert cfg.dataset == Path(DS)
    assert cfg.mode == "dou"
    assert cfg.enable_intervenor is False
    assert cfg.feedback_regime == "dou"
    assert cfg.k == 2
    assert cfg.decoding == Decoding(temperature=0.1, top_p=None, max_tokens=None)
    assert cfg.decoding.as_dict() == {"temperature": 0.1, "top_p": None, "max_tokens": None}
    assert cfg.generation_prompt_style == "dou"
    assert cfg.sample_size == 120
    assert cfg.seed == 0
    assert cfg.generation_cache is None
    assert cfg.mock is False and cfg.llm_mode == "live"
    assert cfg.llm_retries == 2
    assert cfg.model == "deepseek-chat"
    assert cfg.run_id is None
    assert cfg.runs_root == Path("runs")


def test_model_from_env_and_flag() -> None:
    assert parse_config([DS], env={"TIVR_MODEL": "m-env"}).model == "m-env"
    assert parse_config([DS], env={"TIVR_MODEL": "  "}).model == "deepseek-chat"
    assert parse_config([DS, "--model", "m-flag"], env={"TIVR_MODEL": "m-env"}).model == "m-flag"


def test_all_flags_parsed() -> None:
    cfg = parse_config([
        DS, "--mode", "full", "--feedback-regime", "strict", "--k", "5",
        "--temperature", "0", "--top-p", "1", "--max-tokens", "512",
        "--generation-prompt-style", "tivr", "--sample-size", "7", "--seed", "42",
        "--generation-cache", "c.json", "--mock", "--llm-retries", "10",
        "--run-id", "my.run_1-a", "--runs-root", "out",
    ], env={})
    assert (cfg.mode, cfg.feedback_regime, cfg.k) == ("full", "strict", 5)
    assert cfg.decoding == Decoding(temperature=0.0, top_p=1.0, max_tokens=512)
    assert cfg.generation_prompt_style == "tivr"
    assert (cfg.sample_size, cfg.seed) == (7, 42)
    assert cfg.generation_cache == Path("c.json")
    assert cfg.mock is True and cfg.llm_mode == "mock"
    assert cfg.llm_retries == 10
    assert cfg.run_id == "my.run_1-a"
    assert cfg.runs_root == Path("out")


@pytest.mark.parametrize("mode", CORE_MODES)
def test_core_modes_accepted(mode: str) -> None:
    assert parse_config([DS, "--mode", mode], env={}).mode == mode


@pytest.mark.parametrize("mode", ["intervenor", "dou_intervenor"])
def test_optional_modes_gated(capsys: pytest.CaptureFixture[str], mode: str) -> None:
    err = _fail(capsys, [DS, "--mode", mode])
    assert "--mode" in err and "--enable-intervenor" in err and mode in err
    assert parse_config([DS, "--mode", mode, "--enable-intervenor"], env={}).mode == mode


@pytest.mark.parametrize("flag,value", [
    ("--mode", "bogus"),
    ("--feedback-regime", "hidden"),
    ("--k", "0"),
    ("--k", "1.5"),
    ("--temperature", "-0.1"),
    ("--temperature", "2.01"),
    ("--temperature", "nan"),
    ("--temperature", "hot"),
    ("--top-p", "0"),
    ("--top-p", "1.5"),
    ("--max-tokens", "0"),
    ("--max-tokens", "10.0"),
    ("--generation-prompt-style", "paper"),
    ("--sample-size", "0"),
    ("--sample-size", "x"),
    ("--seed", "-1"),
    ("--llm-retries", "-1"),
    ("--llm-retries", "11"),
    ("--model", " "),
    ("--run-id", "-starts-with-dash"),
    ("--run-id", "has/slash"),
    ("--run-id", "a" * 101),
])
def test_invalid_value_exits_2_naming_flag(capsys: pytest.CaptureFixture[str], flag: str, value: str) -> None:
    err = _fail(capsys, [DS, f"{flag}={value}"])
    assert err.startswith(f"error: {flag}: ")


def test_regime_error_names_accepted_values(capsys: pytest.CaptureFixture[str]) -> None:
    err = _fail(capsys, [DS, "--feedback-regime", "x"])
    assert "dou" in err and "strict" in err


def test_mode_error_lists_modes(capsys: pytest.CaptureFixture[str]) -> None:
    err = _fail(capsys, [DS, "--mode", "x"])
    assert all(m in err for m in ALL_MODES)


def test_removed_limit_flag_and_missing_dataset_exit_2(capsys: pytest.CaptureFixture[str]) -> None:
    assert "--limit" in _fail(capsys, [DS, "--limit", "3"])
    assert "DATASET" in _fail(capsys, [])


def test_boundary_values_accepted() -> None:
    cfg = parse_config([DS, "--temperature", "2", "--top-p", "0.0001", "--max-tokens", "1",
                        "--k", "1", "--sample-size", "1", "--llm-retries", "0",
                        "--run-id", "a" * 100], env={})
    assert cfg.decoding == Decoding(temperature=2.0, top_p=0.0001, max_tokens=1)
    assert (cfg.k, cfg.sample_size, cfg.llm_retries) == (1, 1, 0)
