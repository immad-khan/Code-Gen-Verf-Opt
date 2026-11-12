"""Unit tests for tivr.extract (Requirements 8.6, 11.3, 11.14)."""
import pytest

from tivr.extract import Extraction, extract


def test_single_python_block_splits_code_and_critique():
    r = "The bug is an off-by-one.\n```python\ndef f(x):\n    return x + 1\n```\nDone."
    ext = extract(r)
    assert ext == Extraction(
        code="def f(x):\n    return x + 1",
        critique="The bug is an off-by-one.\nDone.",
        had_code_block=True,
    )


def test_multiple_blocks_last_python_block_wins():
    r = ("First try:\n```python\ndef f():\n    return 1\n```\n"
         "Better:\n```py\ndef f():\n    return 2\n```\n"
         "Config:\n```json\n{\"a\": 1}\n```\n")
    ext = extract(r)
    assert ext.had_code_block
    assert ext.code == "def f():\n    return 2"
    # Only the extracted block is removed; earlier block and json block stay in critique.
    assert "return 1" in ext.critique
    assert '{"a": 1}' in ext.critique
    assert "return 2" not in ext.critique


@pytest.mark.parametrize("tag", ["", "python", "py", "python3", "Python", "python title=x"])
def test_accepted_tags(tag):
    ext = extract(f"```{tag}\nx = 1\n```")
    assert ext.had_code_block and ext.code == "x = 1" and ext.critique == ""


def test_non_python_fenced_block_ignored():
    r = "Here is data:\n```json\n{\"x\": 1}\n```\n"
    ext = extract(r)
    assert ext.had_code_block is False
    assert ext.code == r.strip()
    assert ext.critique == ""


def test_fence_inside_non_python_block_not_treated_as_code():
    r = "````markdown\n```python\nnot_code = 1\n```\n````\n"
    ext = extract(r)
    assert ext.had_code_block is False


def test_no_fence_full_stripped_text():
    r = "  \n def f():\n    return 3\n\n  "
    ext = extract(r)
    assert ext == Extraction(code=r.strip(), critique="", had_code_block=False)


def test_empty_response():
    assert extract("") == Extraction(code="", critique="", had_code_block=False)
    assert extract("   \n") == Extraction(code="", critique="", had_code_block=False)


def test_crlf_line_endings():
    r = "Critique line.\r\n```python\r\ndef f():\r\n    return 4\r\n```\r\nTail.\r\n"
    ext = extract(r)
    assert ext.had_code_block
    assert ext.code == "def f():\n    return 4"
    assert "\r" not in ext.code
    assert ext.critique.replace("\r\n", "\n") == "Critique line.\nTail."


def test_unterminated_fence_runs_to_end():
    r = "Fix below.\n```python\ndef f():\n    return 5\n"
    ext = extract(r)
    assert ext.had_code_block
    assert ext.code == "def f():\n    return 5"
    assert ext.critique == "Fix below."


def test_leading_indentation_of_code_preserved_and_blank_lines_trimmed():
    ext = extract("```python\n\n\ndef f():\n    pass\n\n\n```")
    assert ext.code == "def f():\n    pass"
