// Interval polling with stop conditions (design §8; used for repair sessions
// and the Experiments active-run panel, 27.2, 27.10).
//
// The task runs immediately on start and then at a fixed rate of `intervalMs`
// measured from the start of each request; requests never overlap (a slow
// request delays the next one instead of stacking). Polling stops when
// `shouldStop(result)` returns true, when `stop()` is called, or on error if
// `stopOnError` is set. Otherwise errors are reported and polling continues,
// so the view can keep its last data on screen and recover (27.11).

import { useCallback, useEffect, useRef, useState } from 'react';
import { systemClock, type Clock, type TimerHandle } from './clock';

export type PollTask<T> = (signal: AbortSignal) => Promise<T>;
export type PollStopReason = 'condition' | 'error' | 'stopped';

export interface PollerOptions<T> {
  task: PollTask<T>;
  intervalMs: number;
  shouldStop?: (result: T) => boolean;
  stopOnError?: boolean;
  onResult?: (result: T) => void;
  onError?: (error: unknown) => void;
  onStop?: (reason: PollStopReason) => void;
  clock?: Clock;
}

export interface Poller {
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createPoller<T>(options: PollerOptions<T>): Poller {
  const clock = options.clock ?? systemClock;
  let running = false;
  let generation = 0;
  let timer: TimerHandle | null = null;
  let controller: AbortController | null = null;

  function halt(reason: PollStopReason) {
    running = false;
    generation += 1;
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
    options.onStop?.(reason);
  }

  function scheduleAfter(startedAt: number) {
    const delay = Math.max(0, options.intervalMs - (clock.now() - startedAt));
    timer = clock.setTimeout(() => {
      timer = null;
      tick();
    }, delay);
  }

  function tick() {
    if (!running) return;
    const gen = generation;
    const startedAt = clock.now();
    const current = new AbortController();
    controller = current;

    let request: Promise<T>;
    try {
      request = Promise.resolve(options.task(current.signal));
    } catch (error) {
      request = Promise.reject(error);
    }
    request.then(
      (result) => {
        if (gen !== generation) return;
        controller = null;
        options.onResult?.(result);
        if (gen !== generation) return; // onResult may have stopped the poller
        if (options.shouldStop?.(result)) halt('condition');
        else scheduleAfter(startedAt);
      },
      (error: unknown) => {
        if (gen !== generation) return;
        controller = null;
        options.onError?.(error);
        if (gen !== generation) return;
        if (options.stopOnError) halt('error');
        else scheduleAfter(startedAt);
      },
    );
  }

  return {
    start() {
      if (running) return;
      running = true;
      tick();
    },
    stop() {
      if (running) halt('stopped');
    },
    isRunning: () => running,
  };
}

export interface UsePollingOptions<T> {
  intervalMs: number;
  /** Polling runs while true (default true). */
  enabled?: boolean;
  /** Restarts polling and hides data from a previous key (e.g. a run or session ID). */
  key?: string | number | null;
  shouldStop?: (result: T) => boolean;
  stopOnError?: boolean;
  clock?: Clock;
}

export interface UsePollingResult<T> {
  /** Latest result for the current key; kept on screen across later errors. */
  data: T | undefined;
  /** Error of the latest request, cleared by the next success. */
  error: unknown;
  polling: boolean;
  stopReason: PollStopReason | null;
  /** Restarts polling for the current key, keeping the data already shown. */
  restart: () => void;
}

interface PollingSnapshot<T> {
  key: string | number | null;
  data: T | undefined;
  error: unknown;
  polling: boolean;
  stopReason: PollStopReason | null;
}

export function usePolling<T>(task: PollTask<T>, options: UsePollingOptions<T>): UsePollingResult<T> {
  const { intervalMs, enabled = true, key = null, stopOnError = false } = options;
  const taskRef = useRef(task);
  const shouldStopRef = useRef(options.shouldStop);
  const clockRef = useRef<Clock>(options.clock ?? systemClock);
  const [restartToken, setRestartToken] = useState(0);
  const [snapshot, setSnapshot] = useState<PollingSnapshot<T>>({
    key,
    data: undefined,
    error: null,
    polling: false,
    stopReason: null,
  });

  useEffect(() => {
    taskRef.current = task;
    shouldStopRef.current = options.shouldStop;
    clockRef.current = options.clock ?? systemClock;
  });

  useEffect(() => {
    if (!enabled) return;
    const update = (patch: Partial<PollingSnapshot<T>>) =>
      setSnapshot((prev) => {
        const base = prev.key === key ? prev : { key, data: undefined, error: null, polling: false, stopReason: null };
        return { ...base, ...patch, key };
      });

    const poller = createPoller<T>({
      task: (signal) => taskRef.current(signal),
      intervalMs,
      shouldStop: (result) => shouldStopRef.current?.(result) ?? false,
      stopOnError,
      clock: clockRef.current,
      onResult: (data) => update({ data, error: null }),
      onError: (error) => update({ error }),
      onStop: (reason) => update({ polling: false, stopReason: reason }),
    });
    update({ polling: true, stopReason: null });
    poller.start();
    return () => {
      poller.stop();
    };
  }, [enabled, intervalMs, key, stopOnError, restartToken]);

  const restart = useCallback(() => setRestartToken((n) => n + 1), []);
  const current = snapshot.key === key;

  return {
    data: current ? snapshot.data : undefined,
    error: current ? snapshot.error : null,
    polling: current ? snapshot.polling : false,
    stopReason: current ? snapshot.stopReason : null,
    restart,
  };
}
