import React from 'react';
import type { RunListItem } from '../../api/types';
import { Badge, DataTable, FOCUS_RING, type DataTableColumn } from '../common';
import { maxIterations, runListCells } from '../../lib/format';
import { cn } from '../../utils/cn';
import { RunBadges } from './ExperimentsError';
import { FormattedValue } from './FormattedValue';
import { COMPARE_MAX, runStatusTone } from './experimentsModel';

export interface RunListProps {
  runs: ReadonlyArray<RunListItem>;
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  /** Run IDs selected for comparison, in selection order. */
  comparison: ReadonlyArray<string>;
  onToggleCompare: (runId: string) => void;
}

/**
 * Every run returned by the Experiments API with its configuration and RSR_i
 * per iteration (27.3), plus `mock`/`legacy` badges next to its metrics (27.4).
 */
export const RunList: React.FC<RunListProps> = ({ runs, selectedRunId, onSelectRun, comparison, onToggleCompare }) => {
  const iterations = maxIterations(runs);
  const cells = new Map(runs.map((r) => [r.runId, runListCells(r, iterations)]));
  const at = (run: RunListItem) => cells.get(run.runId)!;
  const full = comparison.length >= COMPARE_MAX;

  const text = (pick: (c: ReturnType<typeof runListCells>) => string) => (run: RunListItem) => (
    <FormattedValue text={pick(at(run))} />
  );

  const columns: DataTableColumn<RunListItem>[] = [
    {
      key: 'compare',
      header: 'Compare',
      cell: (run) => {
        const checked = comparison.includes(run.runId);
        return (
          <input
            type="checkbox"
            checked={checked}
            disabled={!checked && full}
            onChange={() => onToggleCompare(run.runId)}
            aria-label={`Compare run ${run.runId}`}
            className={cn('h-4 w-4 accent-indigo-700', FOCUS_RING)}
          />
        );
      },
    },
    {
      key: 'run',
      header: 'Run',
      rowHeader: true,
      cell: (run) => (
        <div className="flex flex-col items-start gap-1">
          <button
            type="button"
            onClick={() => onSelectRun(run.runId)}
            aria-pressed={selectedRunId === run.runId}
            aria-label={`View details of run ${run.runId}`}
            className={cn(
              'cursor-pointer rounded font-mono text-xs text-indigo-800 underline underline-offset-2 hover:text-indigo-950',
              selectedRunId === run.runId && 'font-bold',
              FOCUS_RING,
            )}
          >
            {run.runId}
          </button>
          <RunBadges llmMode={run.llmMode} provenance={run.provenance} />
        </div>
      ),
    },
    { key: 'status', header: 'Status', cell: (run) => <Badge tone={runStatusTone(run.status)}>{run.status}</Badge> },
    { key: 'mode', header: 'Repair mode', cell: text((c) => c.repairMode) },
    { key: 'regime', header: 'Feedback regime', cell: text((c) => c.feedbackRegime) },
    { key: 'k', header: 'k', align: 'right', cell: text((c) => c.k) },
    { key: 'model', header: 'Model', cell: text((c) => c.model) },
    { key: 'sample', header: 'Sample size', align: 'right', cell: text((c) => c.sampleSize) },
    { key: 'llm', header: 'llm_mode', cell: text((c) => c.llmMode) },
    { key: 'provenance', header: 'Provenance', cell: text((c) => c.provenance) },
  ];
  for (let i = 1; i <= iterations; i++) {
    columns.push({ key: `rsr${i}`, header: `RSR_${i}`, align: 'right', cell: text((c) => c.rsr[i - 1]) });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-slate-700">
        {`Select 2–${COMPARE_MAX} runs to compare (${comparison.length} selected).`}
      </p>
      <DataTable
        caption="Runs (newest first)"
        columns={columns}
        rows={runs}
        rowKey={(run) => run.runId}
        emptyMessage="No runs yet."
      />
    </div>
  );
};
