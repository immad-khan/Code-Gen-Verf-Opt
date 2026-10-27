"""Property-based tests for code/critique extraction.

Property 23: Extraction splits critique and code losslessly.
Validates: Requirements 8.6, 11.3, 11.14, 18.6

Feature: paper-aligned-repair-tool, Property 23
"""
from __future__ import annotations

import re
from hypothesis import given, settings, assume
import hypothesis.strategies as st

from tivr.extract import extract, Extraction, PYTHON_TAGS

_SETTINGS = settings(max_examples=100)


def _trim_code(body: list[str]) -> str:
    """Reimplementation of extract._trim_code for property verification."""
    while body and not body[0].strip():
        body = body[1:]
    return "\n".join(body).rstrip()


@_SETTINGS
@given(st.text(alphabet=st.characters(blacklist_characters='`'), min_size=0, max_size=500))
def test_extraction_no_code_block_returns_full_stripped_text(text: str) -> None:
    """Property: ext.had_code_block is False, ext.code == text.strip(), ext.critique == ''."""
    ext = extract(text)
    
    assert not ext.had_code_block, f"Expected no code block for text without backticks"
    assert ext.code == text.strip(), f"Code mismatch: got '{ext.code}', expected '{text.strip()}'"
    assert ext.critique == '', f"Critique should be empty but got '{ext.critique}'"


@_SETTINGS
@given(
    st.text(min_size=0, max_size=300),
    st.sampled_from(sorted(PYTHON_TAGS)),
    st.text(min_size=0, max_size=100),
    st.text(min_size=0, max_size=100)
)
def test_extraction_code_block_content_preserved(body: str, tag: str, prefix: str, suffix: str) -> None:
    """Property: ext.had_code_block is True, code equals trimmed body."""
    # Ensure body doesn't contain lines that look like closing fences
    assume(not any(re.fullmatch(r'\s*`{3,}\s*', line) for line in body.splitlines()))
    
    # Construct response with code block
    response = f"{prefix}\n```{tag}\n{body}\n```\n{suffix}"
    ext = extract(response)
    
    assert ext.had_code_block, f"Expected code block for Python tag '{tag}'"
    
    # Calculate expected code using same logic as _trim_code
    body_lines = body.splitlines()
    while body_lines and not body_lines[0].strip():
        body_lines = body_lines[1:]
    expected_code = "\n".join(body_lines).rstrip()
    
    assert ext.code == expected_code, (
        f"Code mismatch: got '{ext.code}', expected '{expected_code}'"
    )


@_SETTINGS
@given(st.text(alphabet=st.characters(blacklist_characters='`'), min_size=0, max_size=500))
def test_extraction_is_lossless_no_code_block(response: str) -> None:
    """Property: code + critique reconstructs no information beyond stripping."""
    ext = extract(response)
    
    assert ext.critique == '', f"Critique should be empty but got '{ext.critique}'"
    assert ext.code == response.strip(), f"Code mismatch: got '{ext.code}', expected '{response.strip()}'"
    
    # For no code block, the original response (stripped) should equal the code
    reconstructed = ext.code
    assert reconstructed == response.strip(), (
        f"Reconstruction failed: got '{reconstructed}', expected '{response.strip()}'"
    )


@_SETTINGS
@given(
    st.text(min_size=0, max_size=200),
    st.sampled_from(sorted(PYTHON_TAGS)),
    st.text(min_size=0, max_size=100),
    st.text(min_size=0, max_size=100),
    st.text(min_size=0, max_size=100)
)
def test_extraction_with_code_block_critique_contains_no_code(body: str, tag: str, 
                                                               prefix: str, suffix: str,
                                                               extra_prefix: str) -> None:
    """Property: the extracted code is NOT in ext.critique (unless body is empty)."""
    # Ensure body doesn't contain lines that look like closing fences
    assume(not any(re.fullmatch(r'\s*`{3,}\s*', line) for line in body.splitlines()))
    
    # Skip if body is empty (edge case)
    assume(body.strip() != "")
    # Skip if body appears in prefix or suffix (code would appear in critique)
    assume(body not in prefix)
    assume(body not in suffix)
    # Skip if body appears in prefix or suffix (code would appear in critique)
    assume(body not in prefix)
    assume(body not in suffix)
    
    # Construct response with code block and critique
    response = f"{prefix}\n```{tag}\n{body}\n```\n{suffix}"
    ext = extract(response)
    
    assert ext.had_code_block, f"Expected code block for Python tag '{tag}'"
    
    # The code should not appear in the critique
    assert ext.code not in ext.critique, (
        f"Code '{ext.code}' should not appear in critique '{ext.critique}'"
    )
    
    # Also ensure the exact body (trimmed) is not in critique
    body_lines = body.splitlines()
    while body_lines and not body_lines[0].strip():
        body_lines = body_lines[1:]
    trimmed_body = "\n".join(body_lines).rstrip()
    
    if trimmed_body:  # Only check if body is non-empty after trimming
        assert trimmed_body not in ext.critique, (
            f"Trimmed body should not appear in critique"
        )


@_SETTINGS
@given(
    st.booleans(),
    st.text(min_size=0, max_size=200),
    st.text(min_size=0, max_size=100),
    st.text(min_size=0, max_size=100)
)
def test_extraction_had_code_block_iff_python_fence_present(had_fence: bool, body: str, 
                                                             prefix: str, suffix: str) -> None:
    """Property: ext.had_code_block == had_fence."""
    # Ensure body doesn't contain lines that look like closing fences
    assume(not any(re.fullmatch(r'\s*`{3,}\s*', line) for line in body.splitlines()))
    
    if had_fence:
        # Use a known Python tag
        response = f"{prefix}\n```python\n{body}\n```\n{suffix}"
    else:
        # No backticks at all
        response = f"{prefix}\n{body}\n{suffix}"
        assume('```' not in response)
    
    ext = extract(response)
    
    assert ext.had_code_block == had_fence, (
        f"Expected had_code_block={had_fence} but got {ext.had_code_block} "
        f"for response: {response[:100]}..."
    )


@_SETTINGS
@given(
    st.text(min_size=0, max_size=200),
    st.sampled_from(["json", "text", "bash", "sh", "xml", "yaml", "toml"])
)
def test_extraction_non_python_fence_counts_as_no_code_block(body: str, tag: str) -> None:
    """Property: ext.had_code_block is False for non-Python fences."""
    # Ensure body doesn't contain lines that look like closing fences
    assume(not any(re.fullmatch(r'\s*`{3,}\s*', line) for line in body.splitlines()))
    
    response = f"```{tag}\n{body}\n```"
    ext = extract(response)
    
    assert not ext.had_code_block, f"Non-Python tag '{tag}' should not create code block"
    assert ext.code == response.strip(), (
        f"Code should be full response for non-Python fence, got '{ext.code}'"
    )
    assert ext.critique == '', f"Critique should be empty for non-Python fence"


@_SETTINGS
@given(
    st.lists(
        st.text(min_size=1, max_size=100).filter(
            lambda x: not any(re.fullmatch(r'\s*`{3,}\s*', line) for line in x.splitlines())
        ),
        min_size=2,
        max_size=5
    ),
    st.lists(
        st.text(min_size=0, max_size=50).filter(lambda x: '```' not in x),
        min_size=1,
        max_size=4
    )
)
def test_extraction_last_python_block_is_extracted(bodies: list[str], separators: list[str]) -> None:
    """Property: the extracted code matches the LAST Python block's trimmed body."""
    # Build response with multiple Python blocks separated by plain text
    response_parts = []
    
    for i, body in enumerate(bodies):
        response_parts.append(f"```python\n{body}\n```")
        if i < len(separators):
            response_parts.append(separators[i])
    
    response = "\n".join(response_parts)
    ext = extract(response)
    
    assert ext.had_code_block, "Should have code block with Python fences"
    
    # Get the last body and trim it
    last_body = bodies[-1]
    last_body_lines = last_body.splitlines()
    while last_body_lines and not last_body_lines[0].strip():
        last_body_lines = last_body_lines[1:]
    expected_code = "\n".join(last_body_lines).rstrip()
    
    assert ext.code == expected_code, (
        f"Expected code from last block: '{expected_code}', got: '{ext.code}'"
    )

