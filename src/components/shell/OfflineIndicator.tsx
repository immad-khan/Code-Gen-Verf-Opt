import React from 'react';
import { WifiOff } from 'lucide-react';
import type { HealthStatus } from '../../state/useHealth';

interface OfflineIndicatorProps {
  status: HealthStatus;
  /** A health check is in flight. */
  checking?: boolean;
  /** Reason of the latest failed check, shown as a tooltip. */
  reason?: string | null;
  /** Runs a health check immediately. */
  onRetry?: () => void;
}

/**
 * Global-header offline indicator (23.7, 23.8). The status wrapper is always
 * mounted so assistive technologies announce the indicator when it appears;
 * it renders nothing while the latest health check succeeded or none has
 * settled yet. Removal happens on the same render as the successful check.
 */
export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ status, checking = false, reason, onRetry }) => {
  const offline = status === 'offline';
  return (
    <div className="flex items-center gap-2">
      <div role="status" aria-live="polite" aria-atomic="true">
        {offline && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-700 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800"
            title={reason ?? undefined}
          >
            <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
            Backend offline
            <span className="sr-only">
              . Verification, repair, and experiment actions are disabled until the connection is restored.
            </span>
          </span>
        )}
      </div>
      {offline && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={checking}
          className="btn-ghost px-2.5 py-1 text-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
        >
          {checking ? 'Checking…' : 'Retry connection'}
        </button>
      )}
    </div>
  );
};
