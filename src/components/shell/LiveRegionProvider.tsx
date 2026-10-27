import React, { useCallback, useState } from 'react';
import {
  announceReducer,
  INITIAL_LIVE_REGION_STATE,
  LiveRegionContext,
  type LiveRegionState,
  type Politeness,
} from './liveRegion';

export { useAnnounce } from './liveRegion';
export type { Announce, Politeness } from './liveRegion';

/**
 * Renders one polite and one assertive ARIA live region (visually hidden) and
 * provides `announce(message, politeness)` to descendants via `useAnnounce()`.
 * Polite: stage completion and status messages (28.12, 25.12).
 * Assertive: stage and request failures (28.13).
 */
export const LiveRegionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<LiveRegionState>(INITIAL_LIVE_REGION_STATE);

  const announce = useCallback((message: string, politeness: Politeness = 'polite') => {
    setState((prev) => announceReducer(prev, message, politeness));
  }, []);

  return (
    <LiveRegionContext.Provider value={announce}>
      {children}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-region-polite">
        {state.polite && <span key={state.polite.id}>{state.polite.message}</span>}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-testid="live-region-assertive">
        {state.assertive && <span key={state.assertive.id}>{state.assertive.message}</span>}
      </div>
    </LiveRegionContext.Provider>
  );
};
