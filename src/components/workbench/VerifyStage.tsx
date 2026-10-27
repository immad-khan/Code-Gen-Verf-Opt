import React, { useCallback } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { ApiErrorView } from '../../api/client';
import { OPERATIONS, verify as verifyRequest } from '../../api/endpoints';
import type { GeneratedCodeFile, TechniqueStatusValue, VerificationResult } from '../../api/types';
import type { StageStatus } from '../../state/workbench';
import { useWorkbench } from '../../state/WorkbenchContext';
import { ErrorState, LoadingState } from '../common/AsyncState';
import { Badge, type BadgeTone } from '../common/Badge';
import { DataTable } from '../common/DataTable';
import { runStageOperation, verifyBlockedReason } from './stageModel';

/** Sends the working files to `POST /api/verification`; must reject on failure. */
export type Verifier = (files: GeneratedCodeFile[]) => Promise<VerificationResult>;

const TECHNIQUE_STATUS: Record<TechniqueStatusValue, { label: string; tone: BadgeTone }> = {
  pass: { label: 'pass', tone: 'success' },
  fail: { label: 'fail', tone: 'danger' },
  skipped_upstream: { label: 'skipped (upstream failure)', tone: 'neutral' },
  no_tests: { label: 'no tests', tone: 'warning' },
  error: { label: 'error', tone: 'danger' },
};

export interface VerifyStageViewProps {
  status: StageStatus;
  error?: ApiErrorView;
  offline: boolean;
  fileCount: number;
  /** Only the result returned for the current request (23.4). */
  result?: VerificationResult;
  onVerify: () => void;
  onContinue: () => void;
}

const VerificationSummary: React.FC<{ result: VerificationResult }> = ({ result }) => (
  <div className="flex flex-col gap-4">
    <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="card-quiet p-4">
        <dt className="eyebrow mb-1.5">Correctness gate</dt>
        <dd>
          <Badge tone={result.gatePassed ? 'success' : 'danger'}>{result.gatePassed ? 'passed' : 'failed'}</Badge>
        </dd>
      </div>
      <div className="card-quiet p-4">
        <dt className="eyebrow mb-1.5">Primary state</dt>
        <dd className="text-xl font-bold text-[color:var(--color-ink)]">{result.primaryState}</dd>
      </div>
      <div className="card-quiet p-4">
        <dt className="eyebrow mb-1.5">Tests</dt>
        <dd className="text-sm text-[color:var(--color-ink)]">
          {result.testsPassed} passed · {result.testsFailed} failed
        </dd>
      </div>
      <div className="card-quiet p-4">
        <dt className="eyebrow mb-1.5">Duration</dt>
        <dd className="text-sm text-[color:var(--color-ink)]">{(result.durationMs / 1000).toFixed(1)} s</dd>
      </div>
    </dl>

    {!result.complete ? (
      <p className="rounded-lg border border-amber-700 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Verification is incomplete. These techniques did not finish:{' '}
        {result.incompleteTechniques.length > 0 ? result.incompleteTechniques.join(', ') : 'not reported'}.
      </p>
    ) : null}

    <DataTable
      caption="Verification techniques"
      columns={[
        { key: 'name', header: 'Technique', cell: (t) => t.name, rowHeader: true },
        {
          key: 'status',
          header: 'Status',
          cell: (t) => {
            const s = TECHNIQUE_STATUS[t.status] ?? { label: t.status, tone: 'neutral' as const };
            return <Badge tone={s.tone}>{s.label}</Badge>;
          },
        },
        { key: 'complete', header: 'Complete', cell: (t) => (t.complete ? 'yes' : 'no') },
        { key: 'details', header: 'Details', cell: (t) => (t.details.trim() ? t.details : '—') },
      ]}
      rows={result.techniques}
      rowKey={(t) => t.id}
      emptyMessage="The backend reported no techniques."
    />
  </div>
);

/** Presentational Verify stage. */
export const VerifyStageView: React.FC<VerifyStageViewProps> = ({
  status,
  error,
  offline,
  fileCount,
  result,
  onVerify,
  onContinue,
}) => {
  const blocked = verifyBlockedReason({ status, offline, fileCount });
  const running = status === 'running';
  const showResult = status === 'complete' && result !== undefined;
  return (
    <section
      aria-labelledby="verify-stage-title"
      aria-busy={running || undefined}
      className="max-w-6xl w-full mx-auto px-4 md:px-6 py-8 flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="verify-stage-title" className="text-xl font-bold tracking-tight text-[color:var(--color-ink)]">
            Verify
          </h2>
          <p className="text-sm text-[color:var(--color-ink-muted)] mt-0.5">
            Runs syntax, import, test, and runtime checks on the {fileCount} working{' '}
            {fileCount === 1 ? 'file' : 'files'} in the MACI backend, plus advisory type, quality, and security checks.
          </p>
        </div>
        <button
          type="button"
          onClick={onVerify}
          disabled={blocked !== null}
          aria-describedby={blocked ? 'verify-blocked-reason' : undefined}
          className="btn-primary px-5 py-2.5 text-sm flex items-center gap-2"
        >
          <ShieldCheck aria-hidden="true" className="w-4 h-4" />
          <span>{status === 'complete' ? 'Re-run verification' : 'Run verification'}</span>
        </button>
      </div>

      {blocked && !running ? (
        <p id="verify-blocked-reason" className="text-sm text-[color:var(--color-ink-muted)]">
          {blocked}
        </p>
      ) : null}

      {running ? <LoadingState label="Running verification" /> : null}
      {status === 'failed' && error ? (
        <ErrorState error={error} onRetry={onVerify} retryDisabled={offline} />
      ) : null}

      {showResult ? (
        <>
          <VerificationSummary result={result} />
          <div>
            <button type="button" onClick={onContinue} className="btn-primary px-5 py-2.5 text-sm flex items-center gap-2">
              <span>Continue to Diagnose</span>
              <ArrowRight aria-hidden="true" className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
};

export interface VerifyStageProps {
  /** Latest health check failed (23.7). */
  offline: boolean;
  /** Defaults to `POST /api/verification`. */
  verifier?: Verifier;
}

const defaultVerifier: Verifier = (files) => verifyRequest(files);

/** Verify stage wired to the Workbench reducer. Retry resends the unchanged working files (23.3). */
export const VerifyStage: React.FC<VerifyStageProps> = ({ offline, verifier = defaultVerifier }) => {
  const { state, dispatch } = useWorkbench();
  const stage = state.stages.verify;
  const files = state.files;

  const run = useCallback(() => {
    if (verifyBlockedReason({ status: stage.status, offline, fileCount: files.length }) !== null) return;
    void runStageOperation(dispatch, 'verify', OPERATIONS.verify, () => verifier(files));
  }, [dispatch, files, offline, stage.status, verifier]);

  return (
    <VerifyStageView
      status={stage.status}
      error={stage.error}
      offline={offline}
      fileCount={files.length}
      result={state.results.verify}
      onVerify={run}
      onContinue={() => dispatch({ type: 'SELECT', stage: 'diagnose' })}
    />
  );
};
