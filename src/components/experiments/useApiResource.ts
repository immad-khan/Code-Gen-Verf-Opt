// Loads one Experiments API resource and keeps the last successfully loaded
// value on screen when a later request fails (27.11). Requests use the
// endpoint's 10 s timeout; `reload()` resends the same request (28.6).

import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiErrorView, type ApiErrorView } from '../../api/client';
import { OPERATIONS } from '../../api/endpoints';

export interface ApiResource<T> {
  data: T | undefined;
  error: ApiErrorView | null;
  loading: boolean;
  reload: () => void;
}

export interface UseApiResourceOptions {
  /** Changing this key sends a new request. */
  requestKey: string;
  /** Changing this key also drops data loaded for the previous key (default: `requestKey`). */
  dataKey?: string;
  enabled?: boolean;
}

interface Snapshot<T> {
  dataKey: string;
  data: T | undefined;
  error: ApiErrorView | null;
  loading: boolean;
}

export function useApiResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  { requestKey, dataKey = requestKey, enabled = true }: UseApiResourceOptions,
): ApiResource<T> {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const [token, setToken] = useState(0);
  const [snap, setSnap] = useState<Snapshot<T>>({ dataKey, data: undefined, error: null, loading: enabled });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const keep = (prev: Snapshot<T>) => (prev.dataKey === dataKey ? prev.data : undefined);
    setSnap((prev) => ({ dataKey, data: keep(prev), error: null, loading: true }));
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSnap({ dataKey, data, error: null, loading: false });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setSnap((prev) => ({
          dataKey,
          data: keep(prev),
          error: toApiErrorView(error, OPERATIONS.experiments),
          loading: false,
        }));
      },
    );
    return () => controller.abort();
  }, [requestKey, dataKey, enabled, token]);

  const reload = useCallback(() => setToken((n) => n + 1), []);
  const current = snap.dataKey === dataKey;
  return {
    data: current ? snap.data : undefined,
    error: current ? snap.error : null,
    loading: enabled && (current ? snap.loading : true),
    reload,
  };
}
