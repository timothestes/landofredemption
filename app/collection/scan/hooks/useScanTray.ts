'use client';

import { useEffect, useReducer, type Dispatch } from 'react';
import { initialTray, rehydrateTray, trayReducer, type TrayAction, type TrayState } from '../lib/trayReducer';

const keyFor = (userId: string) => `scan-tray:${userId}`;

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
      /* storage unavailable */
    }
  }, [state, userId]);
  return [state, dispatch];
}
