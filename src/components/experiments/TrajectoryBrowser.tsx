import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { experiments } from '../../api/endpoints';
import type { TrajectoryEntry, TrajectoryPage } from '../../api/types';
import { computeLineDiff } from '../../utils/diff';
import { Badge, FOCUS_RING, LoadingState } from '../common';
import { cn } from '../../utils/cn';
import { ExperimentsError } from './ExperimentsError';
import { TRAJECTORY_PAGE_SIZE, pageCount } from './experimentsModel';
import { useApiResource } from './useApiResource';

const PRE = cn(
  'max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs text-slate-900',
  FOCUS_RING,
);

/** Line diff of the candidate before and after an iteration, with text prefixes and hidden labels. */
export const CodeDiff: React.FC<{ before: string; after: string; label: string }> = ({ before, after, label }) => {
  const diff = computeLineDiff(before ?? '', after ?? '');
  if (!diff.isModified) return <p className="text-sm text-slate-700">No changes.</p>;
  return (
    <div>
      <p className="mb-1 text-xs text-slate-700">{`${diff.additions} added, ${diff.deletions} removed`}</p>
      <pre tabIndex={0} aria-label={label} className={cn(PRE, 'whitespace-pre')}>
        {diff.lines.map((line, i) => {
          const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' ';
          const tone =
            line.type === 'added'
              ? 'bg-emerald-50 text-emerald-950'
              : line.type === 'removed'
                ? 'bg-rose-50 text-rose-950'
                : '';
          return (
            <div key={i} className={tone}>
              {line.type !== 'unchanged' ? <span className="sr-only">{`${line.type}: `}</span> : null}
              <span aria-hidden="true">{`${prefix} `}</span>
              {line.text}
            </div>
          );
        })}
      </pre>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <details className="rounded-md border border-slate-200">
    <summary className={cn('cursor-pointer px-3 py-1.5 text-sm font-medium text-slate-800', FOCUS_RING)}>{title}</summary>
    <div className="px-3 pb-3">{children}</div>
  </details>
);

export const TrajectoryEntryView: React.FC<{ entry: TrajectoryEntry }> = ({ entry }) => {
  const heading = `${entry.task_id} · iteration ${entry.iteration}`;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-slate-300 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="font-mono text-sm font-semibold text-slate-900">{heading}</h5>
        <span className="text-sm text-slate-800">
          {`Primary_State: ${entry.primary_state_before} → `}
          <strong>{entry.primary_state}</strong>
        </span>
        {entry.llm_mode === 'mock' ? <Badge tone="warning">mock</Badge> : null}
        {!entry.had_code_block ? <Badge tone="neutral">no code block</Badge> : null}
      </div>
      <Section title="Prompt">
        <pre tabIndex={0} aria-label={`Prompt, ${heading}`} className={PRE}>
          {entry.prompt}
        </pre>
      </Section>
      <Section title="Raw LLM response">
        <pre tabIndex={0} aria-label={`Raw LLM response, ${heading}`} className={PRE}>
          {entry.raw_response}
        </pre>
      </Section>
      <Section title="Code diff (before → after)">
        <CodeDiff before={entry.code_before} after={entry.extracted_code} label={`Code diff, ${heading}`} />
      </Section>
    </li>
  );
};

export interface TrajectoryPageViewProps {
  data: TrajectoryPage;
  page: number;
  onPage: (page: number) => void;
  loading: boolean;
}

/** One page of at most 50 trajectory entries with page navigation (27.8). */
export const TrajectoryPageView: React.FC<TrajectoryPageViewProps> = ({ data, page, onPage, loading }) => {
  const pageSize = Math.min(data.pageSize || TRAJECTORY_PAGE_SIZE, TRAJECTORY_PAGE_SIZE);
  const pages = pageCount(data.total, pageSize);
  const entries = data.entries.slice(0, TRAJECTORY_PAGE_SIZE);
  const navButton = cn(
    'inline-flex items-center gap-1 rounded-lg border border-slate-500 bg-white px-2 py-1 text-sm text-slate-900',
    'hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer',
    FOCUS_RING,
  );
  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Trajectory pages" className="flex flex-wrap items-center gap-2">
        <button type="button" className={navButton} disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden="true" focusable="false" className="h-4 w-4" />
          <span>Previous page</span>
        </button>
        <span className="text-sm text-slate-800">{`Page ${page} of ${pages} · ${data.total} entries`}</span>
        <button type="button" className={navButton} disabled={loading || page >= pages} onClick={() => onPage(page + 1)}>
          <span>Next page</span>
          <ChevronRight aria-hidden="true" focusable="false" className="h-4 w-4" />
        </button>
      </nav>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-700">No trajectory entries on this page.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {entries.map((entry) => (
            <TrajectoryEntryView key={`${entry.task_id}#${entry.iteration}`} entry={entry} />
          ))}
        </ol>
      )}
    </div>
  );
};

export interface TrajectoryBrowserProps {
  runId: string;
}

/** Per-run trajectory browser; a failed page load keeps the last page on screen with a retry (27.8, 27.11). */
export const TrajectoryBrowser: React.FC<TrajectoryBrowserProps> = ({ runId }) => {
  const [pageState, setPageState] = useState<{ runId: string; page: number }>({ runId, page: 1 });
  const page = pageState.runId === runId ? pageState.page : 1;
  const resource = useApiResource((signal) => experiments.getTrajectories(runId, page, { signal }), {
    requestKey: `${runId}#${page}`,
    dataKey: runId,
  });
  return (
    <section aria-labelledby="trajectory-title" className="flex flex-col gap-3">
      <h4 id="trajectory-title" className="text-sm font-semibold text-slate-900">
        Trajectories
      </h4>
      {resource.loading ? <LoadingState label="Loading trajectories" /> : null}
      {resource.error && !resource.loading ? (
        <ExperimentsError error={resource.error} onRetry={resource.reload} subject="trajectories" />
      ) : null}
      {resource.data ? (
        <TrajectoryPageView
          data={resource.data}
          page={page}
          loading={resource.loading}
          onPage={(p) => setPageState({ runId, page: p })}
        />
      ) : null}
    </section>
  );
};
