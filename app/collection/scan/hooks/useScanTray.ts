'use client';

import { useEffect, useReducer, type Dispatch } from 'react';
import { initialTray, rehydrateTray, trayReducer, type TrayAction, type TrayState } from '../lib/trayReducer';

// Bump the version when TrayState's shape changes, so a tab left open across a deploy starts fresh.
const keyFor = (userId: string) => `scan-tray:v2:${userId}`;

export function useScanTray(userId: string): [TrayState, Dispatch<TrayAction>] {
  const [state, dispatch] = useReducer(trayReducer, userId, (uid): TrayState => {
    try {
      return rehydrateTray(sessionStorage.getItem(keyFor(uid)), uid);
    } catch {
      return initialTray(uid);
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(keyFor(userId), JSON.stringify(state));
    } catch {
      // Full or unavailable: drop the old snapshot so a reload cannot restore a tray older than this one.
      try { sessionStorage.removeItem(keyFor(userId)); } catch { /* storage unavailable */ }
    }
  }, [state, userId]);
  return [state, dispatch];
}
