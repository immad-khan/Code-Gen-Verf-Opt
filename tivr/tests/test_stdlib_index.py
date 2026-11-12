"""Unit tests for tivr.stdlib_index (Requirement 8.5)."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from tivr import stdlib_index


@pytest.fixture(scope="module")
def built_cache_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Build the index once into a temporary cache dir shared by this module's tests."""
    directory = tmp_path_factory.mktemp("tivr_cache")
    stdlib_index.clear_memo()
    stdlib_index.load_index(directory)
    return directory


@pytest.fixture
def cache_env(built_cache_dir: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("TIVR_CACHE_DIR", str(built_cache_dir))
    stdlib_index.clear_memo()
    yield built_cache_dir
    stdlib_index.clear_memo()


@pytest.mark.parametrize("identifier", ["math", "collections", "sqrt", "defaultdict", "heappush", "reduce"])
def test_known_stdlib_names(cache_env: Path, identifier: str) -> None:
    assert stdlib_index.is_stdlib_name(identifier)


@pytest.mark.parametrize("identifier", ["zq_not_a_stdlib_name_8f3a", "numpy", "solution", "_private"])
def test_non_stdlib_names(cache_env: Path, identifier: str) -> None:
    assert not stdlib_index.is_stdlib_name(identifier)


def test_module_names_vs_members(cache_env: Path) -> None:
    assert stdlib_index.is_stdlib_module("math")
    assert stdlib_index.is_stdlib_module("tkinter")  # denylisted for import, still a module name
    assert not stdlib_index.is_stdlib_module("sqrt")


def test_cache_file_created_with_expected_name(cache_env: Path) -> None:
    path = stdlib_index.cache_path()
    assert path.parent == cache_env
    assert path.name.startswith("stdlib_index-") and path.suffix == ".json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert "math" in data["modules"] and "sqrt" in data["members"]


def test_cache_file_is_reused(cache_env: Path) -> None:
    path = stdlib_index.cache_path()
    data = json.loads(path.read_text(encoding="utf-8"))
    marker = "zz_injected_member_for_reuse_test"
    data["members"].append(marker)
    path.write_text(json.dumps(data), encoding="utf-8")
    try:
        stdlib_index.clear_memo()
        # Only a reused cache file can know the injected name.
        assert stdlib_index.is_stdlib_name(marker)
    finally:
        data["members"].remove(marker)
        path.write_text(json.dumps(data), encoding="utf-8")


def test_corrupt_cache_is_rebuilt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, cache_env: Path) -> None:
    monkeypatch.setenv("TIVR_CACHE_DIR", str(tmp_path))
    stdlib_index.clear_memo()
    path = stdlib_index.cache_path()
    path.write_text("{not json", encoding="utf-8")
    assert stdlib_index.is_stdlib_name("defaultdict")
    assert json.loads(path.read_text(encoding="utf-8"))["format_version"] == stdlib_index.FORMAT_VERSION


def test_incomplete_build_is_not_cached(tmp_path: Path) -> None:
    stdlib_index.clear_memo()
    index = stdlib_index.load_index(tmp_path, timeout_s=0.001)
    stdlib_index.clear_memo()
    # Module names come from sys.stdlib_module_names, so they survive a failed build.
    assert index.is_module("math")
    assert not index.complete
    assert not stdlib_index.cache_path(tmp_path).exists()
