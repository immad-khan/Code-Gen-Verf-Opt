import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { RunListItem } from '../../api/types';
import { DataTable, type DataTableColumn } from '../common';
import { comparisonWarnings } from '../../lib/compare';
import { ablationCells, formatCount, formatPercent, formatText } from '../../lib/format';
import { PAPER_REFERENCE_SOURCE, PAPER_REFERENCE_VALUES } from '../../lib/paperReference';
import { RunBadges } from './ExperimentsError';
import { FormattedValue } from './FormattedValue';
import { COMPARE_MAX, COMPARE_MIN } from './experimentsModel';

type AblationRow =
  | { kind: 'run'; run: RunListItem; rsr1: string; rsr2: string }
  | { kind: 'paper'; method: string; rsr1: string; rsr2: string };

/** Ablation rows: each selected run, then the five Paper_Reference_Values rows (27.6). */
export function ablationRows(runs: ReadonlyArray<RunListItem>): AblationRow[] {
  return [
    ...runs.map((run): AblationRow => ({ kind: 'run', run, ...ablationCells(run) })),
    ...PAPER_REFERENCE_VALUES.map(
      (p): AblationRow => ({ kind: 'paper', method: p.method, rsr1: formatPercent(p.rsr1), rsr2: formatPercent(p.rsr2) }),
    ),
  ];
}

export interface AblationTableProps {
  /** Runs selected for comparison, in selection order. */
  runs: ReadonlyArray<RunListItem>;
}

/**
 * Ablation comparison of 2–10 runs: RSR_1 and RSR_2 with one decimal, RSR_2
 * "not available" for k < 2, plus the paper's GPT-4 values in separately
 * labelled rows (27.6). Comparability warnings appear above the table (27.7).
 */
export const AblationTable: React.FC<AblationTableProps> = ({ runs }) => {
  if (runs.length < COMPARE_MIN || runs.length > COMPARE_MAX) {
    return (
      <p className="text-sm text-slate-800">
        {`Select between ${COMPARE_MIN} and ${COMPARE_MAX} runs in the run list to compare them (${runs.length} selected).`}
      </p>
    );
  }
  const warnings = comparisonWarnings(runs);
  const rows = ablationRows(runs);
  const columns: DataTableColumn<AblationRow>[] = [
    {
      key: 'source',
      header: 'Run or method',
      rowHeader: true,
      cell: (row) =>
        row.kind === 'run' ? (
          <span className="flex flex-col items-start gap-1">
            <span className="font-mono text-xs break-all">{row.run.runId}</span>
            <RunBadges llmMode={row.run.llmMode} provenance={row.run.provenance} />
          </span>
        ) : (
          <span className="flex flex-col items-start">
            <span>{row.method}</span>
            <span className="text-xs font-normal text-slate-700">{PAPER_REFERENCE_SOURCE}</span>
          </span>
        ),
    },
    {
      key: 'mode',
      header: 'Repair mode',
      cell: (row) => (row.kind === 'run' ? <FormattedValue text={formatText(row.run.repairMode)} /> : '—'),
    },
    {
      key: 'regime',
      header: 'Feedback regime',
      cell: (row) => (row.kind === 'run' ? <FormattedValue text={formatText(row.run.feedbackRegime)} /> : '—'),
    },
    {
      key: 'k',
      header: 'k',
      align: 'right',
      cell: (row) => (row.kind === 'run' ? <FormattedValue text={formatCount(row.run.k)} /> : '2'),
    },
    { key: 'rsr1', header: 'RSR_1', align: 'right', cell: (row) => <FormattedValue text={row.rsr1} /> },
    {
      key: 'rsr2',
      header: 'RSR_2',
      align: 'right',
      cell: (row) => (
        <FormattedValue
          text={row.rsr2}
          reason={row.kind === 'run' && row.run.k != null && row.run.k < 2 ? 'RSR_2 needs k ≥ 2' : undefined}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-700 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle aria-hidden="true" focusable="false" className="h-4 w-4" />
            <span>These runs are not directly comparable</span>
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {warnings.map((w) => (
              <li key={w.field}>
                <span className="font-semibold">{`${w.label} differs:`}</span>
                <ul className="mt-1 list-disc pl-5">
                  {w.values.map((v) => (
                    <li key={v.runId} className="break-all">
                      <span className="font-mono text-xs">{v.runId}</span>
                      {': '}
                      <FormattedValue text={v.value} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <DataTable
        caption="Ablation comparison: repair success rate after iteration 1 and 2 (%)"
        columns={columns}
        rows={rows}
        rowKey={(row, i) => (row.kind === 'run' ? `run:${row.run.runId}` : `paper:${i}`)}
      />
    </div>
  );
};
