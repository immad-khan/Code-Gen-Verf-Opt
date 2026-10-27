import React from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import type { ApiErrorView } from '../../api/client';
import { cn } from '../../utils/cn';
import { RetryButton } from './RetryButton';
import { FOCUS_RING, emptyStateText, errorStateText, resolveAsyncView } from './asyncStateModel';

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface LoadingStateProps {
  /** What is in progress, e.g. "Running verification". */
  label?: string;
  className?: string;
}

/**
 * Loading indicator for the requesting view (28.1). It renders on the same
 * render that sets `loading`, so it appears well within 300 ms of the request
 * and disappears as soon as the response or failure is recorded.
 */
export const LoadingState: React.FC<LoadingStateProps> = ({ label = 'Loading', className }) => (
  <div
    role="status"
    className={cn(
      'flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800',
      className,
    )}
  >
    <Loader2 aria-hidden="true" focusable="false" className="h-4 w-4 animate-spin text-indigo-700" />
    <span>{`${label}…`}</span>
  </div>
);

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface ErrorStateProps {
  error: ApiErrorView;
  /** Resends the failed request with the same inputs (28.6). Omit to hide the retry control. */
  onRetry?: () => void;
  /** Disables the retry control, e.g. while offline or while the retry is in flight. */
  retryDisabled?: boolean;
  /**
   * Render as `role="alert"` so the error is announced on appearance. Leave
   * false when the caller already announces the failure through the
   * LiveRegionProvider, so the error is announced exactly once (28.13).
   */
  live?: boolean;
  className?: string;
}

/** Error state with the backend message (or a network/server fallback) and a retry action (28.4, 28.5). */
export const ErrorState: React.FC<ErrorStateProps> = ({ error, onRetry, retryDisabled, live = false, className }) => {
  const { title, message } = errorStateText(error);
  return (
    <div
      role={live ? 'alert' : undefined}
      className={cn('flex flex-col gap-3 rounded-lg border border-rose-700 bg-rose-50 p-4 text-rose-950', className)}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden="true" focusable="false" className="mt-0.5 h-4 w-4 shrink-0 text-rose-800" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-sm break-words">{message}</p>
        </div>
      </div>
      {onRetry ? (
        <div>
          <RetryButton onRetry={onRetry} operation={error.operation} disabled={retryDisabled} />
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

export interface EmptyStateAction {
  /** Visible control text, e.g. "Go to Verify" or "Start a run". */
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface EmptyStateProps {
  /** The missing data, e.g. "verification results". */
  subject: string;
  /** The Workbench stage or Experiments action that produces it, e.g. "the Verify stage". */
  producer: string;
  /** Control that navigates to or starts the producing action (28.3). */
  action: EmptyStateAction;
  className?: string;
}

/** Empty state naming the producing stage/action, with a control to go there (28.3). */
export const EmptyState: React.FC<EmptyStateProps> = ({ subject, producer, action, className }) => (
  <div
    className={cn(
      'flex flex-col items-start gap-3 rounded-lg border border-dashed border-slate-500 bg-white p-4 text-sm text-slate-800',
      className,
    )}
  >
    <div className="flex items-start gap-2">
      <Inbox aria-hidden="true" focusable="false" className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
      <p>{emptyStateText(subject, producer)}</p>
    </div>
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      className={cn(
        'inline-flex items-center rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-semibold text-white',
        'hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer',
        FOCUS_RING,
      )}
    >
      {action.label}
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Composite
// ---------------------------------------------------------------------------

export interface AsyncStateProps {
  /** True while the backend request for this view is in flight. */
  loading: boolean;
  loadingLabel?: string;
  /** The failure of the last request, if it failed. */
  error?: ApiErrorView | null;
  onRetry?: () => void;
  retryDisabled?: boolean;
  /** See `ErrorStateProps.live`. */
  liveError?: boolean;
  /** True when there is no data to show. */
  isEmpty: boolean;
  empty: EmptyStateProps;
  /** The loaded content. A function is only called when there is data. */
  children: React.ReactNode | (() => React.ReactNode);
  className?: string;
}

/**
 * Loading / error / empty wrapper for a view region. Previously loaded content
 * stays visible beneath a loading indicator or an error (27.11); the empty
 * state shows only when nothing is loading and nothing failed.
 */
export const AsyncState: React.FC<AsyncStateProps> = ({
  loading,
  loadingLabel,
  error,
  onRetry,
  retryDisabled,
  liveError,
  isEmpty,
  empty,
  children,
  className,
}) => {
  const view = resolveAsyncView({ loading, error, isEmpty });
  return (
    <div className={cn('flex flex-col gap-3', className)} aria-busy={loading || undefined}>
      {view.showLoading ? <LoadingState label={loadingLabel} /> : null}
      {view.showError && error ? (
        <ErrorState error={error} onRetry={onRetry} retryDisabled={retryDisabled} live={liveError} />
      ) : null}
      {view.showEmpty ? <EmptyState {...empty} /> : null}
      {view.showContent ? (typeof children === 'function' ? children() : children) : null}
    </div>
  );
};
