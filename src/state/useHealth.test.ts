import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import {
  createHealthMonitor,
  HEALTH_INTERVAL_MS,
  HEALTH_TIMEOUT_MS,
  healthReducer,
  INITIAL_HEALTH_STATE,
  isOffline,
  type HealthCheck,
  type HealthState,
} from './useHealth';

describe('healthReducer', () => {
  it('starts unknown and not offline', () => {
    expect(INITIAL_HEALTH_STATE.status).toBe('unknown');
    expect(isOffline(INITIAL_HEALTH_STATE)).toBe(false);
  });

  it('reflects only the latest settled check', () => {
    const failed = healthReducer(INITIAL_HEALTH_STATE, {
      type: 'CHECK_FAILED',
      at: 1,
      error: { kind: 'network', operation: 'health check', message: 'down' },
    });
    expect(failed).toMatchObject({ status: 'offline', checking: false, lastCheckedAt: 1 });
    expect(isOffline(failed)).toBe(true);

    // A check in flight does not clear the offline state by itself.
    const checking = healthReducer(failed, { type: 'CHECK_STARTED' });
    expect(checking).toMatchObject({ status: 'offline', checking: true });

    const recovered = healthReducer(checking, { type: 'CHECK_SUCCEEDED', at: 2 });
    expect(recovered).toEqual({ status: 'online', checking: false, lastCheckedAt: 2, error: null });
    expect(isOffline(recovered)).toBe(false);
  });
});

describe('createHealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Check whose outcome is decided per call by `responder`. */
  function scriptedCheck(responder: (call: number, signal: AbortSignal) => Promise<unknown>) {
    const signals: AbortSignal[] = [];
    const check = vi.fn<HealthCheck>((signal) => {
      signals.push(signal);
      return responder(signals.length, signal);
    });
    return { check, signals };
  }

  it('checks on start and every 30 s after that', async () => {
    const { check } = scriptedCheck(() => Promise.resolve({ status: 'ok' }));
    const monitor = createHealthMonitor({ check });
    monitor.start();
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS - 1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS * 2);
    expect(check).toHaveBeenCalledTimes(4);
    expect(monitor.getState().status).toBe('online');
    monitor.stop();
  });

  it('fails a check with no response within 5 s and aborts it', async () => {
    const { check, signals } = scriptedCheck(() => new Promise(() => {}));
    const monitor = createHealthMonitor({ check });
    monitor.start();

    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS - 1);
    expect(monitor.getState()).toMatchObject({ status: 'unknown', checking: true });

    await vi.advanceTimersByTimeAsync(1);
    const state = monitor.getState();
    expect(state.status).toBe('offline');
    expect(state.error).toMatchObject({ kind: 'timeout', operation: 'health check' });
    expect(signals[0].aborted).toBe(true);
    monitor.stop();
  });

  it('goes offline on a failed check and recovers immediately on the next success', async () => {
    let backendUp = false;
    const { check } = scriptedCheck(() =>
      backendUp
        ? Promise.resolve({ status: 'ok' })
        : Promise.reject(new ApiError('network', 'health check', 'Network error: unreachable')),
    );
    const changes: HealthState[] = [];
    const monitor = createHealthMonitor({ check });
    monitor.subscribe((s) => changes.push(s));
    monitor.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getState()).toMatchObject({
      status: 'offline',
      error: { kind: 'network', message: 'Network error: unreachable' },
    });

    backendUp = true;
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS);
    // The success is applied as soon as the response resolves: no timer delay (23.8).
    expect(monitor.getState()).toMatchObject({ status: 'online', error: null });
    expect(changes.map((s) => s.status)).toEqual(['unknown', 'offline', 'offline', 'online']);
    monitor.stop();
  });

  it('a check that resolves after the timeout does not override the failure', async () => {
    let resolveLate!: () => void;
    const { check } = scriptedCheck(
      () =>
        new Promise<void>((resolve) => {
          resolveLate = resolve;
        }),
    );
    const monitor = createHealthMonitor({ check });
    monitor.start();
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);
    expect(monitor.getState().status).toBe('offline');

    resolveLate();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getState().status).toBe('offline');
    monitor.stop();
  });

  it('checkNow joins an in-flight check instead of starting another', async () => {
    let resolveFirst!: () => void;
    const { check } = scriptedCheck(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const monitor = createHealthMonitor({ check });
    monitor.start();
    const joined = monitor.checkNow();
    expect(check).toHaveBeenCalledTimes(1);

    resolveFirst();
    await expect(joined).resolves.toMatchObject({ status: 'online' });
    monitor.stop();
  });

  it('stop cancels the schedule and ignores the in-flight result', async () => {
    let resolveFirst!: () => void;
    const { check, signals } = scriptedCheck(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const monitor = createHealthMonitor({ check });
    monitor.start();
    monitor.stop();
    expect(signals[0].aborted).toBe(true);

    resolveFirst();
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(1);
    expect(monitor.getState()).toMatchObject({ status: 'unknown', checking: false });
  });

  it('treats a synchronously throwing check as a failed check', async () => {
    const monitor = createHealthMonitor({
      check: () => {
        throw new Error('boom');
      },
    });
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getState()).toMatchObject({ status: 'offline', error: { message: 'boom' } });
    monitor.stop();
  });
});
