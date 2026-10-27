"""Unit tests for tivr.llm_client (Requirements 1.1, 1.2, 1.6, 18.9).

No network: every test uses a fake transport or a monkeypatched ``urlopen``
(conftest blocks the real one).
"""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.request

import pytest

from tivr.config import Decoding
from tivr.llm_client import (
    API_KEY_ENV, DEFAULT_TIMEOUT_S, HTTPStatusError, LLMClient, LLMConfigError,
    LLMRequestError, MockLLMClient, api_host, canned, client_from_env, urllib_transport,
)

KEY = "sk-real-secret-123"
BASE = "https://api.deepseek.com/v1"
HOST = "api.deepseek.com:443"


class FakeTransport:
    """Replays queued responses (dict -> JSON bytes, bytes as-is, exceptions raised)."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []

    def __call__(self, url, headers, body, timeout_s):
        self.requests.append((url, dict(headers), json.loads(body), timeout_s))
        item = self.responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        if isinstance(item, (bytes, str)):
            return item
        return json.dumps(item).encode()


def ok(content="```python\ndef f():\n    return 1\n```", usage=None):
    body = {"choices": [{"message": {"content": content}}]}
    if usage is not None:
        body["usage"] = usage
    return body


def make(transport, decoding=Decoding(), retries=2, sleep=None, backoff=None):
    kwargs = {}
    if backoff is not None:
        kwargs["backoff"] = backoff
    return LLMClient(decoding, model="m", api_base=BASE, api_key=KEY, retries=retries,
                     transport=transport, sleep=sleep or (lambda s: None), **kwargs)


# ---------------------------------------------------------------------------
# Key validation (1.1) and mock mode (1.2)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("key", [None, "", "   ", "\t\n", "dummy", "DUMMY-key", "my-dummy-123",
                                 "YOUR_API_KEY", "your_api_key_here"])
def test_bad_key_raises_config_error_naming_env_var(key):
    t = FakeTransport()
    with pytest.raises(LLMConfigError, match=API_KEY_ENV):
        LLMClient(Decoding(), model="m", api_base=BASE, api_key=key, transport=t)
    assert t.requests == []


@pytest.mark.parametrize("env", [{}, {API_KEY_ENV: ""}, {API_KEY_ENV: "  "}, {API_KEY_ENV: "dummy"},
                                 {API_KEY_ENV: "YOUR_API_KEY"}])
def test_live_factory_bad_key_no_transport_calls(env):
    t = FakeTransport()
    with pytest.raises(LLMConfigError, match="TIVR_API_KEY"):
        client_from_env(Decoding(), model="m", mock=False, env=env, transport=t)
    assert t.requests == []


@pytest.mark.parametrize("env", [{}, {API_KEY_ENV: "dummy"}, {API_KEY_ENV: "YOUR_API_KEY"},
                                 {API_KEY_ENV: KEY}])
def test_mock_ignores_key_and_never_uses_transport(env):
    t = FakeTransport()
    m = client_from_env(Decoding(), model="m", mock=True, env=env, transport=t)
    assert isinstance(m, MockLLMClient) and m.llm_mode == "mock"
    m.chat("def g(x):", phase="generation")
    m.chat("fix the bug in def g(x):", phase="repair")
    assert t.requests == []


def test_mock_is_pure_function_of_prompt():
    m = MockLLMClient(Decoding())
    prompt = "Solve:\ndef add(a, b):\n    ..."
    r1 = m.chat(prompt, phase="generation")
    assert r1 == m.chat(prompt, phase="generation") == MockLLMClient().chat(prompt, phase="repair")
    assert r1 == canned(prompt)
    assert "def add(" in r1
    assert m.calls[0].prompt_tokens == len(prompt) // 4
    assert m.calls[0].completion_tokens == len(r1) // 4
    assert [c.phase for c in m.calls] == ["generation", "generation"]
    assert "def solve(" in canned("no function here")
    assert canned("Please fix the bug in def g(x):").startswith("Mock critique")


# ---------------------------------------------------------------------------
# Payload and usage accounting
# ---------------------------------------------------------------------------

def test_payload_default_and_supplied_decoding():
    t = FakeTransport(ok(), ok())
    make(t).chat("p", phase="generation")
    make(t, Decoding(temperature=0.5, top_p=0.9, max_tokens=64)).chat("p", phase="repair")
    (url, headers, p1, timeout), (_, _, p2, _) = t.requests
    assert url == f"{BASE}/chat/completions" and timeout == DEFAULT_TIMEOUT_S == 180
    assert headers["Authorization"] == f"Bearer {KEY}"
    assert p1["model"] == "m" and p1["messages"] == [{"role": "user", "content": "p"}]
    assert p1["temperature"] == 0.1 and "top_p" not in p1 and "max_tokens" not in p1
    assert (p2["temperature"], p2["top_p"], p2["max_tokens"]) == (0.5, 0.9, 64)


def test_usage_records_and_missing_usage_is_none():
    t = FakeTransport(ok(usage={"prompt_tokens": 7, "completion_tokens": 3}), ok(),
                      ok(usage={"prompt_tokens": "x", "completion_tokens": -1}))
    c = make(t)
    c.chat("a", phase="generation")
    c.chat("b", phase="repair")
    c.chat("c", phase="repair")
    assert [(r.prompt_tokens, r.completion_tokens, r.phase) for r in c.calls] == [
        (7, 3, "generation"), (None, None, "repair"), (None, None, "repair")]


@pytest.mark.parametrize("phase", ["", "gen", "Generation", "critique"])
def test_invalid_phase_rejected_before_request(phase):
    t = FakeTransport(ok())
    with pytest.raises(ValueError, match="phase"):
        make(t).chat("p", phase=phase)
    with pytest.raises(ValueError, match="phase"):
        MockLLMClient().chat("p", phase=phase)
    assert t.requests == []


# ---------------------------------------------------------------------------
# Retries and failures (1.6)
# ---------------------------------------------------------------------------

def test_retry_then_success_with_backoff_between_attempts():
    sleeps, backoff_args = [], []
    t = FakeTransport(HTTPStatusError(503), TimeoutError("slow"), ok("hi"))

    def backoff(n):
        backoff_args.append(n)
        return 0.25 * n

    c = make(t, sleep=sleeps.append, backoff=backoff)
    assert c.chat("p", phase="generation") == "hi"
    assert len(t.requests) == 3
    assert backoff_args == [1, 2] and sleeps == [0.25, 0.5]
    assert len(c.calls) == 1


@pytest.mark.parametrize("retries,attempts", [(0, 1), (2, 3), (10, 11)])
def test_retries_count_determines_attempts(retries, attempts):
    sleeps = []
    t = FakeTransport(*[HTTPStatusError(500)] * attempts)
    with pytest.raises(LLMRequestError) as info:
        make(t, retries=retries, sleep=sleeps.append).chat("p", phase="generation")
    assert str(info.value) == f"LLM request failed after {attempts} attempts: HTTP 500 from {HOST}"
    assert info.value.attempts == attempts
    assert len(t.requests) == attempts and len(sleeps) == attempts - 1


@pytest.mark.parametrize("retries", [-1, 11, True, 1.5, "2"])
def test_invalid_retries_rejected(retries):
    with pytest.raises(ValueError, match="retries"):
        make(FakeTransport(), retries=retries)


@pytest.mark.parametrize("exc,cause", [
    (HTTPStatusError(429), "HTTP 429"),
    (urllib.error.HTTPError(BASE, 401, f"bad key {KEY}", {}, None), "HTTP 401"),
    (ConnectionResetError(f"boom {KEY}"), "ConnectionResetError"),
    (TimeoutError(f"timed out {KEY}"), "TimeoutError"),
])
def test_exhausted_retries_error_text(exc, cause):
    t = FakeTransport(exc, exc, exc)
    with pytest.raises(LLMRequestError) as info:
        make(t).chat("p", phase="generation")
    msg = str(info.value)
    assert msg == f"LLM request failed after 3 attempts: {cause} from {HOST}"
    assert KEY not in msg and KEY not in repr(info.value)
    assert info.value.__cause__ is None and info.value.__suppress_context__
    assert len(t.requests) == 3


@pytest.mark.parametrize("raw,cause", [
    (b"not json", "JSONDecodeError"),
    (json.dumps({"choices": []}).encode(), "IndexError"),
    (json.dumps({"error": "x"}).encode(), "KeyError"),
    (json.dumps({"choices": [{"message": {"content": 5}}]}).encode(), "TypeError"),
])
def test_malformed_response_counts_as_failure(raw, cause):
    t = FakeTransport(raw, raw)
    c = make(t, retries=1)
    with pytest.raises(LLMRequestError, match=f"after 2 attempts: {cause} from {HOST}$"):
        c.chat("p", phase="generation")
    assert c.calls == []


def test_malformed_then_valid_succeeds():
    t = FakeTransport(b"{", ok("fine"))
    assert make(t, retries=1).chat("p", phase="repair") == "fine"


def test_key_never_in_repr():
    c = make(FakeTransport())
    assert KEY not in repr(c) and KEY not in str(c)
    assert "api.deepseek.com:443" in repr(c)


# ---------------------------------------------------------------------------
# Factory, host formatting, default transport
# ---------------------------------------------------------------------------

def test_live_factory_reads_env():
    c = client_from_env(Decoding(), model="m", mock=False, retries=4,
                        env={"TIVR_API_KEY": KEY, "TIVR_API_BASE": "http://localhost:8080/v1/"})
    assert c.llm_mode == "live" and c.retries == 4
    assert c.api_host == "localhost:8080" and c.api_base == "http://localhost:8080/v1"
    assert KEY not in repr(c)
    d = client_from_env(Decoding(), model="m", mock=False, env={"TIVR_API_KEY": KEY, "TIVR_API_BASE": " "})
    assert d.api_host == HOST


def test_api_host():
    assert api_host(BASE) == HOST
    assert api_host("http://user:pw@Example.COM/v1") == "example.com:80"
    assert api_host("https://[::1]:9000/") == "[::1]:9000"
    assert api_host("api.example.com/v1") == "api.example.com:443"
    assert api_host("") == "unknown"


def test_urllib_transport_success(monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout):
        seen.update(url=req.full_url, method=req.get_method(), data=req.data, timeout=timeout,
                    auth=req.get_header("Authorization"))
        return io.BytesIO(b'{"ok": 1}')

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    out = urllib_transport(f"{BASE}/chat/completions", {"Authorization": "Bearer x"}, b"{}", 180)
    assert out == b'{"ok": 1}'
    assert seen == {"url": f"{BASE}/chat/completions", "method": "POST", "data": b"{}",
                    "timeout": 180, "auth": "Bearer x"}


def test_urllib_transport_converts_http_error(monkeypatch):
    def fake_urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 503, "unavailable", {}, io.BytesIO(b""))

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(HTTPStatusError) as info:
        urllib_transport(BASE, {}, b"{}", 1)
    assert info.value.status == 503 and info.value.__cause__ is None


def test_default_transport_end_to_end_failure_text(monkeypatch):
    calls = []

    def fake_urlopen(req, timeout):
        calls.append(timeout)
        raise urllib.error.URLError(f"refused {KEY}")

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    c = LLMClient(Decoding(), model="m", api_base=BASE, api_key=KEY, retries=1, sleep=lambda s: None)
    with pytest.raises(LLMRequestError) as info:
        c.chat("p", phase="generation")
    assert str(info.value) == f"LLM request failed after 2 attempts: URLError from {HOST}"
    assert calls == [180, 180]
