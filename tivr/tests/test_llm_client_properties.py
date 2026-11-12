"""Property-based tests for the LLM client (tivr.llm_client).

Feature: paper-aligned-repair-tool, Properties 17 (error-text part), 18, 20.

Property 18: Mock responses are pure functions of the prompt.
**Validates: Requirements 1.2**

Property 20: Decoding parameters reach every request.
**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 11.11**

Property 17 (error-text part): Secrets never leave the process.
**Validates: Requirements 1.6**

No network: every live client uses a recording fake transport, and conftest
blocks sockets and ``urlopen`` for the whole suite.
"""
from __future__ import annotations

import json
import subprocess
import sys
import traceback
import urllib.error
from pathlib import Path
from typing import Any

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from tivr.config import Decoding
from tivr.llm_client import (
    API_BASE_ENV, API_KEY_ENV, HTTPStatusError, LLMClient, LLMRequestError,
    MockLLMClient, canned, client_from_env,
)

SETTINGS = settings(max_examples=150, deadline=None)
REPO_ROOT = Path(__file__).resolve().parents[2]
BASE = "https://api.example.com/v1"
HOST = "api.example.com:443"
MODEL = "test-model"
DEFAULT_TEMPERATURE = 0.1  # Requirement 2.1: used when temperature is omitted

# ---------------------------------------------------------------------------
# Shared strategies
# ---------------------------------------------------------------------------

# Any text encodable as UTF-8 (lone surrogates are not valid prompt text).
TEXT = st.text(alphabet=st.characters(blacklist_categories=("Cs",)), max_size=200)
IDENT = st.from_regex(r"[A-Za-z_][A-Za-z0-9_]{0,15}", fullmatch=True)


@st.composite
def structured_prompts(draw: Any) -> str:
    """Prompts shaped like real generation/repair prompts (signature, optional fix marker)."""
    parts = [draw(TEXT)]
    if draw(st.booleans()):
        parts.append(f"def {draw(IDENT)}({draw(st.sampled_from(['', 'x', 'a, b', 'nums: list']))}):")
    if draw(st.booleans()):
        parts.append(draw(st.sampled_from(["Fix the bug.", "bugs found", "fixing", "FIXED", "debugger"])))
    parts.append(draw(TEXT))
    return draw(st.sampled_from(["\n", " ", ""])).join(parts)


PROMPTS = st.one_of(TEXT, structured_prompts())
PHASES = st.sampled_from(("generation", "repair"))


class RecordingTransport:
    """Records every request and replies with a minimal successful completion."""

    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []

    def __call__(self, url: str, headers: Any, body: bytes, timeout_s: float) -> bytes:
        self.requests.append(json.loads(body))
        return json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode()


def _never_called(*args: Any, **kwargs: Any) -> bytes:
    raise AssertionError("mock client used a transport")


# ---------------------------------------------------------------------------
# Property 18: mock responses are pure functions of the prompt
# ---------------------------------------------------------------------------

@SETTINGS
@given(prompt=PROMPTS, phases=st.lists(PHASES, min_size=1, max_size=4))
def test_property18_mock_responses_are_pure_functions_of_prompt(prompt: str, phases: list[str]) -> None:
    """canned(prompt) and fresh MockLLMClient instances agree byte-for-byte; no transport."""
    expected = canned(prompt)
    assert isinstance(expected, str)
    expected_bytes = expected.encode("utf-8")
    assert canned(prompt).encode("utf-8") == expected_bytes

    first = MockLLMClient(Decoding(), model="mock", transport=_never_called)
    second = MockLLMClient(Decoding(temperature=1.5, top_p=0.5, max_tokens=7), model="other",
                           transport=_never_called)
    for phase in phases:
        assert first.chat(prompt, phase=phase).encode("utf-8") == expected_bytes
        assert second.chat(prompt, phase=phase).encode("utf-8") == expected_bytes

    # Built through the factory with a key in the environment: still mock, still identical.
    via_factory = client_from_env(Decoding(), model="mock", mock=True,
                                  env={API_KEY_ENV: "sk-should-be-ignored"}, transport=_never_called)
    assert isinstance(via_factory, MockLLMClient)
    assert via_factory.chat(prompt, phase=phases[0]).encode("utf-8") == expected_bytes
    assert not hasattr(first, "_transport") and not hasattr(via_factory, "_transport")


_SUBPROCESS_SCRIPT = (
    "import json, sys\n"
    "from tivr.llm_client import MockLLMClient, canned\n"
    "prompts = json.loads(sys.stdin.read())\n"
    "client = MockLLMClient()\n"
    "out = [[canned(p), client.chat(p, phase='generation')] for p in prompts]\n"
    "sys.stdout.write(json.dumps(out))\n"
)


@settings(max_examples=15, deadline=None)
@given(prompts=st.lists(PROMPTS, min_size=1, max_size=15))
def test_property18_mock_responses_identical_across_runs(prompts: list[str]) -> None:
    """A separate interpreter (fresh hash seed) produces byte-identical mock responses."""
    proc = subprocess.run(
        [sys.executable, "-c", _SUBPROCESS_SCRIPT],
        input=json.dumps(prompts).encode("ascii"),  # ensure_ascii: safe on any console codepage
        capture_output=True, cwd=REPO_ROOT, timeout=120,
        env={**_minimal_env(), "PYTHONHASHSEED": "random"},
    )
    assert proc.returncode == 0, proc.stderr.decode("utf-8", "replace")
    results = json.loads(proc.stdout.decode("ascii"))
    assert len(results) == len(prompts)
    for prompt, (other_canned, other_chat) in zip(prompts, results):
        here = canned(prompt).encode("utf-8")
        assert other_canned.encode("utf-8") == here
        assert other_chat.encode("utf-8") == here


def _minimal_env() -> dict[str, str]:
    import os

    keep = ("SYSTEMROOT", "PATH", "TEMP", "TMP", "PYTHONPATH", "VIRTUAL_ENV")
    return {k: v for k, v in os.environ.items() if k.upper() in keep}


# ---------------------------------------------------------------------------
# Property 20: decoding parameters reach every request
# ---------------------------------------------------------------------------

TEMPERATURES = st.one_of(st.none(), st.floats(min_value=0.0, max_value=2.0, allow_nan=False))
TOP_PS = st.one_of(st.none(), st.floats(min_value=0.0, max_value=1.0, exclude_min=True, allow_nan=False))
MAX_TOKENS = st.one_of(st.none(), st.integers(min_value=1, max_value=10**6))


@SETTINGS
@given(
    temperature=TEMPERATURES, top_p=TOP_PS, max_tokens=MAX_TOKENS,
    calls=st.lists(st.tuples(PROMPTS, PHASES), min_size=1, max_size=6),
    via_factory=st.booleans(),
)
def test_property20_decoding_parameters_reach_every_request(
    temperature: float | None, top_p: float | None, max_tokens: int | None,
    calls: list[tuple[str, str]], via_factory: bool,
) -> None:
    """Every payload has temperature (0.1 if omitted) and top_p / max_tokens iff supplied."""
    kwargs: dict[str, Any] = {}
    if temperature is not None:
        kwargs["temperature"] = temperature
    if top_p is not None:
        kwargs["top_p"] = top_p
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    decoding = Decoding(**kwargs)

    expected = {"temperature": DEFAULT_TEMPERATURE if temperature is None else temperature}
    if top_p is not None:
        expected["top_p"] = top_p
    if max_tokens is not None:
        expected["max_tokens"] = max_tokens

    transport = RecordingTransport()
    if via_factory:
        client = client_from_env(decoding, model=MODEL, mock=False, retries=0, transport=transport,
                                 env={API_KEY_ENV: "sk-live-key-0123", API_BASE_ENV: BASE})
    else:
        client = LLMClient(decoding, model=MODEL, api_base=BASE, api_key="sk-live-key-0123",
                           retries=0, transport=transport, sleep=lambda s: None)

    for prompt, phase in calls:
        assert client.chat(prompt, phase=phase) == "ok"

    assert len(transport.requests) == len(calls)
    assert [c.phase for c in client.calls] == [phase for _, phase in calls]
    for payload, (prompt, _) in zip(transport.requests, calls):
        decoding_fields = {k: v for k, v in payload.items() if k not in ("model", "messages")}
        assert decoding_fields == expected
        for name, value in expected.items():  # exact type too (no int/float/str coercion)
            assert type(decoding_fields[name]) is type(value)
        assert payload["model"] == MODEL
        assert payload["messages"] == [{"role": "user", "content": prompt}]


# ---------------------------------------------------------------------------
# Property 17 (error-text part): secrets never leave the process
# ---------------------------------------------------------------------------

KEYS = (
    st.text(alphabet=st.characters(blacklist_categories=("Cs",)), min_size=8, max_size=64)
    .filter(lambda k: k.strip() != "")
    .filter(lambda k: "dummy" not in k.lower() and "your_api_key" not in k.lower())
)

_EXC_TYPES = (RuntimeError, ValueError, OSError, ConnectionError, TimeoutError, KeyError)


@st.composite
def failures(draw: Any, key: str) -> tuple[str, Any]:
    """One failed attempt: ('raise', exc) or ('body', bytes). Exception text embeds the key."""
    kind = draw(st.sampled_from(["status", "exc", "urlerror", "httperror", "body"]))
    if kind == "status":
        return "raise", HTTPStatusError(draw(st.integers(min_value=300, max_value=599)))
    if kind == "exc":
        exc_type = draw(st.sampled_from(_EXC_TYPES))
        return "raise", exc_type(f"failure with Authorization: Bearer {key}")
    if kind == "urlerror":
        return "raise", urllib.error.URLError(f"connect failed for key={key}")
    if kind == "httperror":
        code = draw(st.integers(min_value=400, max_value=599))
        return "raise", urllib.error.HTTPError(BASE, code, f"denied {key}", None, None)  # type: ignore[arg-type]
    # A 200 body that is unusable and echoes the key (bad JSON, missing choices, non-str content).
    body = draw(st.sampled_from([
        json.dumps({"error": {"message": f"invalid key {key}"}}),
        json.dumps({"choices": [{"message": {"content": {"key": key}}}]}),
        f"not json {key}",
    ]))
    return "body", body.encode("utf-8")


def _expected_cause(item: tuple[str, Any]) -> str:
    kind, value = item
    if isinstance(value, HTTPStatusError):
        return f"HTTP {value.status}"
    if isinstance(value, urllib.error.HTTPError):
        return f"HTTP {value.code}"
    if kind == "raise":
        return type(value).__name__
    return "<body>"  # parse failure: only an exception type name is reported


class FailingTransport:
    def __init__(self, items: list[tuple[str, Any]]) -> None:
        self.items = list(items)

    def __call__(self, url: str, headers: Any, body: bytes, timeout_s: float) -> bytes:
        kind, value = self.items.pop(0)
        if kind == "raise":
            raise value
        return value


@st.composite
def key_and_failures(draw: Any) -> tuple[str, int, list[tuple[str, Any]]]:
    key = draw(KEYS)
    retries = draw(st.integers(min_value=0, max_value=10))
    items = draw(st.lists(failures(key), min_size=retries + 1, max_size=retries + 1))
    return key, retries, items


@SETTINGS
@given(case=key_and_failures(), via_factory=st.booleans())
def test_property17_error_text_never_contains_key(
    case: tuple[str, int, list[tuple[str, Any]]], via_factory: bool,
) -> None:
    """After every attempt fails, no error text, args, traceback, or client repr has the key."""
    key, retries, items = case
    attempts = retries + 1
    last_cause = _expected_cause(items[-1])
    # Skip the (vanishingly rare) keys that are substrings of the fixed, key-free message text.
    benign = f"LLM request failed after {attempts} attempts: {last_cause} from {HOST}"
    assume(key not in benign and key not in repr(benign) and key not in f"LLMClient(model={MODEL!r}, api_host={HOST!r})")
    assume(key not in "LLMRequestError" and key not in "JSONDecodeError KeyError TypeError IndexError")

    transport = FailingTransport(items)
    sleeps: list[float] = []
    if via_factory:
        client = client_from_env(Decoding(), model=MODEL, mock=False, retries=retries,
                                 transport=transport, env={API_KEY_ENV: key, API_BASE_ENV: BASE})
        client._sleep = sleeps.append  # no real waiting
    else:
        client = LLMClient(Decoding(), model=MODEL, api_base=BASE, api_key=key, retries=retries,
                           transport=transport, sleep=sleeps.append)

    try:
        client.chat("def f(x):\n    pass", phase="repair")
    except LLMRequestError as err:
        error = err
    else:  # pragma: no cover - every attempt is a failure
        raise AssertionError("expected LLMRequestError")

    assert transport.items == []  # exactly 1 + retries attempts were made
    assert len(sleeps) == retries
    assert error.attempts == attempts and error.host == HOST
    if items[-1][0] == "raise":
        assert error.cause == last_cause

    texts = [
        str(error), repr(error), repr(error.args), str(error.cause), str(error.host),
        "".join(traceback.format_exception(type(error), error, error.__traceback__)),
        repr(client), str(client),
    ]
    for text in texts:
        assert key not in text
    assert error.__cause__ is None
    assert error.__context__ is None or error.__suppress_context__
