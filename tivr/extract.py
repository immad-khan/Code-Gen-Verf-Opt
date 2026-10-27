"""Code / critique extraction from LLM responses (Requirements 8.6, 11.3, 11.14).

``extract(response)`` returns the content of the *last* fenced code block whose info
string is empty or one of ``python``, ``py``, ``python3`` (case-insensitive) as the
candidate code, and the rest of the response (that block, fences included, removed)
as the critique. Fenced blocks with other tags (```json, ```text, ...) are skipped as
whole blocks, so fences nested inside them are never mistaken for code.

Without a Python fenced block the full stripped response is the code, the critique is
empty, and ``had_code_block`` is False (11.14); the verifier front stage then decides
whether that text is ``no_code_output`` (8.6).

Fence rules (CommonMark-like, deliberately small):
* an opening fence is a line whose stripped form starts with 3+ backticks; the rest of
  the line is the info string, whose first word is the tag;
* a closing fence is a line consisting only of backticks, at least as many as the
  opening fence, plus surrounding whitespace;
* an unterminated fence runs to the end of the response (truncated LLM output).

CRLF / CR line endings are accepted; extracted code always uses ``\\n``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

PYTHON_TAGS = frozenset({"", "python", "py", "python3"})

_OPEN_RE = re.compile(r"^\s*(`{3,})(.*)$")
_CLOSE_RE = re.compile(r"^\s*(`{3,})\s*$")


@dataclass(frozen=True)
class Extraction:
    code: str            # last Python fenced block content, or the full stripped text
    critique: str        # response without the extracted block (fences included), stripped
    had_code_block: bool


@dataclass(frozen=True)
class _Block:
    start: int           # index of the opening-fence line
    end: int             # index one past the closing-fence line (or len(lines))
    tag: str
    body: list[str]      # content lines, line endings removed


def _strip_eol(line: str) -> str:
    """Remove trailing line break characters recognized by str.splitlines().
    
    This includes: \n, \r, \r\n, \v, \f, \x1c, \x1d, \x1e, \x85, \u2028, \u2029.
    """
    # Check for common line endings first for efficiency
    if line.endswith("\r\n"):
        return line[:-2]
    if line.endswith("\n"):
        return line[:-1]
    if line.endswith("\r"):
        return line[:-1]
    
    # Check for other Unicode line break characters
    # Using rstrip with the full set of line break characters
    line_breaks = "\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029"
    return line.rstrip(line_breaks)


def _scan_blocks(lines: list[str]) -> list[_Block]:
    blocks: list[_Block] = []
    i, n = 0, len(lines)
    while i < n:
        m = _OPEN_RE.match(_strip_eol(lines[i]))
        if not m:
            i += 1
            continue
        ticks, info = len(m.group(1)), m.group(2).strip()
        tag = info.split()[0].lower() if info else ""
        body: list[str] = []
        j = i + 1
        while j < n:
            c = _CLOSE_RE.match(_strip_eol(lines[j]))
            if c and len(c.group(1)) >= ticks:
                break
            body.append(_strip_eol(lines[j]))
            j += 1
        end = j + 1 if j < n else n
        blocks.append(_Block(i, end, tag, body))
        i = end
    return blocks


def _trim_code(body: list[str]) -> str:
    """Drop leading/trailing blank lines and trailing whitespace; keep first-line indent."""
    while body and not body[0].strip():
        body = body[1:]
    return "\n".join(body).rstrip()


def extract(response: str) -> Extraction:
    text = response or ""
    lines = text.splitlines(keepends=True)
    python_blocks = [b for b in _scan_blocks(lines) if b.tag in PYTHON_TAGS]
    if not python_blocks:
        return Extraction(code=text.strip(), critique="", had_code_block=False)
    last = python_blocks[-1]
    critique = "".join(lines[: last.start] + lines[last.end:]).strip()
    return Extraction(code=_trim_code(last.body), critique=critique, had_code_block=True)
