import { describe, expect, it } from 'vitest';
import { computeLineDiff, splitLines } from './diff';

describe('computeLineDiff', () => {
  it('reports identical texts as unchanged', () => {
    const result = computeLineDiff('a\nb', 'a\nb');
    expect(result).toMatchObject({ additions: 0, deletions: 0, isModified: false });
    expect(result.lines.map((l) => l.type)).toEqual(['unchanged', 'unchanged']);
  });

  it('treats whitespace-only changes as changes (no trim shortcut)', () => {
    const indent = computeLineDiff('def f():\n  return 1', 'def f():\n    return 1');
    expect(indent.isModified).toBe(true);
    expect(indent.lines).toEqual([
      { type: 'unchanged', text: 'def f():', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'removed', text: '  return 1', oldLineNumber: 2 },
      { type: 'added', text: '    return 1', newLineNumber: 2 },
    ]);

    const trailing = computeLineDiff('x = 1', 'x = 1\n');
    expect(trailing).toMatchObject({ isModified: true, additions: 1, deletions: 0 });

    const leading = computeLineDiff('x', ' x');
    expect(leading).toMatchObject({ isModified: true, additions: 1, deletions: 1 });
  });

  it('reconstructs both sides in order from unchanged plus removed/added lines', () => {
    const before = 'a\nb\nc\nd';
    const after = 'a\nx\nc\nd\ne';
    const { lines, additions, deletions } = computeLineDiff(before, after);
    const oldSide = lines.filter((l) => l.type !== 'added').map((l) => l.text);
    const newSide = lines.filter((l) => l.type !== 'removed').map((l) => l.text);
    expect(oldSide.join('\n')).toBe(before);
    expect(newSide.join('\n')).toBe(after);
    expect({ additions, deletions }).toEqual({ additions: 2, deletions: 1 });
  });

  it('handles empty texts', () => {
    expect(computeLineDiff('', '')).toEqual({ lines: [], additions: 0, deletions: 0, isModified: false });
    expect(computeLineDiff('', 'a\nb')).toMatchObject({ additions: 2, deletions: 0, isModified: true });
    expect(computeLineDiff('a', '')).toMatchObject({ additions: 0, deletions: 1, isModified: true });
    expect(splitLines('')).toEqual([]);
    expect(splitLines('\n')).toEqual(['', '']);
  });
});
