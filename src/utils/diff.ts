export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  isModified: boolean;
}

/** Splits text into lines; the empty string has no lines. */
export function splitLines(text: string): string[] {
  return text === '' ? [] : text.split('\n');
}

/**
 * Computes a line-by-line diff using standard Longest Common Subsequence (LCS).
 *
 * Lines are compared exactly (whitespace and trailing newlines are
 * significant), so `isModified` is false iff `oldText === newText` (26.6).
 * Unchanged plus removed lines reproduce the old text in order, and unchanged
 * plus added lines reproduce the new text in order (26.5).
 */
export function computeLineDiff(oldText: string, newText: string): DiffResult {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldText === newText) {
    return {
      lines: newLines.map((text, idx) => ({
        type: 'unchanged',
        text,
        oldLineNumber: idx + 1,
        newLineNumber: idx + 1,
      })),
      additions: 0,
      deletions: 0,
      isModified: false,
    };
  }

  // Compute LCS matrix
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  const diff: DiffLine[] = [];
  let i = m;
  let j = n;
  let additions = 0;
  let deletions = 0;

  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({
        type: 'unchanged',
        text: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({
        type: 'added',
        text: newLines[j - 1],
        newLineNumber: j,
      });
      additions++;
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      stack.push({
        type: 'removed',
        text: oldLines[i - 1],
        oldLineNumber: i,
      });
      deletions++;
      i--;
    }
  }

  while (stack.length > 0) {
    diff.push(stack.pop()!);
  }

  return {
    lines: diff,
    additions,
    deletions,
    isModified: additions > 0 || deletions > 0,
  };
}
