import { describe, expect, it } from 'vitest';
import {
  NOT_AVAILABLE,
  ablationCells,
  formatCount,
  formatPercent,
  formatRate,
  formatRsr,
  maxIterations,
  roundHalfUp1,
  runListCells,
} from './format';
import { NOT_AVAILABLE_TEXT } from '../components/common/NotAvailable';
import { PAPER_REFERENCE_SOURCE, PAPER_REFERENCE_VALUES } from './paperReference';

describe('formatRate', () => {
  it('rounds half-up to one decimal from the counts (29/120 → 24.2%)', () => {
    expect(formatRate({ num: 29, den: 120, pct: 24.2 })).toBe('24.2%');
    expect(formatRate({ num: 35, den: 120, pct: 29.2 })).toBe('29.2%');
    expect(formatRate({ num: 6, den: 91, pct: 6.6 })).toBe('6.6%');
    // 1/8 = 12.5 exactly; 1/16 = 6.25 → 6.3 (half-up, not banker's)
    expect(formatRate({ num: 1, den: 16, pct: null })).toBe('6.3%');
    expect(formatRate({ num: 0, den: 5, pct: 0 })).toBe('0.0%');
  });

  it('appends counts on request', () => {
    expect(formatRate({ num: 29, den: 120, pct: 24.2 }, { withCounts: true })).toBe('24.2% (29/120)');
  });

  it('is "not available" for absent rates and zero denominators, never 0', () => {
    expect(formatRate(null)).toBe(NOT_AVAILABLE);
    expect(formatRate(undefined)).toBe(NOT_AVAILABLE);
    expect(formatRate({ num: 0, den: 0, pct: null })).toBe(NOT_AVAILABLE);
    expect(formatRate({ num: 0, den: 0, pct: null }, { withCounts: true })).toBe(NOT_AVAILABLE);
    expect(formatRate({ pct: null })).toBe(NOT_AVAILABLE);
  });

  it('falls back to pct when counts are missing', () => {
    expect(formatRate({ pct: 24.15 })).toBe('24.2%');
  });

  it('shares the placeholder text with the NotAvailable component', () => {
    expect(NOT_AVAILABLE).toBe(NOT_AVAILABLE_TEXT);
  });
});

describe('number formatters', () => {
  it('roundHalfUp1 rounds halves away from zero', () => {
    expect(roundHalfUp1(24.15)).toBe(24.2);
    expect(roundHalfUp1(0.05)).toBe(0.1);
    expect(roundHalfUp1(29.166666)).toBe(29.2);
  });

  it('formatPercent and formatCount show the placeholder for missing values only', () => {
    expect(formatPercent(23.3)).toBe('23.3%');
    expect(formatPercent(null)).toBe(NOT_AVAILABLE);
    expect(formatPercent(Number.NaN)).toBe(NOT_AVAILABLE);
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe(NOT_AVAILABLE);
  });
});

describe('RSR cells', () => {
  const rsr = [
    { iteration: 1, num: 29, den: 120, pct: 24.2 },
    { iteration: 2, num: 35, den: 120, pct: 29.2 },
  ];

  it('formats RSR_i and hides RSR_2 when k < 2', () => {
    expect(formatRsr(rsr, 2, 1)).toBe('24.2%');
    expect(formatRsr(rsr, 2, 2)).toBe('29.2%');
    expect(formatRsr(rsr, 1, 2)).toBe(NOT_AVAILABLE);
    expect(ablationCells({ k: 1, rsr: [rsr[0]] })).toEqual({ rsr1: '24.2%', rsr2: NOT_AVAILABLE });
  });

  it('shows "not available" for every missing run-list field (legacy run without summary)', () => {
    const cells = runListCells({ provenance: 'legacy', status: 'completed', rsr: null, k: null }, 2);
    expect(cells.provenance).toBe('legacy');
    for (const text of [cells.repairMode, cells.feedbackRegime, cells.k, cells.model, cells.sampleSize, cells.llmMode, ...cells.rsr]) {
      expect(text).toBe(NOT_AVAILABLE);
    }
  });

  it('maxIterations covers the largest k or reported iteration', () => {
    expect(maxIterations([])).toBe(1);
    expect(maxIterations([{ k: 3, rsr: null }, { k: null, rsr: rsr }])).toBe(3);
  });
});

describe('paper reference values', () => {
  it('match Dou et al. Table 6 (GPT-4)', () => {
    expect(PAPER_REFERENCE_SOURCE).toMatch(/Dou et al\..*GPT-4/);
    expect(PAPER_REFERENCE_VALUES.map((p) => [p.method, p.rsr1, p.rsr2])).toEqual([
      ['Self-debug', 23.3, 27.5],
      ['Intervenor', 22.5, 28.3],
      ['Ours', 24.1, 29.2],
      ['w/o BT', 21.7, 27.5],
      ['Ours + Intervenor', 25.8, 29.2],
    ]);
  });
});
