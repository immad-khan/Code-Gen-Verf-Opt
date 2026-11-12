"""Shared pytest configuration for the TIVR test suite.

Requirement 18.13: the suite must complete without making any network request.
Every test runs with outbound socket connections and ``urllib.request.urlopen``
replaced by functions that fail the test. Subprocesses (e.g. the verifier's
pytest runs in temp dirs) are separate interpreters and are not affected.
"""

from __future__ import annotations

import socket
import urllib.request
from typing import Any, NoReturn

import pytest


def _blocked(what: str) -> Any:
    def _fail(*args: Any, **kwargs: Any) -> NoReturn:
        # pytest.fail raises a BaseException subclass, so `except Exception`
        # in code under test cannot swallow it.
        pytest.fail(f"network access attempted during test: {what} args={args!r}", pytrace=True)

    return _fail


@pytest.fixture(autouse=True)
def _block_network(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket.socket, "connect", _blocked("socket.socket.connect"))
    monkeypatch.setattr(urllib.request, "urlopen", _blocked("urllib.request.urlopen"))
