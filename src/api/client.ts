// Shared HTTP client for the MACI backend.
//
// Every request has a hard timeout (AbortController) and every failure is
// surfaced as a typed ApiError so views can show an error state naming the
// operation and the reason (23.1, 27.11, 28.4, 28.5). Nothing here ever
// fabricates a result on failure.

export type ApiErrorKind = 'network' | 'timeout' | 'http';

export class ApiError extends Error {
  constructor(
    public readonly kind: ApiErrorKind,
    /** Human-readable name of the failed operation, e.g. "verification". */
    public readonly operation: string,
    /** The failure reason (backend `error` field, or a network/timeout/server description). */
    message: string,
    /** HTTP status for `kind === 'http'`. */
    public readonly status?: number,
    /** Parsed response body for `kind === 'http'`, when there was one. */
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Request timeouts in milliseconds: Workbench 120 s (23.1), Experiments 10 s (27.11), health 5 s (23.6). */
export const TIMEOUTS = { workbench: 120_000, experiments: 10_000, health: 5_000 } as const;

export const DEFAULT_BACKEND_URL =
  import.meta.env.PROD ? 'https://code-gen-verf-opt.onrender.com' : 'http://localhost:5000';

/** Backend base URL from `VITE_BACKEND_URL`, without a trailing slash. Read per call so tests can stub it. */
export function backendBaseUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_URL?.trim();
  return (configured ? configured : DEFAULT_BACKEND_URL).replace(/\/+$/, '');
}

function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s} s` : `${s.toFixed(1)} s`;
}

/** Extracts the backend's `error` field when it is a non-empty string. */
function backendErrorMessage(body: unknown): string | null {
  if (body !== null && typeof body === 'object' && 'error' in body) {
    const value = (body as { error: unknown }).error;
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Sends a request to the MACI backend and returns the parsed JSON body.
 *
 * Throws ApiError:
 * - `timeout` when no complete response arrives within `timeoutMs`;
 * - `network` when the backend cannot be reached;
 * - `http` for non-2xx responses (message = backend `error` field, or a
 *   "Server error" description when the body has none) and for 2xx responses
 *   whose body is not valid JSON.
 *
 * If the caller passes `init.signal` and aborts it, the rejection from fetch
 * (the abort reason, normally an AbortError) is rethrown unchanged so callers
 * can tell cancellation from failure.
 */
export async function apiRequest<T>(
  operation: string,
  path: string,
  init: RequestInit = {},
  timeoutMs: number = TIMEOUTS.workbench,
): Promise<T> {
  const url = `${backendBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const controller = new AbortController();
  const callerSignal = init.signal ?? undefined;
  let timedOut = false;

  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, { ...init, signal: controller.signal });
      // Reading the body is covered by the same timeout.
      text = await response.text();
    } catch (error) {
      if (timedOut) {
        throw new ApiError(
          'timeout',
          operation,
          `Timed out: the MACI backend did not respond within ${formatSeconds(timeoutMs)}.`,
        );
      }
      // Caller-initiated cancellation: rethrow as-is (fetch rejects with the abort reason).
      if (callerSignal?.aborted) throw error;
      throw new ApiError(
        'network',
        operation,
        `Network error: the MACI backend is unreachable at ${backendBaseUrl()}.`,
      );
    }

    const parsed = text.trim() === '' ? { ok: true as const, value: undefined } : parseJson(text);

    if (!response.ok) {
      const body = parsed.ok ? parsed.value : text;
      const message =
        backendErrorMessage(body) ??
        `Server error: the MACI backend returned HTTP ${response.status}${
          response.statusText ? ` ${response.statusText}` : ''
        }.`;
      throw new ApiError('http', operation, message, response.status, body);
    }

    if (!parsed.ok) {
      throw new ApiError(
        'http',
        operation,
        'Server error: the MACI backend returned a response that is not valid JSON.',
        response.status,
        text,
      );
    }
    return parsed.value as T;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

/** Builds a JSON request init. */
export function jsonInit(method: 'POST' | 'PUT' | 'PATCH', body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  };
}

/** Serializable error shape held in UI state (Workbench stages, Experiments views). */
export interface ApiErrorView {
  kind: ApiErrorKind | 'unknown';
  operation: string;
  message: string;
  status?: number;
}

/** Converts any thrown value into an ApiErrorView for display. */
export function toApiErrorView(error: unknown, operation: string): ApiErrorView {
  if (error instanceof ApiError) {
    return { kind: error.kind, operation: error.operation, message: error.message, status: error.status };
  }
  const message = error instanceof Error && error.message ? error.message : String(error);
  return { kind: 'unknown', operation, message };
}
