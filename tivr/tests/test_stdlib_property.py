"""Property-based tests for stdlib name detection.

Property 5: stdlib-unbound NameError detection.
Validates: Requirements 8.5, 9.4, 18.3

Feature: paper-aligned-repair-tool, Property 5
"""
from __future__ import annotations

from hypothesis import given, settings, assume
import hypothesis.strategies as st

from tivr.stdlib_index import is_stdlib_name, load_index, StdlibIndex
from tivr.enrich import EnrichContext

# Pre-warm the real stdlib index at module level to avoid network calls in tests
try:
    _STDLIB_INDEX = load_index()
except Exception:
    # If loading fails, we'll handle it in tests with assume()
    _STDLIB_INDEX = None

_SETTINGS = settings(max_examples=100)


@_SETTINGS
@given(st.from_regex(r'[A-Za-z_][A-Za-z0-9_]{0,63}', fullmatch=True))
def test_is_stdlib_name_consistent_with_index(identifier: str) -> None:
    """Property: is_stdlib_name(x) == load_index().contains(x)."""
    # Skip if index loading failed
    assume(_STDLIB_INDEX is not None)
    
    # is_stdlib_name uses the cached index
    result = is_stdlib_name(identifier)
    
    # Compare with the pre-loaded index
    index_result = _STDLIB_INDEX.contains(identifier)
    
    assert result == index_result, (
        f"is_stdlib_name('{identifier}') = {result} "
        f"but index.contains('{identifier}') = {index_result}"
    )


@_SETTINGS
@given(
    st.sampled_from(["math", "os", "sys", "json", "re", "collections", "itertools", 
                     "functools", "pathlib", "datetime", "sqrt", "defaultdict", 
                     "heappush", "reduce"]),
    st.frozensets(st.from_regex(r'[A-Za-z_]\w{0,15}', fullmatch=True), max_size=10)
)
def test_stdlib_unbound_requires_name_in_index_and_not_bound(identifier: str, bound_names: frozenset[str]) -> None:
    """Property: ctx.is_stdlib_unbound(identifier) is True iff identifier not in bound_names."""
    # Create a mock stdlib function that returns True for our fixed set
    stdlib_members = {"math", "os", "sys", "json", "re", "collections", "itertools", 
                      "functools", "pathlib", "datetime", "sqrt", "defaultdict", 
                      "heappush", "reduce"}
    
    # Create source with imports for bound names
    imports = "\n".join(f"import {name}" for name in bound_names)
    source = f"{imports}\n# Some code\nx = 1"
    
    # Create EnrichContext with mock is_stdlib and source containing imports
    ctx = EnrichContext(
        is_stdlib=lambda x: x in stdlib_members,
        candidate_modules=["test_module"],
        candidate_sources=[source]
    )
    
    # The property should hold
    result = ctx.is_stdlib_unbound(identifier)
    expected = identifier not in bound_names
    
    assert result == expected, (
        f"is_stdlib_unbound('{identifier}') = {result} with bound_names={set(bound_names)}, "
        f"expected {expected}"
    )


@_SETTINGS
@given(
    st.from_regex(r'[A-Za-z_]\w{0,30}', fullmatch=True),
    st.frozensets(st.from_regex(r'[A-Za-z_]\w{0,15}', fullmatch=True), max_size=10)
)
def test_non_stdlib_name_never_stdlib_unbound(identifier: str, bound_names: frozenset[str]) -> None:
    """Property: ctx.is_stdlib_unbound(x) is False regardless of import_bound."""
    # Skip if index loading failed
    assume(_STDLIB_INDEX is not None)
    
    # Check if identifier is NOT a stdlib name
    assume(not is_stdlib_name(identifier))
    
    # Create source with imports for bound names
    imports = "\n".join(f"import {name}" for name in bound_names)
    source = f"{imports}\n# Some code\nx = 1"
    
    # Create EnrichContext with real is_stdlib_name function
    ctx = EnrichContext(
        is_stdlib=is_stdlib_name,
        candidate_modules=["test_module"],
        candidate_sources=[source]
    )
    
    # Non-stdlib names should never be stdlib_unbound
    result = ctx.is_stdlib_unbound(identifier)
    assert not result, (
        f"Non-stdlib name '{identifier}' incorrectly reported as stdlib_unbound "
        f"with bound_names={set(bound_names)}"
    )


@_SETTINGS
@given(
    st.sampled_from(["math", "os", "sys", "json", "re", "collections", "itertools", 
                     "functools", "pathlib", "datetime", "sqrt", "defaultdict", 
                     "heappush", "reduce"])
)
def test_qualifier_stdlib_unbound_on_name_error_message(identifier: str) -> None:
    """Property: is_stdlib_unbound returns True for known stdlib names with empty import_bound."""
    # Create a mock stdlib function that returns True for our fixed set
    stdlib_members = {"math", "os", "sys", "json", "re", "collections", "itertools", 
                      "functools", "pathlib", "datetime", "sqrt", "defaultdict", 
                      "heappush", "reduce"}
    
    # Create EnrichContext with mock is_stdlib and empty source (no imports)
    ctx = EnrichContext(
        is_stdlib=lambda x: x in stdlib_members,
        candidate_modules=["test_module"],
        candidate_sources=["# No imports here\nx = 1"]
    )
    
    # All identifiers in the fixed set should be stdlib_unbound when not imported
    result = ctx.is_stdlib_unbound(identifier)
    assert result, f"stdlib name '{identifier}' should be stdlib_unbound when not imported"