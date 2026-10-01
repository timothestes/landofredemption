'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LOST_SOUL_CINEMATIC_STORAGE_KEY,
  parseLostSoulCinematicSetting,
  serializeLostSoulCinematicSetting,
} from '../utils/lostSoulCinematicSetting';

/**
 * Whether the full-screen Lost Soul cinematic plays when souls are dealt into
 * the Land of Bondage. Default on. Persisted in localStorage (same pattern as
 * `useCardScale`) so it carries across games and reloads; toggled from the
 * gear menu (`CardScaleControl`).
 */
export function useLostSoulCinematicSetting() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return parseLostSoulCinematicSetting(localStorage.getItem(LOST_SOUL_CINEMATIC_STORAGE_KEY));
  });

  useEffect(() => {
    localStorage.setItem(LOST_SOUL_CINEMATIC_STORAGE_KEY, serializeLostSoulCinematicSetting(enabled));
  }, [enabled]);

  const toggle = useCallback(() => setEnabled(prev => !prev), []);

  return { enabled, setEnabled, toggle };
}
