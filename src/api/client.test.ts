// API client tests with a fake fetch (23.1, 28.4, 28.5).
//
// The fake fetch honours the request's AbortSignal the same way the real one
// does (rejecting with `signal.reason`), so timeout and cancellation paths run
// through the real AbortController logic in `apiRequest`. Timeouts use fake
// timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiRequest,
  backendBaseUrl,
  DEFAULT_BACKEND_URL,
  jsonInit,
  TIMEOUTS,
  toApiErrorView,
} from './client';
import { createRepairSession, experiments, getRepairSession, health, OPERATIONS, verify } from './endpoints';

const BASE = 'http://127.0.0.1:5099';

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Installs `impl` as the global fetch and returns the spy. */
function stubFetch(impl: FetchImpl) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

/** A fetch that never responds; it rejects with the abort reason when its signal fires. */
function hangingFetch() {
  return stubFetch(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
}

function jsonResponse(body: unknown, status = 200, statusText?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Runs the request and resolves with whatever it rejected with (fails the test if it resolves). */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => {
      throw new Error(`expected rejection, got ${JSON.stringify(value)}`);
    },
    (error: unknown) => error,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_BACKEND_URL', BASE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('configuration', () => {
  it('uses the design timeouts (120 s / 10 s / 5 s)', () => {
    expect(TIMEOUTS).toEqual({ workbench: 120_000, experiments: 10_000, health: 5_000 });
  });

  it('reads the base URL from VITE_BACKEND_URL, trims trailing slashes, and defaults to localhost', () => {
    vi.stubEnv('VITE_BACKEND_URL', '');
    expect(backendBaseUrl()).toBe(DEFAULT_BACKEND_URL);
    vi.stubEnv('VITE_BACKEND_URL', '   ');
    expect(backendBaseUrl()).toBe(DEFAULT_BACKEND_URL);
    vi.stubEnv('VITE_BACKEND_URL', 'http://127.0.0.1:5099//');
    expect(backendBaseUrl()).toBe('http://127.0.0.1:5099');
  });
});

describe('apiRequest success parsing', () => {
  it('returns the parsed JSON body and joins base URL and path', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({ gatePassed: true, files: [{ fileName: 'a.cs' }] }));

    const result = await apiRequest<{ gatePassed: boolean }>('verification', 'api/verification');

    expect(result).toEqual({ gatePassed: true, files: [{ fileName: 'a.cs' }] });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/verification`);
  });

  it('returns undefined for an empty 2xx body (e.g. 202/204)', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    await expect(apiRequest('repair', '/api/x')).resolves.toBeUndefined();
  });

  it('treats a 2xx response whose body is not JSON as a server (http) error', async () => {
    stubFetch(async () => new Response('<html>proxy page</html>', { status: 200 }));

    const error = await rejectionOf(apiRequest('verification', '/api/verification'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'http', operation: 'verification', status: 200, body: '<html>proxy page</html>' });
    expect((error as ApiError).message).toMatch(/^Server error/);
    expect((error as ApiError).message).toContain('not valid JSON');
  });

  it('does not pass the caller signal straight through but still sends method, headers and body', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({ ok: true }));
    const caller = new AbortController();

    await apiRequest('repair', '/api/x', jsonInit('POST', { a: 1 }, caller.signal));

    const init = fetchSpy.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal).not.toBe(caller.signal);
  });
});

describe('apiRequest HTTP errors', () => {
  it('uses the backend `error` field as the message and keeps status and body', async () => {
    const body = { error: 'files must not be empty', invalidFields: ['files'] };
    stubFetch(async () => jsonResponse(body, 400, 'Bad Request'));

    const error = await rejectionOf(apiRequest('verification', '/api/verification'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: 'http',
      operation: 'verification',
      status: 400,
      message: 'files must not be empty',
      body,
    });
  });

  it('falls back to a "Server error … HTTP <status>" message when the body has no error field', async () => {
    stubFetch(async () => jsonResponse({ detail: 'something' }, 500, 'Internal Server Error'));

    const error = (await rejectionOf(apiRequest('repair', '/api/x'))) as ApiError;

    expect(error.kind).toBe('http');
    expect(error.status).toBe(500);
    expect(error.message).toBe('Server error: the MACI backend returned HTTP 500 Internal Server Error.');
  });

  it.each([
    ['an empty body', () => new Response(null, { status: 502 }), 502],
    ['a non-JSON body', () => new Response('Bad gateway', { status: 503 }), 503],
    ['a blank error field', () => jsonResponse({ error: '   ' }, 409), 409],
    ['a non-string error field', () => jsonResponse({ error: { code: 1 } }, 422), 422],
  ])('falls back to the server-error message for %s', async (_label, makeResponse, status) => {
    stubFetch(async () => makeResponse());

    const error = (await rejectionOf(apiRequest('experiments', '/api/x', {}, TIMEOUTS.experiments))) as ApiError;

    expect(error).toMatchObject({ kind: 'http', operation: 'experiments', status });
    expect(error.message).toBe(`Server error: the MACI backend returned HTTP ${status}.`);
  });
});

describe('apiRequest network errors', () => {
  it('maps a fetch rejection to a network ApiError naming the backend URL', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const error = (await rejectionOf(apiRequest('verification', '/api/verification'))) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('network');
    expect(error.operation).toBe('verification');
    expect(error.status).toBeUndefined();
    expect(error.message).toBe(`Network error: the MACI backend is unreachable at ${BASE}.`);
  });
});

describe('apiRequest timeouts', () => {
  it.each([
    ['workbench', TIMEOUTS.workbench, '120 s'],
    ['experiments', TIMEOUTS.experiments, '10 s'],
    ['health', TIMEOUTS.health, '5 s'],
  ])('times out after exactly the %s timeout', async (_label, timeoutMs, shown) => {
    vi.useFakeTimers();
    hangingFetch();
    let settled = false;
    const pending = rejectionOf(apiRequest('repair', '/api/x', {}, timeoutMs)).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const error = (await pending) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('timeout');
    expect(error.operation).toBe('repair');
    expect(error.message).toBe(`Timed out: the MACI backend did not respond within ${shown}.`);
  });

  it('formats a fractional timeout with one decimal', async () => {
    vi.useFakeTimers();
    hangingFetch();
    const pending = rejectionOf(apiRequest('health check', '/api/health', {}, 2_500));
    await vi.advanceTimersByTimeAsync(2_500);
    expect(((await pending) as ApiError).message).toContain('within 2.5 s');
  });

  it('applies the timeout while reading the response body', async () => {
    vi.useFakeTimers();
    stubFetch(async (_input, init) => {
      const signal = init!.signal!;
      // Headers arrive at once, but the body stalls until aborted.
      const stalled = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(stalled, { status: 200 });
    });

    const pending = rejectionOf(apiRequest('verification', '/api/verification', {}, 1_000));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toMatchObject({ kind: 'timeout', operation: 'verification' });
  });

  it('clears the timer once a response arrives', async () => {
    vi.useFakeTimers();
    stubFetch(async () => jsonResponse({ ok: true }));

    await expect(apiRequest('repair', '/api/x', {}, 1_000)).resolves.toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('apiRequest caller cancellation', () => {
  it('rethrows the caller abort reason unchanged (not an ApiError)', async () => {
    vi.useFakeTimers();
    hangingFetch();
    const caller = new AbortController();
    const reason = new DOMException('user cancelled', 'AbortError');

    const pending = rejectionOf(apiRequest('repair', '/api/x', { signal: caller.signal }, 1_000));
    caller.abort(reason);
    const error = await pending;

    expect(error).toBe(reason);
    expect(error).not.toBeInstanceOf(ApiError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rethrows the default AbortError when the caller aborts without a reason', async () => {
    hangingFetch();
    const caller = new AbortController();

    const pending = rejectionOf(apiRequest('repair', '/api/x', { signal: caller.signal }));
    caller.abort();

    const error = await pending;
    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('rejects immediately with the reason when the caller signal is already aborted', async () => {
    const fetchSpy = hangingFetch();
    const caller = new AbortController();
    const reason = new Error('stale request');
    caller.abort(reason);

    await expect(apiRequest('repair', '/api/x', { signal: caller.signal })).rejects.toBe(reason);
    expect(fetchSpy.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
});

describe('toApiErrorView', () => {
  it('keeps kind, operation, message and status of an ApiError', () => {
    const view = toApiErrorView(new ApiError('http', 'verification', 'bad files', 400, { error: 'bad files' }), 'other');
    expect(view).toEqual({ kind: 'http', operation: 'verification', message: 'bad files', status: 400 });
  });

  it('wraps unknown errors with the given operation', () => {
    expect(toApiErrorView(new Error('boom'), 'repair')).toEqual({ kind: 'unknown', operation: 'repair', message: 'boom' });
    expect(toApiErrorView('plain string', 'repair')).toEqual({
      kind: 'unknown',
      operation: 'repair',
      message: 'plain string',
    });
  });

  it('is plain serializable data', () => {
    const view = toApiErrorView(new ApiError('timeout', 'health check', 'Timed out'), 'x');
    expect(JSON.parse(JSON.stringify(view))).toEqual({ kind: 'timeout', operation: 'health check', message: 'Timed out' });
  });
});

describe('endpoints', () => {
  it('posts files to /api/verification and names the operation in errors', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({ gatePassed: true }));

    await expect(verify([])).resolves.toEqual({ gatePassed: true });
    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/verification`);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ files: [] }) });

    stubFetch(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(verify([])).rejects.toMatchObject({ kind: 'network', operation: OPERATIONS.verify });
  });

  it('encodes path segments for repair sessions and experiments', async () => {
    const fetchSpy = stubFetch(async () => jsonResponse({}));

    await getRepairSession('a/b c');
    await experiments.getTrajectories('run#1', 3);

    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE}/api/optimization/repair-sessions/a%2Fb%20c`);
    expect(fetchSpy.mock.calls[1][0]).toBe(`${BASE}/api/experiments/runs/run%231/trajectories?page=3`);
  });

  it.each([
    ['verify', () => verify([]), TIMEOUTS.workbench, OPERATIONS.verify],
    [
      'createRepairSession',
      () => createRepairSession({} as Parameters<typeof createRepairSession>[0]),
      TIMEOUTS.workbench,
      OPERATIONS.repair,
    ],
    ['health', () => health(), TIMEOUTS.health, OPERATIONS.health],
    ['experiments.listRuns', () => experiments.listRuns(), TIMEOUTS.experiments, OPERATIONS.experiments],
    ['experiments.cancelRun', () => experiments.cancelRun('r1'), TIMEOUTS.experiments, OPERATIONS.experiments],
  ])('%s uses its configured timeout and operation name', async (_label, call, timeoutMs, operation) => {
    vi.useFakeTimers();
    hangingFetch();
    let settled = false;
    const pending = rejectionOf(call()).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toMatchObject({ kind: 'timeout', operation });
  });

  it('surfaces the backend error for a rejected experiment start (409)', async () => {
    stubFetch(async () => jsonResponse({ error: 'a run is already active', activeRunId: 'r9' }, 409));

    const error = (await rejectionOf(experiments.startRun({} as Parameters<typeof experiments.startRun>[0]))) as ApiError;

    expect(error).toMatchObject({ kind: 'http', status: 409, operation: OPERATIONS.experiments });
    expect(error.message).toBe('a run is already active');
    expect(error.body).toEqual({ error: 'a run is already active', activeRunId: 'r9' });
  });

  it('forwards the caller signal so endpoint calls can be cancelled', async () => {
    hangingFetch();
    const caller = new AbortController();
    const reason = new Error('navigated away');

    const pending = rejectionOf(experiments.listDatasets({ signal: caller.signal }));
    caller.abort(reason);

    expect(await pending).toBe(reason);
  });
});
