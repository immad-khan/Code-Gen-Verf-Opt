// Comparability warnings for the ablation table (27.7).
//
// Runs are only directly comparable when they share the dataset, the
// Generation_Cache, the repair-sample seed, and the Feedback_Regime. For each
// of those fields whose values are not all equal across the selected runs,
// one warning lists the value of every selected run.

import type { RunListItem } from '../api/types';
import { NOT_AVAILABLE } from './format';

export type ComparisonField = 'datasetSha256' | 'generationCacheSha256' | 'seed' | 'feedbackRegime';

export type ComparableRun = Pick<RunListItem, 'runId' | ComparisonField>;

/** Checked fields in display order, with their labels. */
export const COMPARISON_FIELDS: ReadonlyArray<{ field: ComparisonField; label: string }> = [
  { field: 'datasetSha256', label: 'Dataset SHA-256' },
  { field: 'generationCacheSha256', label: 'Generation cache' },
  { field: 'seed', label: 'Sample seed' },
  { field: 'feedbackRegime', label: 'Feedback regime' },
];

export interface ComparisonWarning {
  field: ComparisonField;
  label: string;
  /** One entry per selected run, in selection order; absent values are NOT_AVAILABLE. */
  values: { runId: string; value: string }[];
}

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  const text = String(value);
  return text.trim() === '' ? NOT_AVAILABLE : text;
}

/** One warning per field whose values differ across `runs`; none when all agree (or fewer than 2 runs). */
export function comparisonWarnings(runs: ReadonlyArray<ComparableRun>): ComparisonWarning[] {
  if (runs.length < 2) return [];
  const warnings: ComparisonWarning[] = [];
  for (const { field, label } of COMPARISON_FIELDS) {
    const values = runs.map((run) => ({ runId: run.runId, value: displayValue(run[field]) }));
    if (new Set(values.map((v) => v.value)).size > 1) warnings.push({ field, label, values });
  }
  return warnings;
}

/** Sentence for a warning, e.g. "Sample seed differs: run-a = 0; run-b = 1". */
export function comparisonWarningText(warning: ComparisonWarning): string {
  return `${warning.label} differs: ${warning.values.map((v) => `${v.runId} = ${v.value}`).join('; ')}`;
}
