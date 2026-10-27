// Formatting for Experiments metrics (27.3, 27.5, 27.6).
//
// Every formatter returns the NOT_AVAILABLE placeholder for an absent value
// (null, undefined, non-finite, or a rate with a zero denominator) and never
// "0" or "0.0%". Percentages use one decimal place, rounded half-up, matching
// the TIVR metrics module (e.g. 29/120 → "24.2%").

import type { Rate, RateWithIteration, RunListItem } from '../api/types';

/** Placeholder for absent values. Same text as the `NotAvailable` component. */
export const NOT_AVAILABLE = 'not available';

export type Maybe<T> = T | null | undefined;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

/** Rounds to one decimal place, half away from zero, tolerating binary noise (24.15 → 24.2). */
export function roundHalfUp1(value: number): number {
  const scaled = Math.abs(value) * 10;
  const rounded = Math.floor(scaled + 0.5 + 1e-9) / 10;
  return value < 0 ? -rounded : rounded;
}

/** Exact half-up percentage of num/den with one decimal, using integer arithmetic. */
function exactPct(num: number, den: number): number {
  // tenths = round_half_up(1000·num/den) = floor((2000·num + den) / (2·den))
  return Math.floor((2000 * num + den) / (2 * den)) / 10;
}

/** "24.2%" for a percentage value; NOT_AVAILABLE when absent. */
export function formatPercent(pct: Maybe<number>): string {
  if (!isFiniteNumber(pct)) return NOT_AVAILABLE;
  return `${roundHalfUp1(pct).toFixed(1)}%`;
}

/** Percentage of a rate object, or null when the rate is absent or has a zero denominator. */
export function ratePercent(rate: Maybe<Partial<Rate>>): number | null {
  if (rate == null) return null;
  const { num, den, pct } = rate;
  if (isCount(num) && isCount(den)) return den === 0 ? null : exactPct(num, den);
  return isFiniteNumber(pct) ? roundHalfUp1(pct) : null;
}

export interface FormatRateOptions {
  /** Append "(num/den)" when the counts are known. */
  withCounts?: boolean;
}

/**
 * Formats a Run_Summary rate object: "24.2%" or "24.2% (29/120)".
 * Absent rates and rates with `den == 0` render as NOT_AVAILABLE.
 */
export function formatRate(rate: Maybe<Partial<Rate>>, options: FormatRateOptions = {}): string {
  const pct = ratePercent(rate);
  if (pct === null) return NOT_AVAILABLE;
  const text = `${pct.toFixed(1)}%`;
  if (options.withCounts && rate && isCount(rate.num) && isCount(rate.den)) {
    return `${text} (${rate.num}/${rate.den})`;
  }
  return text;
}

/** Formats a count or other integer; NOT_AVAILABLE when absent. */
export function formatCount(value: Maybe<number>): string {
  return isFiniteNumber(value) ? String(value) : NOT_AVAILABLE;
}

/** Formats a number with a fixed number of decimals; NOT_AVAILABLE when absent. */
export function formatNumber(value: Maybe<number>, decimals = 1): string {
  return isFiniteNumber(value) ? value.toFixed(decimals) : NOT_AVAILABLE;
}

/** Formats a text value; NOT_AVAILABLE when absent or blank. */
export function formatText(value: Maybe<string>): string {
  return typeof value === 'string' && value.trim() !== '' ? value : NOT_AVAILABLE;
}

/** True when a formatted cell is the placeholder. */
export function isNotAvailable(text: string): boolean {
  return text === NOT_AVAILABLE;
}

/** Finds the rate for an iteration in an RSR or conditional-rate list. */
export function rateAt(rates: Maybe<ReadonlyArray<RateWithIteration>>, iteration: number): RateWithIteration | null {
  if (!rates) return null;
  return rates.find((r) => r.iteration === iteration) ?? null;
}

/**
 * RSR_i cell: NOT_AVAILABLE when the run's k is below i (e.g. RSR_2 with k = 1),
 * when the run has no RSR list, or when iteration i is missing from it (27.3, 27.6).
 */
export function formatRsr(
  rsr: Maybe<ReadonlyArray<RateWithIteration>>,
  k: Maybe<number>,
  iteration: number,
): string {
  if (isFiniteNumber(k) && k < iteration) return NOT_AVAILABLE;
  return formatRate(rateAt(rsr, iteration));
}

/** Largest iteration index to show RSR columns for, over a set of runs (at least 1). */
export function maxIterations(runs: ReadonlyArray<{ k: Maybe<number>; rsr: Maybe<ReadonlyArray<RateWithIteration>> }>): number {
  let max = 1;
  for (const run of runs) {
    if (isFiniteNumber(run.k)) max = Math.max(max, run.k);
    for (const r of run.rsr ?? []) if (isFiniteNumber(r.iteration)) max = Math.max(max, r.iteration);
  }
  return max;
}

// ─────────────────────────────────────────────────────────────
// Row formatters (run list, ablation table)
// ─────────────────────────────────────────────────────────────

/** A run-list record whose fields may be missing (legacy runs, runs without a summary). */
export type RunRecordLike = Partial<
  Pick<
    RunListItem,
    'repairMode' | 'feedbackRegime' | 'k' | 'model' | 'sampleSize' | 'llmMode' | 'provenance' | 'status' | 'rsr'
  >
>;

export interface RunListCells {
  status: string;
  repairMode: string;
  feedbackRegime: string;
  k: string;
  model: string;
  sampleSize: string;
  llmMode: string;
  provenance: string;
  /** RSR_1..RSR_n, one entry per iteration column. */
  rsr: string[];
}

/** Display text for every run-list column (27.3). */
export function runListCells(run: RunRecordLike, iterations: number): RunListCells {
  const rsr: string[] = [];
  for (let i = 1; i <= iterations; i++) rsr.push(formatRsr(run.rsr, run.k, i));
  return {
    status: formatText(run.status),
    repairMode: formatText(run.repairMode),
    feedbackRegime: formatText(run.feedbackRegime),
    k: formatCount(run.k),
    model: formatText(run.model),
    sampleSize: formatCount(run.sampleSize),
    llmMode: formatText(run.llmMode),
    provenance: formatText(run.provenance),
    rsr,
  };
}

/** RSR_1 and RSR_2 for the ablation table; RSR_2 is NOT_AVAILABLE when k < 2 (27.6). */
export function ablationCells(run: RunRecordLike): { rsr1: string; rsr2: string } {
  return { rsr1: formatRsr(run.rsr, run.k, 1), rsr2: formatRsr(run.rsr, run.k, 2) };
}
