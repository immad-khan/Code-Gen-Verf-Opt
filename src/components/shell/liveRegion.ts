// Live-region announcement model (28.12, 28.13).
//
// Each announce() call produces a new announcement with a fresh id. The
// provider renders the message in a keyed element, so a repeated identical
// message still replaces the region's content and is announced again, while a
// re-render without a new call announces nothing.

import { createContext, useContext } from 'react';

export type Politeness = 'polite' | 'assertive';

export interface Announcement {
  id: number;
  message: string;
}

export interface LiveRegionState {
  polite: Announcement | null;
  assertive: Announcement | null;
  nextId: number;
}

export const INITIAL_LIVE_REGION_STATE: LiveRegionState = { polite: null, assertive: null, nextId: 1 };

/** Pure transition for one announce() call. Blank messages are ignored. */
export function announceReducer(state: LiveRegionState, message: string, politeness: Politeness): LiveRegionState {
  const text = message.trim();
  if (text === '') return state;
  return { ...state, [politeness]: { id: state.nextId, message: text }, nextId: state.nextId + 1 };
}

export type Announce = (message: string, politeness?: Politeness) => void;

/** No-op outside a LiveRegionProvider so components can render standalone. */
export const LiveRegionContext = createContext<Announce>(() => {});

/** Returns `announce(message, 'polite' | 'assertive')`. */
export function useAnnounce(): Announce {
  return useContext(LiveRegionContext);
}
