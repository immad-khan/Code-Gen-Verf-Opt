import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { AdvisoryFinding, MappedFinding, VerificationResult } from '../../api/types';
import type { StageStatus } from '../../state/workbench';
import { useWorkbench } from '../../state/WorkbenchContext';
import { EmptyState } from '../common/AsyncState';
import { Badge } from '../common/Badge';
import { NotAvailable } from '../common/NotAvailable';
import { formatLocation } from './stageModel';

export const NO_CORRECTNESS_FINDINGS = 'No correctness findings. The candidate passed every correctness check.';
export const NO_ADVISORY_FINDINGS = 'No advisory findings.';

const ADVISORY_LABELS: Record<AdvisoryFinding['technique'], string> = {
  types: 'Types',
  quality: 'Quality',
  security: 'Security',
};

const CorrectnessFindingItem: React.FC<{ finding: MappedFinding }> = ({ finding }) => {
  const location = formatLocation(finding.location);
  const unmapped = finding.category === 'UNMAPPED';
  return (
    <li className="card-quiet p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={unmapped ? 'warning' : 'danger'}>{finding.category}</Badge>
        {finding.categoryName ? (
          <span className="text-sm font-semibold text-[color:var(--color-ink)]">{finding.categoryName}</span>
        ) : null}
        {finding.occurrences > 1 ? (
          <span className="text-xs text-[color:var(--color-ink-muted)]">× {finding.occurrences} occurrences</span>
        ) : null}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="font-semibold text-[color:var(--color-ink-muted)]">Taxonomy category</dt>
        <dd className="text-[color:var(--color-ink)]">
          {finding.category}
          {finding.categoryName ? ` — ${finding.categoryName}` : ''}
        </dd>
        <dt className="font-semibold text-[color:var(--color-ink-muted)]">Primary type</dt>
        <dd className="text-[color:var(--color-ink)]">
          {finding.primaryType ?? <NotAvailable reason="the finding is unmapped" />}
        </dd>
        <dt className="font-semibold text-[color:var(--color-ink-muted)]">Location</dt>
        <dd className="text-[color:var(--color-ink)] font-mono text-xs break-all">
          {location ?? <NotAvailable reason="the backend reported no location" />}
        </dd>
        <dt className="font-semibold text-[color:var(--color-ink-muted)]">Signal</dt>
        <dd className="text-[color:var(--color-ink)]">
          {finding.technique} · {finding.signal}
          {finding.exception ? ` · ${finding.exception}` : ''}
        </dd>
        <dt className="font-semibold text-[color:var(--color-ink-muted)]">Message</dt>
        <dd className="text-[color:var(--color-ink)] break-words">{finding.message}</dd>
      </dl>
      <div>
        <p className="text-sm font-semibold text-[color:var(--color-ink-muted)] mb-1">Evidence</p>
        {finding.evidence.trim() ? (
          <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100 whitespace-pre-wrap break-words">
            {finding.evidence}
          </pre>
        ) : (
          <NotAvailable reason="the backend reported no evidence" />
        )}
      </div>
    </li>
  );
};

const AdvisoryFindingItem: React.FC<{ finding: AdvisoryFinding }> = ({ finding }) => {
  const location = formatLocation({ file: finding.file, line: finding.line });
  return (
    <li className="card-quiet p-3 flex flex-col gap-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{ADVISORY_LABELS[finding.technique] ?? finding.technique}</Badge>
        {location ? <span className="font-mono text-xs text-[color:var(--color-ink-muted)] break-all">{location}</span> : null}
      </div>
      <p className="text-[color:var(--color-ink)] break-words">{finding.message}</p>
    </li>
  );
};

export interface DiagnoseStageViewProps {
  status: StageStatus;
  /** Verification result of the current request; undefined when Verify has not completed. */
  result?: VerificationResult;
  onContinue: () => void;
  onGoToVerify: () => void;
}

/**
 * Presentational Diagnose stage: correctness findings with taxonomy category,
 * primary type, evidence, and location; advisory findings in a separate panel
 * without a category; a "no findings" message for any empty list (25.7).
 */
export const DiagnoseStageView: React.FC<DiagnoseStageViewProps> = ({ status, result, onContinue, onGoToVerify }) => {
  if (!result) {
    return (
      <section aria-labelledby="diagnose-stage-title" className="max-w-6xl w-full mx-auto px-4 md:px-6 py-8 flex flex-col gap-4">
        <h2 id="diagnose-stage-title" className="text-xl font-bold tracking-tight text-[color:var(--color-ink)]">
          Diagnose
        </h2>
        <EmptyState
          subject="findings"
          producer="the Verify stage"
          action={{ label: 'Go to Verify', onClick: onGoToVerify }}
        />
      </section>
    );
  }

  const correctness = result.correctnessFindings;
  const advisory = result.advisoryFindings;
  return (
    <section aria-labelledby="diagnose-stage-title" className="max-w-6xl w-full mx-auto px-4 md:px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="diagnose-stage-title" className="text-xl font-bold tracking-tight text-[color:var(--color-ink)]">
            Diagnose
          </h2>
          <p className="text-sm text-[color:var(--color-ink-muted)] mt-0.5">
            Correctness gate {result.gatePassed ? 'passed' : 'failed'} · primary state {result.primaryState}
          </p>
        </div>
        <button
          type="button"
          onClick={onContinue}
          disabled={status === 'locked'}
          className="btn-primary px-5 py-2.5 text-sm flex items-center gap-2"
        >
          <span>Continue to repair</span>
          <ArrowRight aria-hidden="true" className="w-4 h-4" />
        </button>
      </div>

      <section aria-labelledby="diagnose-correctness-title" className="flex flex-col gap-3">
        <h3 id="diagnose-correctness-title" className="text-base font-semibold text-[color:var(--color-ink)]">
          Correctness findings ({correctness.length})
        </h3>
        {correctness.length === 0 ? (
          <p className="text-sm text-[color:var(--color-ink-muted)]">{NO_CORRECTNESS_FINDINGS}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {correctness.map((finding, index) => (
              <CorrectnessFindingItem key={`${finding.category}-${index}`} finding={finding} />
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="diagnose-advisory-title"
        className="card p-4 flex flex-col gap-3"
      >
        <div>
          <h3 id="diagnose-advisory-title" className="text-base font-semibold text-[color:var(--color-ink)]">
            Advisory findings ({advisory.length})
          </h3>
          <p className="text-xs text-[color:var(--color-ink-muted)] mt-0.5">
            Type, quality, and security notes. They are not mapped to the bug taxonomy and do not affect the correctness gate.
          </p>
        </div>
        {advisory.length === 0 ? (
          <p className="text-sm text-[color:var(--color-ink-muted)]">{NO_ADVISORY_FINDINGS}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {advisory.map((finding, index) => (
              <AdvisoryFindingItem key={`${finding.technique}-${index}`} finding={finding} />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};

/** Diagnose stage wired to the Workbench reducer. Continue acknowledges the stage and opens Repair. */
export const DiagnoseStage: React.FC = () => {
  const { state, dispatch } = useWorkbench();
  const status = state.stages.diagnose.status;
  const onContinue = () => {
    if (status === 'available') dispatch({ type: 'ACKNOWLEDGE', stage: 'diagnose' });
    dispatch({ type: 'SELECT', stage: 'repair' });
  };
  return (
    <DiagnoseStageView
      status={status}
      result={state.results.verify}
      onContinue={onContinue}
      onGoToVerify={() => dispatch({ type: 'SELECT', stage: 'verify' })}
    />
  );
};
