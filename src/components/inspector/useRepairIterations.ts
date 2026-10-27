// Loads the executed iterations of a repair session for the Repair Inspector.
//
// Iterations already present in the session view (`preloaded`) are used as-is;
// any executed iteration (1..iterationsCompleted) that is missing is fetched
// from GET /api/optimization/repair-sessions/{id}/iterations/{n}. A failed load
// keeps every iteration already loaded and waits for retry() (26.9).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getRepairIteration } from '../../api/endpoints';
import type { RepairIteration } from '../../api/types';
import {
  loadIterations,
  mergeIterations,
  missingIterations,
  type IterationLoader,
  type IterationLoadFailure,
} from './inspectorModel';

export interface UseRepairIterationsOptions {
  sessionId: string;
  iterationsCompleted: number;
  preloaded?: readonly RepairIteration[];
  loader?: IterationLoader;
}

export interface UseRepairIterationsResult {
  /** Loaded iterations in ascending order. */
  iterations: RepairIteration[];
  loading: boolean;
  failure: IterationLoadFailure | null;
  /** Resends the failed request and continues with the remaining iterations. */
  retry: () => void;
}

interface LoadState {
  sessionId: string;
  loaded: RepairIteration[];
  loading: boolean;
  failure: IterationLoadFailure | null;
}

const EMPTY: readonly RepairIteration[] = [];

export function useRepairIterations({
  sessionId,
  iterationsCompleted,
  preloaded = EMPTY,
  loader = getRepairIteration,
}: UseRepairIterationsOptions): UseRepairIterationsResult {
  const [state, setState] = useState<LoadState>({ sessionId, loaded: [], loading: false, failure: null });
  const [attempt, setAttempt] = useState(0);
  const current = state.sessionId === sessionId;

  const iterations = useMemo(
    () => mergeIterations(preloaded, current ? state.loaded : EMPTY),
    [preloaded, current, state.loaded],
  );

  const iterationsRef = useRef(iterations);
  const loaderRef = useRef(loader);
  const failedRef = useRef(false);
  useEffect(() => {
    iterationsRef.current = iterations;
    loaderRef.current = loader;
    failedRef.current = current && state.failure !== null;
  });

  const preloadedKey = preloaded.map((it) => it.iteration).join(',');

  useEffect(() => {
    // After a failure, wait for retry() instead of re-requesting on every update.
    if (failedRef.current) return;
    const missing = missingIterations(iterationsRef.current, iterationsCompleted);
    if (missing.length === 0) return;

    const controller = new AbortController();
    const reset = (prev: LoadState): LoadState =>
      prev.sessionId === sessionId ? prev : { sessionId, loaded: [], loading: false, failure: null };

    setState((prev) => ({ ...reset(prev), loading: true, failure: null }));
    void loadIterations(
      sessionId,
      missing,
      loaderRef.current,
      (loaded) => setState((prev) => ({ ...reset(prev), loaded: mergeIterations(reset(prev).loaded, [loaded]) })),
      controller.signal,
    ).then((outcome) => {
      if (outcome.status === 'aborted') return;
      failedRef.current = outcome.status === 'failed';
      setState((prev) => ({
        ...reset(prev),
        loading: false,
        failure: outcome.status === 'failed' ? outcome.failure : null,
      }));
    });
    return () => {
      controller.abort();
      setState((prev) => (prev.sessionId === sessionId && prev.loading ? { ...prev, loading: false } : prev));
    };
  }, [sessionId, iterationsCompleted, preloadedKey, attempt]);

  const retry = useCallback(() => {
    failedRef.current = false;
    setState((prev) => ({ ...prev, failure: null }));
    setAttempt((n) => n + 1);
  }, []);

  return {
    iterations,
    loading: current && state.loading,
    failure: current ? state.failure : null,
    retry,
  };
}
