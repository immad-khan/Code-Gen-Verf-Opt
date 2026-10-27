import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPoller, type PollStopReason, type PollTask } from './usePolling';

describe('createPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls immediately, then every interval, and stops when the condition holds', async () => {
    const statuses = ['running', 'running', 'completed'];
    let calls = 0;
    const task = vi.fn<PollTask<string>>(() => Promise.resolve(statuses[calls++]));
    const results: string[] = [];
    const stops: PollStopReason[] = [];
    const poller = createPoller({
      task,
      intervalMs: 2000,
      shouldStop: (s) => s !== 'running',
      onResult: (s) => results.push(s),
      onStop: (r) => stops.push(r),
    });
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(results).toEqual(['running']);

    await vi.advanceTimersByTimeAsync(1999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(results).toEqual(['running', 'running', 'completed']);
    expect(stops).toEqual(['condition']);
    expect(poller.isRunning()).toBe(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it('never overlaps requests; a slow request delays the next one', async () => {
    const task = vi.fn<PollTask<number>>(
      () => new Promise((resolve) => setTimeout(() => resolve(1), 3000)),
    );
    const poller = createPoller({ task, intervalMs: 2000 });
    poller.start();

    await vi.advanceTimersByTimeAsync(2999);
    expect(task).toHaveBeenCalledTimes(1);
    // Request took longer than the interval: the next one starts right after it.
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
    // The follow-up timer has delay 0, which Node (and the fake clock) runs after 1 ms.
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('reports errors and keeps polling unless stopOnError is set', async () => {
    const errors: unknown[] = [];
    const failing = vi.fn<PollTask<number>>(() => Promise.reject(new Error('unreachable')));
    const keepGoing = createPoller({ task: failing, intervalMs: 1000, onError: (e) => errors.push(e) });
    keepGoing.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(failing).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(3);
    keepGoing.stop();

    const stops: PollStopReason[] = [];
    const failingOnce = vi.fn<PollTask<number>>(() => Promise.reject(new Error('unreachable')));
    const stopping = createPoller({
      task: failingOnce,
      intervalMs: 1000,
      stopOnError: true,
      onStop: (r) => stops.push(r),
    });
    stopping.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(failingOnce).toHaveBeenCalledTimes(1);
    expect(stops).toEqual(['error']);
  });

  it('stop aborts the in-flight request and drops its result', async () => {
    let signal!: AbortSignal;
    let resolve!: (n: number) => void;
    const onResult = vi.fn();
    const poller = createPoller<number>({
      task: (s) => {
        signal = s;
        return new Promise((r) => {
          resolve = r;
        });
      },
      intervalMs: 1000,
      onResult,
    });
    poller.start();
    poller.stop();
    expect(signal.aborted).toBe(true);
    resolve(42);
    await vi.advanceTimersByTimeAsync(5000);
    expect(onResult).not.toHaveBeenCalled();
  });
});
