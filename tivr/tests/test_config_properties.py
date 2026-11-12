"""Property-based tests for run configuration validation.

Feature: paper-aligned-repair-tool, Property 19
Property 19: Configuration validation.
**Validates: Requirements 1.1, 2.8, 11.13, 12.1, 12.2, 13.5**

For any CLI value set, ``parse_config`` succeeds iff temperature is in [0, 2],
top-p is in (0, 1], max-tokens is an integer >= 1, style is dou/tivr, mode is
listed (optional modes only with --enable-intervenor), regime is dou/strict,
k, N >= 1, S >= 0, retries in [0, 10] and the run ID is well formed; each
failure names its setting. Building the run's LLM client then succeeds iff
the ``TIVR_API_KEY`` check passes or mock mode is set, and no request is sent
either way.

Each setting has separate valid and invalid generators, so the oracle is the
generator label and never re-parses with the code under test. The case
generator invalidates a random subset of settings (often none) so both the
success and failure branches are exercised.
"""
from __future__ import annotations

import contextlib
import io
import math
import string
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from tivr.config import (
    CORE_MODES,
    OPTIONAL_MODES,
    ConfigError,
    Decoding,
    RunConfig,
    build_config,
    parse_config,
)
from tivr.llm_client import (
    LLMClient,
    LLMConfigError,
    MockLLMClient,
    client_from_env,
    validate_api_key,
)

SETTINGS = settings(max_examples=300, deadline=None)
DS = "data.jsonl"
ALNUM = string.ascii_letters + string.digits
ALL = CORE_MODES + OPTIONAL_MODES


@dataclass(frozen=True)
class Choice:
    """One generated setting: raw CLI text (None = flag omitted), validity, parsed value."""
    raw: str | None
    valid: bool
    value: Any = None


Setting = tuple[st.SearchStrategy[Choice], st.SearchStrategy[Choice]]  # (valid, invalid)


def _forbidden_transport(*args: Any, **kwargs: Any) -> bytes:
    pytest.fail(f"LLM request sent during configuration: {args!r}")


# ---------------------------------------------------------------------------
# Value strategies
# ---------------------------------------------------------------------------

# Strings that are neither ints nor floats under any reading.
_GARBAGE = st.sampled_from(["", " ", "abc", "1,5", "0x10", "1.2.3", "--1", "true", "\u00bd", "1 2"])
_NONFINITE = st.sampled_from(["nan", "NaN", "inf", "-inf", "Infinity", "1e400", "-1e400"])


def _finite(**kw: Any) -> st.SearchStrategy[float]:
    return st.floats(allow_nan=False, allow_infinity=False, **kw)


def _absent(default: Any) -> st.SearchStrategy[Choice]:
    return st.just(Choice(None, True, default))


def _bad(raw: st.SearchStrategy[str]) -> st.SearchStrategy[Choice]:
    return raw.map(lambda r: Choice(r, False))


def _float_setting(valid: st.SearchStrategy[float], invalid: st.SearchStrategy[float],
                   absent: st.SearchStrategy[Choice]) -> Setting:
    return (
        st.one_of(absent, valid.map(lambda x: Choice(repr(x), True, x))),
        st.one_of(_bad(invalid.map(repr)), _bad(_GARBAGE), _bad(_NONFINITE)),
    )


def _int_setting(minimum: int, maximum: int | None, default: int | None) -> Setting:
    hi = 2**63 if maximum is None else maximum
    in_range = st.integers(minimum, hi)
    out_of_range = st.integers(-(10**30), minimum - 1)
    if maximum is not None:
        out_of_range = st.one_of(out_of_range, st.integers(maximum + 1, 10**30))
    return (
        st.one_of(_absent(default), in_range.map(lambda n: Choice(str(n), True, n))),
        st.one_of(
            _bad(out_of_range.map(str)),
            _bad(in_range.map(lambda n: f"{n}.0")),
            _bad(in_range.map(lambda n: f"{n}e0")),
            _bad(_GARBAGE),
            _bad(_NONFINITE),
        ),
    )


def _enum_setting(accepted: tuple[str, ...], default: str) -> Setting:
    return (
        st.one_of(_absent(default), st.sampled_from(accepted).map(lambda v: Choice(v, True, v))),
        _bad(st.text(max_size=12).filter(lambda s: s not in accepted)),
    )


def _mode_setting(enable: bool) -> Setting:
    listed = CORE_MODES + OPTIONAL_MODES if enable else CORE_MODES
    unlisted = st.text(max_size=12).filter(lambda s: s not in ALL)
    if not enable:  # optional modes are invalid without --enable-intervenor (11.13)
        unlisted = st.one_of(unlisted, st.sampled_from(OPTIONAL_MODES))
    return (
        st.one_of(_absent("dou"), st.sampled_from(listed).map(lambda v: Choice(v, True, v))),
        _bad(unlisted),
    )


_BELOW_ZERO = math.nextafter(0.0, -math.inf)   # largest negative float
_ABOVE_ZERO = math.nextafter(0.0, math.inf)    # smallest positive float
_TEMPERATURE = _float_setting(
    _finite(min_value=0.0, max_value=2.0),
    st.one_of(_finite(max_value=_BELOW_ZERO), _finite(min_value=math.nextafter(2.0, math.inf))),
    st.one_of(_absent(0.1), st.sampled_from([0, 1, 2]).map(lambda n: Choice(str(n), True, float(n)))),
)
_TOP_P = _float_setting(
    _finite(min_value=_ABOVE_ZERO, max_value=1.0),
    st.one_of(_finite(max_value=0.0), _finite(min_value=math.nextafter(1.0, math.inf))),
    _absent(None),
)

_run_id_valid = st.builds(
    lambda head, tail: head + tail,
    st.sampled_from(ALNUM),
    st.text(alphabet=ALNUM + "_.-", max_size=99),
)
_RUN_ID: Setting = (
    st.one_of(_absent(None), _run_id_valid.map(lambda r: Choice(r, True, r))),
    _bad(st.one_of(
        st.just(""),
        st.builds(lambda h, t: h + t, st.sampled_from("-_."), st.text(alphabet=ALNUM, max_size=10)),
        st.builds(lambda a, bad, b: a + bad + b, _run_id_valid.filter(lambda r: len(r) < 50),
                  st.sampled_from(["/", "\\", " ", ":", "\n", "@", "\u00e9"]),
                  st.text(alphabet=ALNUM, max_size=10)),
        st.text(alphabet=ALNUM, min_size=101, max_size=140),
    )),
)

_FIXED_SETTINGS: dict[str, Setting] = {
    "--feedback-regime": _enum_setting(("dou", "strict"), "dou"),
    "--k": _int_setting(1, None, 2),
    "--temperature": _TEMPERATURE,
    "--top-p": _TOP_P,
    "--max-tokens": _int_setting(1, None, None),
    "--generation-prompt-style": _enum_setting(("dou", "tivr"), "dou"),
    "--sample-size": _int_setting(1, None, 120),
    "--seed": _int_setting(0, None, 0),
    "--llm-retries": _int_setting(0, 10, 2),
    "--run-id": _RUN_ID,
}
FLAGS = ("--mode", *_FIXED_SETTINGS)


@st.composite
def _api_key(draw: st.DrawFn) -> Choice:
    """A TIVR_API_KEY value (None = unset) labelled by whether the key check should pass."""
    kind = draw(st.sampled_from(["unset", "empty", "blank", "placeholder", "real"]))
    if kind == "unset":
        return Choice(None, False)
    if kind == "empty":
        return Choice("", False)
    if kind == "blank":
        return Choice(draw(st.text(alphabet=" \t\r\n", min_size=1, max_size=5)), False)
    if kind == "placeholder":
        word = draw(st.sampled_from(["dummy", "your_api_key"]))
        upper = draw(st.lists(st.booleans(), min_size=len(word), max_size=len(word)))
        word = "".join(c.upper() if u else c for c, u in zip(word, upper))
        pre = draw(st.text(alphabet=ALNUM + "-_ ", max_size=8))
        post = draw(st.text(alphabet=ALNUM + "-_ ", max_size=8))
        return Choice(pre + word + post, False)
    key = draw(st.text(alphabet=ALNUM + "-_", min_size=1, max_size=40).filter(
        lambda s: "dummy" not in s.lower() and "your_api_key" not in s.lower()))
    return Choice(key, True, key)


@st.composite
def _cases(draw: st.DrawFn) -> tuple[list[str], dict[str, str], dict[str, Choice], bool, bool, Choice]:
    enable = draw(st.booleans())
    mock = draw(st.booleans())
    settings_by_flag = {"--mode": _mode_setting(enable), **_FIXED_SETTINGS}
    # About half the cases invalidate nothing; the rest invalidate 1..3 settings.
    to_break = draw(st.one_of(st.just(frozenset()), st.frozensets(st.sampled_from(FLAGS), min_size=1, max_size=3)))
    choices = {flag: draw(pair[1] if flag in to_break else pair[0]) for flag, pair in settings_by_flag.items()}

    # `--flag=value` keeps values that start with '-' or are empty bound to their flag.
    args = [f"{flag}={c.raw}" for flag, c in choices.items() if c.raw is not None]
    args.append(DS)
    if enable:
        args.append("--enable-intervenor")
    if mock:
        args.append("--mock")
    argv = draw(st.permutations(args))

    key = draw(_api_key())
    env = {} if key.raw is None else {"TIVR_API_KEY": key.raw}
    return list(argv), env, choices, enable, mock, key


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------

@SETTINGS
@given(case=_cases())
def test_config_valid_iff_every_setting_valid_and_failures_name_the_setting(case) -> None:
    """Property 19 over parse_config/build_config plus the run's client construction."""
    argv, env, choices, enable, mock, key = case
    invalid = {flag for flag, c in choices.items() if not c.valid}

    stderr = io.StringIO()
    if invalid:
        with pytest.raises(ConfigError) as info:
            build_config(argv, env)
        err = info.value
        assert err.flag in invalid, (err.flag, invalid)
        assert str(err).startswith(f"{err.flag}: ")

        with contextlib.redirect_stderr(stderr), pytest.raises(SystemExit) as exit_info:
            parse_config(argv, env)
        assert exit_info.value.code == 2
        assert stderr.getvalue().startswith(f"error: {err.flag}: ")
        return

    v = {flag: c.value for flag, c in choices.items()}
    expected = RunConfig(
        dataset=Path(DS),
        mode=v["--mode"],
        enable_intervenor=enable,
        feedback_regime=v["--feedback-regime"],
        k=v["--k"],
        decoding=Decoding(temperature=v["--temperature"], top_p=v["--top-p"], max_tokens=v["--max-tokens"]),
        generation_prompt_style=v["--generation-prompt-style"],
        sample_size=v["--sample-size"],
        seed=v["--seed"],
        mock=mock,
        llm_retries=v["--llm-retries"],
        run_id=v["--run-id"],
    )
    with contextlib.redirect_stderr(stderr):
        cfg = parse_config(argv, env)
    assert stderr.getvalue() == ""
    assert cfg == expected
    assert build_config(argv, env) == expected

    # Requirement 1.1: the key check runs at client construction, before any request.
    if mock or key.valid:
        client = client_from_env(cfg.decoding, model=cfg.model, mock=cfg.mock,
                                 retries=cfg.llm_retries, env=env, transport=_forbidden_transport)
        assert isinstance(client, MockLLMClient if mock else LLMClient)
        assert client.llm_mode == ("mock" if mock else "live")
        assert client.decoding == cfg.decoding
    else:
        with pytest.raises(LLMConfigError, match="TIVR_API_KEY"):
            client_from_env(cfg.decoding, model=cfg.model, mock=cfg.mock,
                            retries=cfg.llm_retries, env=env, transport=_forbidden_transport)


@SETTINGS
@given(key=_api_key(), retries=st.integers(0, 10))
def test_live_client_rejects_missing_or_placeholder_key_before_any_request(key: Choice, retries: int) -> None:
    """Requirement 1.1 directly on validate_api_key and the LLMClient constructor."""
    if key.valid:
        assert validate_api_key(key.raw) == key.raw
        client = LLMClient(Decoding(), model="m", api_base="https://api.example.test/v1",
                           api_key=key.raw, retries=retries, transport=_forbidden_transport)
        assert client.llm_mode == "live"
    else:
        with pytest.raises(LLMConfigError, match="TIVR_API_KEY"):
            validate_api_key(key.raw)
        with pytest.raises(LLMConfigError, match="TIVR_API_KEY"):
            LLMClient(Decoding(), model="m", api_base="https://api.example.test/v1",
                      api_key=key.raw, retries=retries, transport=_forbidden_transport)
    # Mock mode never consults the key.
    assert isinstance(MockLLMClient(Decoding()), MockLLMClient)
