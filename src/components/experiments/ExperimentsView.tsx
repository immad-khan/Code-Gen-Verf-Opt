import React, { useCallback, useEffect, useRef, useState } from 'react';
import { experiments } from '../../api/endpoints';
import type { RunStatus } from '../../api/types';
import { useAnnounce } from '../shell/liveRegion';
import { EmptyState, LoadingState } from '../common';
import { AblationTable } from './AblationTable';
import { ActiveRunPanel } from './ActiveRunPanel';
import { ExperimentsError } from './ExperimentsError';
import { RunDetail } from './RunDetail';
import { RunList } from './RunList';
import { StartRunForm } from './StartRunForm';
import { TrajectoryBrowser } from './TrajectoryBrowser';
import {
  DEFAULT_START_RUN_VALUES,
  isRunActive,
  toStartRunRejection,
  toggleSelection,
  validateStartRunForm,
  type StartRunField,
  type StartRunFormValues,
  type StartRunRejection,
} from './experimentsModel';
import { useApiResource } from './useApiResource';

export interface ExperimentsViewProps {
  /** True while the backend health check reports offline; disables starting and cancelling runs. */
  offline?: boolean;
}

const SectionTitle: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => (
  <h3 id={id} tabIndex={-1} className="text-base font-semibold text-slate-900 focus:outline-none">
    {children}
  </h3>
);

/**
 * Experiments section (Requirement 27): start runs, follow the active run,
 * browse runs and their metrics, compare runs against the paper, and inspect
 * trajectories. Every Experiments API request has a 10 s timeout; on failure
 * the affected area shows an "Experiments API unreachable" error with a retry
 * and keeps its last loaded data (27.11).
 */
export const ExperimentsView: React.FC<ExperimentsViewProps> = ({ offline = false }) => {
  const announce = useAnnounce();
  const datasets = useApiResource((signal) => experiments.listDatasets({ signal }), { requestKey: 'datasets' });
  const caches = useApiResource((signal) => experiments.listCaches({ signal }), { requestKey: 'caches' });
  const runs = useApiResource((signal) => experiments.listRuns({ signal }), { requestKey: 'runs' });

  const [values, setValues] = useState<StartRunFormValues>(DEFAULT_START_RUN_VALUES);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<StartRunField, string>>>({});
  const [rejection, setRejection] = useState<StartRunRejection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<string[]>([]);

  const detail = useApiResource((signal) => experiments.getRun(selectedRunId ?? '', { signal }), {
    requestKey: selectedRunId ?? '',
    enabled: selectedRunId !== null,
  });

  // Follow a run that is already running when the view opens.
  const runList = runs.data;
  useEffect(() => {
    if (activeRunId !== null || !runList) return;
    const running = runList.find((r) => isRunActive(r.status));
    if (running) setActiveRunId(running.runId);
  }, [runList, activeRunId]);

  const submit = async () => {
    const validation = validateStartRunForm(values);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      return;
    }
    setFieldErrors({});
    setRejection(null);
    setSubmitting(true);
    try {
      const { runId } = await experiments.startRun(validation.request);
      setActiveRunId(runId);
      announce(`Run ${runId} started.`, 'polite');
      runs.reload();
    } catch (error) {
      // Rejected: keep every entered value and do not mark any run active (27.9).
      const r = toStartRunRejection(error);
      setRejection(r);
      announce(`Start run rejected: ${r.error.message}`, 'assertive');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedRef = useRef(selectedRunId);
  useEffect(() => {
    selectedRef.current = selectedRunId;
  });
  const reloadRuns = runs.reload;
  const reloadDetail = detail.reload;
  const onRunEnded = useCallback(
    (status: RunStatus) => {
      announce(`Run ${status.runId} ${status.status}.`, status.status === 'failed' ? 'assertive' : 'polite');
      // Refresh the list immediately so the run's metrics appear (27.10).
      reloadRuns();
      if (selectedRef.current === status.runId) reloadDetail();
    },
    [announce, reloadRuns, reloadDetail],
  );

  const focusStartForm = () => document.getElementById('experiments-start-title')?.focus();
  const compared = (runs.data ?? []).filter((r) => comparison.includes(r.runId));
  compared.sort((a, b) => comparison.indexOf(a.runId) - comparison.indexOf(b.runId));

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-slate-900">Experiments</h2>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="experiments-start-title" className="flex flex-col gap-2">
          <SectionTitle id="experiments-start-title">New run</SectionTitle>
          {datasets.loading || caches.loading ? <LoadingState label="Loading datasets and caches" /> : null}
          {datasets.error && !datasets.loading ? (
            <ExperimentsError error={datasets.error} onRetry={datasets.reload} subject="datasets" />
          ) : null}
          {caches.error && !caches.loading ? (
            <ExperimentsError error={caches.error} onRetry={caches.reload} subject="generation caches" />
          ) : null}
          <StartRunForm
            values={values}
            onChange={setValues}
            onSubmit={submit}
            submitting={submitting}
            disabledReason={offline ? 'The backend is offline.' : null}
            datasets={datasets.data ?? []}
            caches={caches.data ?? []}
            fieldErrors={fieldErrors}
            rejection={rejection}
          />
        </section>

        <section aria-labelledby="experiments-active-title" className="flex flex-col gap-2">
          <SectionTitle id="experiments-active-title">Run progress</SectionTitle>
          {activeRunId ? (
            <ActiveRunPanel runId={activeRunId} onEnded={onRunEnded} onDismiss={() => setActiveRunId(null)} />
          ) : (
            <p className="text-sm text-slate-700">No run is active. Start a run to follow its progress here.</p>
          )}
        </section>
      </div>

      <section aria-labelledby="experiments-runs-title" className="flex flex-col gap-2">
        <SectionTitle id="experiments-runs-title">Runs</SectionTitle>
        {runs.loading ? <LoadingState label="Loading runs" /> : null}
        {runs.error && !runs.loading ? <ExperimentsError error={runs.error} onRetry={runs.reload} subject="run list" /> : null}
        {runs.data && runs.data.length === 0 && !runs.loading && !runs.error ? (
          <EmptyState subject="runs" producer="the Start run action" action={{ label: 'Start a run', onClick: focusStartForm }} />
        ) : null}
        {runs.data && runs.data.length > 0 ? (
          <RunList
            runs={runs.data}
            selectedRunId={selectedRunId}
            onSelectRun={setSelectedRunId}
            comparison={comparison}
            onToggleCompare={(id) => setComparison((prev) => toggleSelection(prev, id))}
          />
        ) : null}
      </section>

      <section aria-labelledby="experiments-compare-title" className="flex flex-col gap-2">
        <SectionTitle id="experiments-compare-title">Ablation comparison</SectionTitle>
        <AblationTable runs={compared} />
      </section>

      {selectedRunId ? (
        <section aria-labelledby="experiments-detail-title" className="flex flex-col gap-3">
          <SectionTitle id="experiments-detail-title">Run detail</SectionTitle>
          {detail.loading ? <LoadingState label="Loading run detail" /> : null}
          {detail.error && !detail.loading ? (
            <ExperimentsError error={detail.error} onRetry={detail.reload} subject="run detail" />
          ) : null}
          {detail.data ? <RunDetail detail={detail.data} /> : null}
          <TrajectoryBrowser runId={selectedRunId} />
        </section>
      ) : null}
    </div>
  );
};

export default ExperimentsView;
