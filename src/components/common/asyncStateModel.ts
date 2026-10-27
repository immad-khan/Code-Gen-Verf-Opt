// Pure helpers behind the common UI state components (Requirement 28).
// Kept free of React so they can be tested in the Node test environment.

import type { ApiErrorView } from '../../api/client';

/** Shared focus ring: 3 px indigo-700 outline (#4338ca, ≥ 7:1 on white and slate-50 surfaces) (28.8). */
export const FOCUS_RING =
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#4338ca]';

/** What a view region should render for a given request state. */
export interface AsyncView {
  showLoading: boolean;
  showError: boolean;
  showEmpty: boolean;
  showContent: boolean;
}

/**
 * Decides which states a view shows.
 *
 * - Loading shows whenever a request is in flight (28.1). The indicator is driven
 *   directly by `loading`, so it appears and disappears on the same render.
 * - An error shows after a failed request (28.4); previously loaded content stays
 *   on screen underneath it (27.11) unless the view has no data.
 * - The empty state shows only when nothing is loading, nothing failed, and there
 *   is no data (28.3).
 */
export function resolveAsyncView(input: {
  loading: boolean;
  error?: ApiErrorView | null;
  isEmpty: boolean;
}): AsyncView {
  const hasError = input.error != null;
  return {
    showLoading: input.loading,
    showError: hasError && !input.loading,
    showEmpty: input.isEmpty && !input.loading && !hasError,
    showContent: !input.isEmpty,
  };
}

/** Short label for the failure class shown as the error-state heading (28.5). */
export function failureKindLabel(kind: ApiErrorView['kind']): string {
  switch (kind) {
    case 'network':
      return 'Network error';
    case 'timeout':
      return 'Network error (timed out)';
    case 'http':
      return 'Server error';
    default:
      return 'Unexpected error';
  }
}

/** Fallback message used when a failed request carries no message (28.5). */
export function fallbackErrorMessage(error: Pick<ApiErrorView, 'kind' | 'status'>): string {
  switch (error.kind) {
    case 'network':
      return 'Network error: the MACI backend could not be reached.';
    case 'timeout':
      return 'Network error: the MACI backend did not respond in time.';
    case 'http':
      return error.status != null
        ? `Server error: the MACI backend returned HTTP ${error.status} without an error message.`
        : 'Server error: the MACI backend returned an error without a message.';
    default:
      return 'Unexpected error: the request failed without an error message.';
  }
}

/**
 * Text for an error state: the backend message when there is one (28.4),
 * otherwise a message stating network vs server error (28.5).
 */
export function errorStateText(error: ApiErrorView): { title: string; message: string } {
  const operation = error.operation.trim();
  const kindLabel = failureKindLabel(error.kind);
  const title = operation ? `${capitalize(operation)} failed: ${lowerFirst(kindLabel)}` : kindLabel;
  const message = error.message.trim() !== '' ? error.message : fallbackErrorMessage(error);
  return { title, message };
}

/**
 * Empty-state sentence naming the data and the Workbench stage or Experiments
 * action that produces it (28.3), e.g.
 * `emptyStateText('verification results', 'the Verify stage')` →
 * "No verification results to show yet. This data comes from the Verify stage."
 */
export function emptyStateText(subject: string, producer: string): string {
  return `No ${subject.trim()} to show yet. This data comes from ${producer.trim()}.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
