// Backend health monitoring (23.6–23.8).
//
// A check runs when the UI loads and every 30 s after that. A check fails if no
// successful response arrives within 5 s. While the latest check has failed the
// UI is offline: the header shows the offline indicator and request-starting
// actions are disabled. A successful check after a failed one flips the state
// back to online as soon as the response resolves (well within 1 s), with no
// extra delay or debounce.
//
// The logic is split into a pure reducer (`healthReducer`), a framework-free
// monitor (`createHealthMonitor`, injectable check + clock, unit-tested with
// fake timers), and a thin React hook (`useHealth`).

import { useCallback, useEffect, useRef, useState } from 'react';
import { TIMEOUTS, toApiErrorView, type ApiErrorView } from '../api/client';
import { health as fetchHealth, OPERATIONS } from '../api/endpoints';
import { systemClock, type Clock, type TimerHandle } from './clock';

export const HEALTH_INTERVAL_MS = 30_000;
export const HEALTH_TIMEOUT_MS = TIMEOUTS.health;

/** `unknown` until the first check settles; then the outcome of the latest check. */
export type HealthStatus = 'unknown' | 'online' | 'offline';

export interface HealthState {
  status: HealthStatus;
  /** A check is in flight. */
  checking: boolean;
  /** Clock time when the latest check settled. */
  lastCheckedAt: number | null;
  /** Failure of the latest check; null when it succeeded or none has settled. */
  error: ApiErrorView | null;
}

export type HealthEvent =
  | { type: 'CHECK_STARTED' }
  | { type: 'CHECK_SUCCEEDED'; at: number }
  | { type: 'CHECK_FAILED'; at: number; error: ApiErrorView }
  | { type: 'STOPPED' };

export const INITIAL_HEALTH_STATE: HealthState = {
  status: 'unknown',
  checking: false,
  lastCheckedAt: null,
  error: null,
};

/** Pure state transition: the status always reflects the latest settled check. */
export function healthReducer(state: HealthState, event: HealthEvent): HealthState {
  switch (event.type) {
    case 'CHECK_STARTED':
      return { ...state, checking: true };
    case 'CHECK_SUCCEEDED':
      return { status: 'online', checking: false, lastCheckedAt: event.at, error: null };
    case 'CHECK_FAILED':
      return { status: 'offline', checking: false, lastCheckedAt: event.at, error: event.error };
    case 'STOPPED':
      return state.checking ? { ...state, checking: false } : state;
  }
}

/** True only while the latest check has failed (23.7). */
export function isOffline(state: Pick<HealthState, 'status'>): boolean {
  return state.status === 'offline';
}

/** Performs one health request; must reject on failure. Aborted via `signal` on timeout/stop. */
export type HealthCheck = (signal: AbortSignal) => Promise<unknown>;

export const defaultHealthCheck: HealthCheck = (signal) => fetchHealth({ signal });

export interface HealthMonitorOptions {
  check?: HealthCheck;
  intervalMs?: number;
  timeoutMs?: number;
  clock?: Clock;
}

export interface HealthMonitor {
  /** Runs a check immediately, then every `intervalMs`. No-op if already started. */
  start(): void;
  /** Cancels the schedule and any in-flight check; later results are ignored. */
  stop(): void;
  /** Runs a check now (joins the in-flight one if any) and resolves with the resulting state. */
  checkNow(): Promise<HealthState>;
  getState(): HealthState;
  /** Registers a listener called after every state change. Returns an unsubscribe function. */
  subscribe(listener: (state: HealthState) => void): () => void;
}

function timeoutError(timeoutMs: number): ApiErrorView {
  return {
    kind: 'timeout',
    operation: OPERATIONS.health,
    message: `Timed out: the MACI backend did not answer the health check within ${timeoutMs / 1000} s.`,
  };
}

export function createHealthMonitor(options: HealthMonitorOptions = {}): HealthMonitor {
  const check = options.check ?? defaultHealthCheck;
  const intervalMs = options.intervalMs ?? HEALTH_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const clock = options.clock ?? systemClock;

  let state = INITIAL_HEALTH_STATE;
  const listeners = new Set<(s: HealthState) => void>();
  let running = false;
  /** Bumped on stop() so results of checks started earlier are dropped. */
  let generation = 0;
  let intervalTimer: TimerHandle | null = null;
  let inFlight: { promise: Promise<HealthState>; controller: AbortController } | null = null;

  function dispatch(event: HealthEvent) {
    const next = healthReducer(state, event);
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
  }

  function runCheck(): Promise<HealthState> {
    if (inFlight) return inFlight.promise;
    const gen = generation;
    const controller = new AbortController();
    dispatch({ type: 'CHECK_STARTED' });

    let timer: TimerHandle | null = null;
    let settled = false;
    let resolvePromise!: (s: HealthState) => void;
    const promise = new Promise<HealthState>((resolve) => {
      resolvePromise = resolve;
    });
    const entry = { promise, controller };
    inFlight = entry;

    const finish = (event: HealthEvent) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clock.clearTimeout(timer);
      if (inFlight === entry) inFlight = null;
      if (gen === generation) dispatch(event);
      resolvePromise(state);
    };

    timer = clock.setTimeout(() => {
      controller.abort();
      finish({ type: 'CHECK_FAILED', at: clock.now(), error: timeoutError(timeoutMs) });
    }, timeoutMs);

    let request: Promise<unknown>;
    try {
      request = Promise.resolve(check(controller.signal));
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(
      () => finish({ type: 'CHECK_SUCCEEDED', at: clock.now() }),
      (error: unknown) =>
        finish({ type: 'CHECK_FAILED', at: clock.now(), error: toApiErrorView(error, OPERATIONS.health) }),
    );
    return promise;
  }

  function scheduleNext() {
    intervalTimer = clock.setTimeout(() => {
      intervalTimer = null;
      if (!running) return;
      void runCheck();
      scheduleNext();
    }, intervalMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      void runCheck();
      scheduleNext();
    },
    stop() {
      running = false;
      generation += 1;
      if (intervalTimer !== null) clock.clearTimeout(intervalTimer);
      intervalTimer = null;
      if (inFlight) {
        inFlight.controller.abort();
        inFlight = null;
      }
      dispatch({ type: 'STOPPED' });
    },
    checkNow: runCheck,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export interface UseHealthResult extends HealthState {
  /** Latest check failed: show the offline indicator and disable request-starting actions. */
  offline: boolean;
  /** Runs a check immediately (e.g. from the offline indicator's retry control). */
  checkNow: () => void;
}

/**
 * Monitors backend health for the lifetime of the calling component.
 * `check` and `clock` may change between renders without restarting the schedule;
 * changing `intervalMs` or `timeoutMs` restarts it.
 */
export function useHealth(options: HealthMonitorOptions = {}): UseHealthResult {
  const { intervalMs, timeoutMs } = options;
  const [state, setState] = useState<HealthState>(INITIAL_HEALTH_STATE);
  const checkRef = useRef<HealthCheck>(options.check ?? defaultHealthCheck);
  const clockRef = useRef<Clock>(options.clock ?? systemClock);
  const monitorRef = useRef<HealthMonitor | null>(null);

  useEffect(() => {
    checkRef.current = options.check ?? defaultHealthCheck;
    clockRef.current = options.clock ?? systemClock;
  });

  useEffect(() => {
    const clock = clockRef.current;
    const monitor = createHealthMonitor({
      check: (signal) => checkRef.current(signal),
      intervalMs,
      timeoutMs,
      clock,
    });
    monitorRef.current = monitor;
    const unsubscribe = monitor.subscribe(setState);
    monitor.start();
    return () => {
      unsubscribe();
      monitor.stop();
      if (monitorRef.current === monitor) monitorRef.current = null;
    };
  }, [intervalMs, timeoutMs]);

  const checkNow = useCallback(() => {
    void monitorRef.current?.checkNow();
  }, []);

  return { ...state, offline: isOffline(state), checkNow };
}
