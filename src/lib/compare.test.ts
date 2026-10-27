import { describe, expect, it } from 'vitest';
import { comparisonWarningText, comparisonWarnings, type ComparableRun } from './compare';
import { NOT_AVAILABLE } from './format';

const base: ComparableRun = {
  runId: 'run-a',
  datasetSha256: 'aaa',
  generationCacheSha256: 'ccc',
  seed: 0,
  feedbackRegime: 'dou',
};

describe('comparisonWarnings', () => {
  it('returns nothing when all fields agree or fewer than two runs are given', () => {
    expect(comparisonWarnings([base, { ...base, runId: 'run-b' }])).toEqual([]);
    expect(comparisonWarnings([base])).toEqual([]);
  });

  it('names each differing field with every run value', () => {
    const warnings = comparisonWarnings([
      base,
      { ...base, runId: 'run-b', seed: 1, feedbackRegime: 'strict' },
      { ...base, runId: 'run-c' },
    ]);
    expect(warnings.map((w) => w.field)).toEqual(['seed', 'feedbackRegime']);
    expect(warnings[0].values).toEqual([
      { runId: 'run-a', value: '0' },
      { runId: 'run-b', value: '1' },
      { runId: 'run-c', value: '0' },
    ]);
    expect(comparisonWarningText(warnings[1])).toBe('Feedback regime differs: run-a = dou; run-b = strict; run-c = dou');
  });

  it('treats a missing value as different from a present one', () => {
    const warnings = comparisonWarnings([base, { ...base, runId: 'run-b', generationCacheSha256: null }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].label).toBe('Generation cache');
    expect(warnings[0].values[1].value).toBe(NOT_AVAILABLE);
  });

  it('flags a differing dataset SHA-256', () => {
    const warnings = comparisonWarnings([base, { ...base, runId: 'run-b', datasetSha256: 'bbb' }]);
    expect(warnings.map((w) => w.label)).toEqual(['Dataset SHA-256']);
  });
});
