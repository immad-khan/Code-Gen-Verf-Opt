import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { ApiErrorView } from '../../api/client';
import { Badge, RetryButton } from '../common';
import { cn } from '../../utils/cn';
import { experimentsErrorText, runBadges } from './experimentsModel';
import type { LlmMode, RunProvenance } from '../../api/types';

export interface ExperimentsErrorProps {
  error: ApiErrorView;
  /** Resends the failed request (27.11, 28.6). */
  onRetry?: () => void;
  retrying?: boolean;
  /** What failed to load, e.g. "run list". */
  subject?: string;
  className?: string;
}

/**
 * Error state for an Experiments API request. Network failures and timeouts are
 * labelled "Experiments API unreachable" (27.11). Shown above previously loaded
 * data, which callers keep on screen.
 */
export const ExperimentsError: React.FC<ExperimentsErrorProps> = ({ error, onRetry, retrying, subject, className }) => {
  const { title, message } = experimentsErrorText(error);
  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border border-rose-700 bg-rose-50 p-4 text-rose-950', className)}>
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden="true" focusable="false" className="mt-0.5 h-4 w-4 shrink-0 text-rose-800" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{subject ? `${title} (${subject})` : title}</p>
          <p className="mt-1 text-sm break-words">{message}</p>
          <p className="mt-1 text-xs">Previously loaded data stays on screen.</p>
        </div>
      </div>
      {onRetry ? (
        <div>
          <RetryButton onRetry={onRetry} busy={retrying} operation={subject ?? 'experiments request'} />
        </div>
      ) : null}
    </div>
  );
};

export interface RunBadgesProps {
  llmMode: LlmMode | null | undefined;
  provenance: RunProvenance | null | undefined;
}

/** `mock` / `legacy` text badges shown next to a run's metrics (27.4). */
export const RunBadges: React.FC<RunBadgesProps> = ({ llmMode, provenance }) => {
  const badges = runBadges(llmMode, provenance);
  if (badges.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {badges.map((kind) =>
        kind === 'mock' ? (
          <Badge key={kind} tone="warning" description="results come from the mock LLM client">
            mock
          </Badge>
        ) : (
          <Badge key={kind} tone="neutral" description="run has no manifest; configuration is not verified">
            legacy
          </Badge>
        ),
      )}
    </span>
  );
};
