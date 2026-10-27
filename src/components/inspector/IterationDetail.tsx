import React, { useId } from 'react';
import type { GeneratedCodeFile, MappedFinding, RepairIteration, VerificationResult } from '../../api/types';
import { cn } from '../../utils/cn';
import { Badge } from '../common/Badge';
import { DataTable, type DataTableColumn } from '../common/DataTable';
import { FOCUS_RING } from '../common/asyncStateModel';
import { FileDiff } from './FileDiff';
import {
  NO_CRITIQUE_TEXT,
  NO_EXTRACTABLE_CODE,
  extractedCodeFiles,
  fileChanges,
  fileKey,
  hasNoCritique,
  transitionLabel,
} from './inspectorModel';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

interface DetailSectionProps {
  title: string;
  children: React.ReactNode;
}

/** Titled subsection of an iteration's detail. */
const DetailSection: React.FC<DetailSectionProps> = ({ title, children }) => {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h5 id={headingId} className="text-sm font-semibold text-slate-900">
        {title}
      </h5>
      {children}
    </section>
  );
};

/** Missing-section label (26.4). */
const MissingLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-lg border border-dashed border-slate-500 bg-slate-50 px-3 py-2 text-sm italic text-slate-700">
    {children}
  </p>
);

export interface TextBlockProps {
  /** Accessible name of the scrollable region. */
  label: string;
  text: string;
  className?: string;
}

/** Full, untruncated text in a keyboard-scrollable region (26.2, 26.3). */
export const TextBlock: React.FC<TextBlockProps> = ({ label, text, className }) => (
  <div
    role="region"
    aria-label={label}
    tabIndex={0}
    className={cn('max-h-96 overflow-auto rounded-lg border border-slate-300 bg-slate-50', FOCUS_RING, className)}
  >
    <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-slate-900">{text}</pre>
  </div>
);

/** Code of each file under a file-name heading. */
const CodeFiles: React.FC<{ files: readonly GeneratedCodeFile[]; labelPrefix: string }> = ({ files, labelPrefix }) => (
  <div className="flex flex-col gap-3">
    {files.map((file) => (
      <div key={fileKey(file)} className="flex flex-col gap-1">
        <h6 className="font-mono text-xs font-semibold text-slate-900 break-all">{fileKey(file)}</h6>
        <TextBlock label={`${labelPrefix}: ${fileKey(file)}`} text={file.content} />
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Verification results
// ---------------------------------------------------------------------------

function formatLocation(finding: MappedFinding): string | null {
  if (!finding.location) return null;
  return finding.location.line != null ? `${finding.location.file}:${finding.location.line}` : finding.location.file;
}

const FINDING_COLUMNS: ReadonlyArray<DataTableColumn<MappedFinding>> = [
  {
    key: 'category',
    header: 'Category',
    rowHeader: true,
    cell: (f) => (f.categoryName ? `${f.category} ${f.categoryName}` : f.category),
  },
  { key: 'type', header: 'Primary type', cell: (f) => f.primaryType },
  { key: 'technique', header: 'Technique', cell: (f) => f.technique },
  { key: 'signal', header: 'Signal', cell: (f) => f.signal },
  {
    key: 'message',
    header: 'Message',
    cell: (f) => <span className="whitespace-pre-wrap break-words">{f.message}</span>,
  },
  { key: 'location', header: 'Location', cell: (f) => formatLocation(f) },
  { key: 'occurrences', header: 'Occurrences', cell: (f) => f.occurrences, align: 'right' },
];

export interface VerificationSummaryProps {
  verification: VerificationResult;
  /** False when one or more correctness techniques could not complete. */
  complete?: boolean;
  caption: string;
}

/** Correctness gate, Primary_State, and every correctness finding with its taxonomy category (26.7). */
export const VerificationSummary: React.FC<VerificationSummaryProps> = ({ verification, complete, caption }) => {
  const isComplete = complete ?? verification.complete;
  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-900">
        <div className="flex items-center gap-2">
          <dt className="font-medium">Correctness gate</dt>
          <dd>
            <Badge tone={verification.gatePassed ? 'success' : 'danger'}>
              {verification.gatePassed ? 'passed' : 'failed'}
            </Badge>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="font-medium">Primary_State</dt>
          <dd>{verification.primaryState}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="font-medium">Tests</dt>
          <dd>{`${verification.testsPassed} passed, ${verification.testsFailed} failed`}</dd>
        </div>
      </dl>
      {!isComplete ? (
        <p className="text-sm text-amber-900">
          {`Verification incomplete${
            verification.incompleteTechniques.length > 0 ? `: ${verification.incompleteTechniques.join(', ')}` : ''
          }.`}
        </p>
      ) : null}
      <DataTable
        caption={caption}
        columns={FINDING_COLUMNS}
        rows={verification.correctnessFindings}
        rowKey={(f, i) => `${f.category}|${f.signal}|${f.location?.file ?? ''}|${i}`}
        emptyMessage="No correctness findings."
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Iteration detail
// ---------------------------------------------------------------------------

export interface IterationDetailProps {
  iteration: RepairIteration;
}

/**
 * Everything about one repair iteration: the full critique prompt (26.2), the
 * raw response with labelled critique and code sections (26.3, 26.4), a line
 * diff per file (26.5, 26.6), and re-verification results with the
 * "X → Y" Primary_State transition (26.7).
 */
export const IterationDetail: React.FC<IterationDetailProps> = ({ iteration }) => {
  const n = iteration.iteration;
  const extracted = extractedCodeFiles(iteration);
  const changes = fileChanges(iteration.filesBefore, iteration.filesAfter);
  const { transition } = iteration;

  return (
    <article aria-label={`Iteration ${n} details`} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-base font-semibold text-slate-900">{`Iteration ${n}`}</h4>
        <p className="text-sm text-slate-900">
          <span className="font-medium">Primary_State transition: </span>
          <span className="font-mono">{transitionLabel(transition)}</span>
        </p>
      </div>
      {!transition.available && transition.failure ? (
        <p className="text-sm text-amber-900">{`State not available: ${transition.failure}`}</p>
      ) : null}

      <DetailSection title="Critique prompt sent to the LLM">
        <TextBlock label={`Iteration ${n} critique prompt`} text={iteration.prompt} />
      </DetailSection>

      <DetailSection title="Raw LLM response">
        <TextBlock label={`Iteration ${n} raw LLM response`} text={iteration.rawResponse} />
      </DetailSection>

      <DetailSection title="Critique text">
        {hasNoCritique(iteration.critiqueText) ? (
          <MissingLabel>{NO_CRITIQUE_TEXT}</MissingLabel>
        ) : (
          <TextBlock label={`Iteration ${n} critique text`} text={iteration.critiqueText ?? ''} />
        )}
      </DetailSection>

      <DetailSection title="Extracted code">
        {iteration.noExtractableCode ? (
          <MissingLabel>{NO_EXTRACTABLE_CODE}</MissingLabel>
        ) : extracted.length === 0 ? (
          <p className="text-sm text-slate-700">The extracted code is identical to the code before this iteration.</p>
        ) : (
          <CodeFiles files={extracted} labelPrefix={`Iteration ${n} extracted code`} />
        )}
      </DetailSection>

      <DetailSection title={`Code changes (iteration ${n - 1} → ${n})`}>
        {changes.length === 0 ? (
          <p className="text-sm text-slate-700">No files.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {changes.map((change) => (
              <FileDiff key={change.path} change={change} headingLevel="h6" />
            ))}
          </div>
        )}
      </DetailSection>

      <DetailSection title="Re-verification">
        <VerificationSummary
          verification={iteration.verification}
          complete={iteration.verificationComplete && iteration.verification.complete}
          caption={`Iteration ${n} correctness findings`}
        />
      </DetailSection>
    </article>
  );
};

export interface InitialCandidateDetailProps {
  initial: VerificationResult;
  /** Code of the initial candidate, when known. */
  files: readonly GeneratedCodeFile[];
}

/** Iteration 0: the initial candidate's verification and code (26.1). */
export const InitialCandidateDetail: React.FC<InitialCandidateDetailProps> = ({ initial, files }) => (
  <article aria-label="Iteration 0 details" className="flex flex-col gap-5">
    <div className="flex flex-wrap items-center gap-3">
      <h4 className="text-base font-semibold text-slate-900">Iteration 0 (initial candidate)</h4>
      <p className="text-sm text-slate-900">
        <span className="font-medium">Primary_State: </span>
        <span className="font-mono">{initial.primaryState}</span>
      </p>
    </div>

    <DetailSection title="Initial verification">
      <VerificationSummary verification={initial} caption="Iteration 0 correctness findings" />
    </DetailSection>

    <DetailSection title="Initial code">
      {files.length === 0 ? (
        <p className="text-sm text-slate-700">The initial code is not part of this session data.</p>
      ) : (
        <CodeFiles files={files} labelPrefix="Initial code" />
      )}
    </DetailSection>
  </article>
);
