import React from 'react';
import { RotateCw } from 'lucide-react';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './asyncStateModel';

export interface RetryButtonProps {
  /** Resends the failed request with the same inputs (28.6). */
  onRetry: () => void;
  /** Name of the failed operation, used in the accessible name ("Retry verification"). */
  operation?: string;
  /** True while the retried request is in flight; disables the button (28.2). */
  busy?: boolean;
  disabled?: boolean;
  /** Visible text; defaults to "Retry". */
  label?: string;
  className?: string;
}

/**
 * Retry control for error states. The visible text starts the accessible name
 * so speech-input users can activate it by what they see (28.10).
 */
export const RetryButton: React.FC<RetryButtonProps> = ({
  onRetry,
  operation,
  busy = false,
  disabled = false,
  label = 'Retry',
  className,
}) => {
  const accessibleName = operation?.trim() ? `${label} ${operation.trim()}` : label;
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={disabled || busy}
      aria-label={accessibleName === label ? undefined : accessibleName}
      aria-busy={busy || undefined}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border border-slate-500 bg-white px-3 py-1.5',
        'text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100',
        'disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer',
        FOCUS_RING,
        className,
      )}
    >
      <RotateCw aria-hidden="true" focusable="false" className={cn('h-4 w-4', busy && 'animate-spin')} />
      <span>{label}</span>
    </button>
  );
};
