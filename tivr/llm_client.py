"""LLM client for the TIVR pipeline (design §3 "LLM client").

* :class:`LLMClient` talks to an OpenAI-compatible ``/chat/completions`` endpoint.
  The API key is validated in the constructor, before any request (Requirement 1.1).
  Every request carries ``temperature``; ``top_p`` and ``max_tokens`` are sent only
  when supplied (Requirements 2.1-2.5). Each request gets 1 initial attempt plus
  ``retries`` retries (0-10), each with a 180 s timeout; exhaustion raises
  :class:`LLMRequestError` naming the HTTP status or exception type and the API
  host, never the key (Requirement 1.6).
* :class:`MockLLMClient` is used only with an explicit ``--mock`` flag. It never
  touches the network, ignores ``TIVR_API_KEY``, and returns :func:`canned`, a pure
  function of the prompt (Requirement 1.2).
* Every successful call appends a :class:`CallRecord`; token fields are ``None``
  when the endpoint returns no usage (Requirement 14.10).

The HTTP layer is an injectable :data:`Transport` so tests never open sockets.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping

from tivr.config import DEFAULT_LLM_RETRIES, MAX_LLM_RETRIES, Decoding

API_KEY_ENV = "TIVR_API_KEY"
API_BASE_ENV = "TIVR_API_BASE"
DEFAULT_API_BASE = "https://api.deepseek.com/v1"
DEFAULT_TIMEOUT_S = 180
PHASES: tuple[str, ...] = ("generation", "repair")

_PLACEHOLDER_SUBSTRINGS: tuple[str, ...] = ("dummy", "your_api_key")


# ---------------------------------------------------------------------------
# Errors and records
# ---------------------------------------------------------------------------

class LLMConfigError(Exception):
    """Missing or placeholder API key in live mode. The message names ``TIVR_API_KEY``."""


class LLMRequestError(Exception):
    """A request failed on every attempt.

    The message holds only the attempt count, the HTTP status or exception type
    name, and ``host:port``; it never contains the key or the exception text.
    """

    def __init__(self, attempts: int, cause: str, host: str) -> None:
        self.attempts = attempts
        self.cause = cause
        self.host = host
        super().__init__(f"LLM request failed after {attempts} attempts: {cause} from {host}")


class HTTPStatusError(Exception):
    """Raised by a :data:`Transport` for a non-2xx HTTP response."""

    def __init__(self, status: int) -> None:
        self.status = status
        super().__init__(f"HTTP {status}")


@dataclass
class CallRecord:
    """Usage of one completed LLM call; token counts are ``None`` when not reported."""
    prompt_tokens: int | None
    completion_tokens: int | None
    phase: str  # "generation" | "repair"


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------

# (url, headers, body, timeout_s) -> response body bytes. Raises HTTPStatusError
# for HTTP errors and any other exception for transport failures.
Transport = Callable[[str, Mapping[str, str], bytes, float], bytes]


def urllib_transport(url: str, headers: Mapping[str, str], body: bytes, timeout_s: float) -> bytes:
    """Default stdlib transport (POST)."""
    req = urllib.request.Request(url, data=body, headers=dict(headers), method="POST")
    try:
        # Looked up at call time so test fixtures that patch urlopen take effect.
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise HTTPStatusError(exc.code) from None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def api_host(base: str) -> str:
    """``hostname:port`` of an API base URL (no scheme, path, or credentials)."""
    text = (base or "").strip()
    if "://" not in text:
        text = "//" + text  # bare host such as "api.example.com/v1"
    parsed = urllib.parse.urlsplit(text)
    host = (parsed.hostname or "").lower()
    if not host:
        return "unknown"
    try:
        port = parsed.port
    except ValueError:
        port = None
    if port is None:
        port = 80 if parsed.scheme.lower() == "http" else 443
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    return f"{host}:{port}"


def validate_api_key(api_key: str | None) -> str:
    """Return the key or raise :class:`LLMConfigError` naming ``TIVR_API_KEY`` (1.1)."""
    if api_key is None:
        raise LLMConfigError(f"{API_KEY_ENV} is not set; set it to a real API key or pass --mock")
    if not api_key.strip():
        raise LLMConfigError(f"{API_KEY_ENV} is empty; set it to a real API key or pass --mock")
    lowered = api_key.lower()
    if any(s in lowered for s in _PLACEHOLDER_SUBSTRINGS):
        raise LLMConfigError(
            f"{API_KEY_ENV} contains a placeholder value; set it to a real API key or pass --mock"
        )
    return api_key


def _token_count(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _check_phase(phase: str) -> None:
    if phase not in PHASES:
        raise ValueError(f"phase must be one of {', '.join(PHASES)} (got {phase!r})")


def _default_backoff(attempt: int) -> float:
    """Seconds to wait before retry number ``attempt`` (1-based)."""
    return float(min(2 ** attempt, 30))


# ---------------------------------------------------------------------------
# Live client
# ---------------------------------------------------------------------------

class LLMClient:
    """OpenAI-compatible chat client with retries and usage accounting."""

    llm_mode = "live"

    def __init__(
        self,
        decoding: Decoding,
        *,
        model: str,
        api_base: str,
        api_key: str | None,
        retries: int = DEFAULT_LLM_RETRIES,
        timeout_s: int = DEFAULT_TIMEOUT_S,
        transport: Transport = urllib_transport,
        sleep: Callable[[float], None] = time.sleep,
        backoff: Callable[[int], float] = _default_backoff,
    ) -> None:
        self._api_key = validate_api_key(api_key)
        if isinstance(retries, bool) or not isinstance(retries, int) or not 0 <= retries <= MAX_LLM_RETRIES:
            raise ValueError(f"retries must be an integer from 0 to {MAX_LLM_RETRIES} (got {retries!r})")
        self.decoding = decoding
        self.model = model
        self.api_base = api_base.rstrip("/")
        self.api_host = api_host(api_base)
        self.retries = retries
        self.timeout_s = timeout_s
        self._transport = transport
        self._sleep = sleep
        self._backoff = backoff
        self.calls: list[CallRecord] = []

    def __repr__(self) -> str:  # never expose the key
        return f"{type(self).__name__}(model={self.model!r}, api_host={self.api_host!r})"

    @property
    def attempts(self) -> int:
        return 1 + self.retries

    def build_payload(self, prompt: str) -> dict[str, Any]:
        """Request body: temperature always; top_p / max_tokens only when supplied."""
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.decoding.temperature,
        }
        if self.decoding.top_p is not None:
            payload["top_p"] = self.decoding.top_p
        if self.decoding.max_tokens is not None:
            payload["max_tokens"] = self.decoding.max_tokens
        return payload

    def chat(self, prompt: str, *, phase: str) -> str:
        """Send one prompt; return the response text or raise :class:`LLMRequestError`."""
        _check_phase(phase)
        url = f"{self.api_base}/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self._api_key}"}
        body = json.dumps(self.build_payload(prompt)).encode("utf-8")

        cause = "unknown failure"
        for attempt in range(self.attempts):
            if attempt:
                self._sleep(self._backoff(attempt))
            try:
                raw = self._transport(url, headers, body, self.timeout_s)
                text, record = self._parse(raw, phase)
            except HTTPStatusError as exc:
                cause = f"HTTP {exc.status}"
            except urllib.error.HTTPError as exc:  # a transport that lets urllib errors escape
                cause = f"HTTP {exc.code}"
            except Exception as exc:  # noqa: BLE001 - only the type name is reported
                cause = type(exc).__name__
            else:
                self.calls.append(record)
                return text
        raise LLMRequestError(self.attempts, cause, self.api_host) from None

    @staticmethod
    def _parse(raw: bytes | str, phase: str) -> tuple[str, CallRecord]:
        data = json.loads(raw)
        content = data["choices"][0]["message"]["content"]
        if content is None:
            content = ""
        if not isinstance(content, str):
            raise TypeError("content is not a string")
        usage = data.get("usage") if isinstance(data, dict) else None
        if not isinstance(usage, dict):
            usage = {}
        record = CallRecord(
            prompt_tokens=_token_count(usage.get("prompt_tokens")),
            completion_tokens=_token_count(usage.get("completion_tokens")),
            phase=phase,
        )
        return content, record


# ---------------------------------------------------------------------------
# Mock client
# ---------------------------------------------------------------------------

_FUNC_NAME = re.compile(r"def (\w+)\(")
_REPAIR_MARKER = re.compile(r"\b(?:fix|fixes|fixed|fixing|bug|bugs)\b", re.IGNORECASE)

MOCK_CRITIQUE = "Mock critique: the previous code may not handle every input; here is a revised version."

_MOCK_BODIES: tuple[str, ...] = (
    "    return None",
    "    return args[0] if args else None",
    "    return 0",
    "    return []",
)


def canned(prompt: str) -> str:
    """Deterministic mock response; a pure function of the prompt bytes (1.2)."""
    match = _FUNC_NAME.search(prompt)
    name = match.group(1) if match else "solve"
    index = hashlib.sha256(prompt.encode("utf-8")).digest()[0] % len(_MOCK_BODIES)
    code = f"def {name}(*args, **kwargs):\n{_MOCK_BODIES[index]}\n"
    block = f"```python\n{code}```"
    if _REPAIR_MARKER.search(prompt):
        return f"{MOCK_CRITIQUE}\n\n{block}"
    return block


class MockLLMClient(LLMClient):
    """Offline client for explicit ``--mock`` runs; no network, ignores ``TIVR_API_KEY``."""

    llm_mode = "mock"

    def __init__(self, decoding: Decoding | None = None, *, model: str = "mock", **_ignored: Any) -> None:
        # Deliberately skips LLMClient.__init__: no key validation, no transport.
        self.decoding = decoding if decoding is not None else Decoding()
        self.model = model
        self.api_base = ""
        self.api_host = "mock"
        self.retries = 0
        self.timeout_s = DEFAULT_TIMEOUT_S
        self.calls = []

    def chat(self, prompt: str, *, phase: str) -> str:
        _check_phase(phase)
        response = canned(prompt)
        self.calls.append(CallRecord(len(prompt) // 4, len(response) // 4, phase))
        return response


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def client_from_env(
    decoding: Decoding,
    *,
    model: str,
    mock: bool,
    retries: int = DEFAULT_LLM_RETRIES,
    env: Mapping[str, str] | None = None,
    transport: Transport = urllib_transport,
) -> LLMClient:
    """Build the run's client from ``TIVR_API_KEY`` / ``TIVR_API_BASE`` (mock only when asked)."""
    if mock:
        return MockLLMClient(decoding, model=model)
    env = os.environ if env is None else env
    base = (env.get(API_BASE_ENV) or "").strip() or DEFAULT_API_BASE
    return LLMClient(decoding, model=model, api_base=base, api_key=env.get(API_KEY_ENV),
                     retries=retries, transport=transport)
