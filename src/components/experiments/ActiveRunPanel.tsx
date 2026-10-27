import React, { useEffect, useRef, useState } from 'react';
import { Square, X } from 'lucide-react';
import { toApiErrorView, type ApiErrorView } from '../../api/client';
import { experiments, OPERATIONS } from '../../api/endpoints';
import type { RunStatus } from '../../api/types';
import { usePolling } from '../../state/usePolling';
import type { Clock } from '../../state/clock';
import { Badge, FOCUS_RING, LoadingState } from '../common';
import { cn } from '../../utils/cn';
import { NOT_AVAILABLE } from '../../lib/format';
import { ExperimentsError } from './ExperimentsError';
import {
  ACTIVE_RUN_POLL_MS,
  OUTPUT_TAIL_LINES,
  isRunActive,
  outputTail,
  progressText,
  runStatusTone,
} from './experimentsModel';

export interface ActiveRunStatusViewProps {
  runId: string;
  status: RunStatus | undefined;
  polling: boolean;
  error: ApiErrorView | null;
  onRetry: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  cancelError?: ApiErrorView | null;
  onDismiss?: () => void;
}

const BUTTON = cn(
  'inline-flex items-center gap-2 rounded-lg border border-slate-500 bg-white px-3 py-1.5 text-sm font-medium text-slate-900',
  'hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer',
  FOCUS_RING,
);

/** Status, progress, and runner output of the active run (27.2); final status once it ends (27.10). */
export const ActiveRunStatusView: React.FC<ActiveRunStatusViewProps> = ({
  runId,
  status,
  polling,
  error,
  onRetry,
  onCancel,
  cancelling = false,
  cancelError,
  onDismiss,
}) => {
  const active = status ? isRunActive(status.status) : true;
  const progress = status ? progressText(status) : null;
  const lines = outputTail(status?.outputTail);
  return (
    <section aria-labelledby="active-run-title" className="flex flex-col gap-3 rounded-lg border border-slate-300 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="active-run-title" className="text-base font-semibold text-slate-900">
          {active ? 'Active run' : 'Last run'}
        </h3>
        <div className="flex gap-2">
          {active && onCancel ? (
            <button type="button" onClick={onCancel} disabled={cancelling || !status} className={BUTTON}>
              <Square aria-hidden="true" focusable="false" className="h-4 w-4" />
              <span>{cancelling ? 'Cancelling…' : 'Cancel run'}</span>
            </button>
          ) : null}
          {!active && onDismiss ? (
            <button type="button" onClick={onDismiss} className={BUTTON} aria-label="Dismiss last run panel">
              <X aria-hidden="true" focusable="false" className="h-4 w-4" />
              <span>Dismiss</span>
            </button>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="font-medium text-slate-700">Run</dt>
        <dd className="font-mono break-all text-slate-900">{runId}</dd>
        <dt className="font-medium text-slate-700">Status</dt>
        <dd>
          {status ? (
            <Badge tone={runStatusTone(status.status)}>{status.status}</Badge>
          ) : (
            <span className="text-slate-700">waiting for first status…</span>
          )}
        </dd>
        <dt className="font-medium text-slate-700">Phase</dt>
        <dd className="text-slate-900">{status?.phase ?? NOT_AVAILABLE}</dd>
        <dt className="font-medium text-slate-700">Progress</dt>
        <dd className="text-slate-900">{progress ?? NOT_AVAILABLE}</dd>
        {status && status.exitCode != null ? (
          <>
            <dt className="font-medium text-slate-700">Exit code</dt>
            <dd className="text-slate-900">{status.exitCode}</dd>
          </>
        ) : null}
        {status?.launchError ? (
          <>
            <dt className="font-medium text-slate-700">Launch error</dt>
            <dd className="text-rose-900 break-words">{status.launchError}</dd>
          </>
        ) : null}
      </dl>

      {status && progress && status.total ? (
        <progress
          value={status.completed ?? 0}
          max={status.total}
          aria-label={`Run progress: ${progress}`}
          className="h-2 w-full"
        />
      ) : null}

      {polling && !status ? <LoadingState label="Loading run status" /> : null}
      {error ? <ExperimentsError error={error} onRetry={onRetry} subject="run status" /> : null}
      {cancelError ? <ExperimentsError error={cancelError} subject="cancel run" /> : null}

      <div>
        <h4 className="mb-1 text-sm font-semibold text-slate-800">{`Runner output (last ${OUTPUT_TAIL_LINES} lines)`}</h4>
        <pre
          tabIndex={0}
          aria-label={`Runner output, last ${OUTPUT_TAIL_LINES} lines`}
          className={cn(
            'max-h-72 overflow-auto rounded-md border border-slate-300 bg-slate-950 p-3 text-xs leading-5 text-slate-100',
            FOCUS_RING,
          )}
        >
          {lines.length > 0 ? lines.join('\n') : 'No output yet.'}
        </pre>
      </div>
    </section>
  );
};

export interface ActiveRunPanelProps {
  runId: string;
  /** Called once when the run leaves `running`; the parent refreshes the run list (27.10). */
  onEnded: (status: RunStatus) => void;
  onDismiss?: () => void;
  clock?: Clock;
}

/**
 * Polls the active run's status every 2 s (27.2) and stops once the run is
 * completed, failed, or cancelled, keeping the final status on screen (27.10).
 */
export const ActiveRunPanel: React.FC<ActiveRunPanelProps> = ({ runId, onEnded, onDismiss, clock }) => {
  const poll = usePolling<RunStatus>((signal) => experiments.getRunStatus(runId, { signal }), {
    intervalMs: ACTIVE_RUN_POLL_MS,
    key: runId,
    shouldStop: (s) => !isRunActive(s.status),
    clock,
  });
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<ApiErrorView | null>(null);

  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  });
  const reportedRef = useRef<string | null>(null);
  const status = poll.data;
  useEffect(() => {
    if (status && !isRunActive(status.status) && reportedRef.current !== status.runId) {
      reportedRef.current = status.runId;
      onEndedRef.current(status);
    }
  }, [status]);

  const cancel = () => {
    setCancelling(true);
    setCancelError(null);
    experiments
      .cancelRun(runId)
      .catch((e: unknown) => setCancelError(toApiErrorView(e, OPERATIONS.experiments)))
      .finally(() => setCancelling(false));
  };

  return (
    <ActiveRunStatusView
      runId={runId}
      status={status}
      polling={poll.polling}
      error={poll.error ? toApiErrorView(poll.error, OPERATIONS.experiments) : null}
      onRetry={poll.restart}
      onCancel={cancel}
      cancelling={cancelling}
      cancelError={cancelError}
      onDismiss={onDismiss}
    />
  );
};
