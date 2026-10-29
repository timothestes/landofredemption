'use client';

import { useEffect, useReducer, type Dispatch } from 'react';
import { deckTrayReducer, initialDeckTray, restoreDeckTray, STORAGE_KEY, type DeckTrayAction } from '../lib/deckTrayReducer';
import type { DeckTrayState } from '../types';

/** A saved tray is spent: the deck exists, so coming back starts empty instead of restoring it. */
export const persistAction = (s: DeckTrayState): 'write' | 'clear' => (s.phase === 'saved' ? 'clear' : 'write');

export function useDeckTray(userId: string): [DeckTrayState, Dispatch<DeckTrayAction>] {
  const [state, dispatch] = useReducer(deckTrayReducer, userId, (uid): DeckTrayState => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY(uid));
      return restoreDeckTray(raw === null ? null : JSON.parse(raw), uid);
    } catch {
      return initialDeckTray(uid);
    }
  });
  useEffect(() => {
    try {
      if (persistAction(state) === 'clear') {
        sessionStorage.removeItem(STORAGE_KEY(userId));
        return;
      }
      sessionStorage.setItem(STORAGE_KEY(userId), JSON.stringify(state));
    } catch {
      // Full or unavailable: drop the old snapshot so a reload cannot restore a tray older than this one.
      try { sessionStorage.removeItem(STORAGE_KEY(userId)); } catch { /* storage unavailable */ }
    }
  }, [state, userId]);
  return [state, dispatch];
}
