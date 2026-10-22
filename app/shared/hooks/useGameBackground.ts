'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { upload } from '@vercel/blob/client';
import {
  getGameBackground,
  removeGameBackground,
  saveGameBackground,
  setGameBackgroundEnabled,
  type GameBackgroundRow,
} from '@/app/play/backgroundActions';
import { createClient } from '@/utils/supabase/client';
import { backgroundPathname, gameBackgroundCss } from '../utils/gameBackground';
import { encodeGameBackground } from '../utils/encodeGameBackground';

/**
 * One module-level store shared by every table surface (goldfish, multiplayer,
 * pregame, spectate) and the gear-menu setting, so a change in the menu
 * repaints the table behind it. Loaded once per page session; the custom image
 * is swapped in only after it has fully loaded, so the table never shows a
 * blank or broken background — a failed load just keeps the default art.
 */
interface State {
  loaded: boolean;
  signedIn: boolean;
  row: GameBackgroundRow | null;
  /** The custom URL to paint, set only once that image has loaded. */
  displayUrl: string | null;
  busy: boolean;
  error: string | null;
}

let state: State = { loaded: false, signedIn: false, row: null, displayUrl: null, busy: false, error: null };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const SERVER_STATE = state;

/** Preload `row`'s image, then paint it — unless the row changed meanwhile. */
function applyRow(row: GameBackgroundRow | null) {
  set({ row, displayUrl: row?.enabled && row.url === state.displayUrl ? row.url : null });
  if (!row?.enabled || row.url === state.displayUrl) return;
  const img = new Image();
  img.onload = () => {
    if (state.row?.url === row.url && state.row.enabled) set({ displayUrl: row.url });
  };
  img.onerror = () => {
    if (state.row?.url === row.url) set({ error: 'Your background image could not be loaded' });
  };
  img.src = row.url;
}

function ensureLoaded() {
  if (loading || typeof window === 'undefined') return;
  loading = getGameBackground()
    .then(({ signedIn, row }) => {
      set({ loaded: true, signedIn });
      applyRow(row);
    })
    .catch(() => set({ loaded: true }));
}

/** CSS `background-image` for the table: the viewer's own image when enabled, else the default art. */
export function useGameBackground(isForge?: boolean): string {
  useEffect(ensureLoaded, []);
  const displayUrl = useSyncExternalStore(subscribe, () => state.displayUrl, () => SERVER_STATE.displayUrl);
  return gameBackgroundCss(isForge, displayUrl);
}

/** State + actions for the gear-menu background setting. */
export function useGameBackgroundSettings() {
  useEffect(ensureLoaded, []);
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);

  const run = useCallback(async (fn: () => Promise<void>) => {
    if (state.busy) return;
    set({ busy: true, error: null });
    try {
      await fn();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Something went wrong' });
    } finally {
      set({ busy: false });
    }
  }, []);

  const uploadFile = useCallback((file: File) => run(async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Sign in to set a background');
    const encoded = await encodeGameBackground(file);
    const blob = await upload(backgroundPathname(user.id, encoded.type), encoded, {
      access: 'public',
      handleUploadUrl: '/api/game-background/upload',
      contentType: encoded.type,
    });
    const saved = await saveGameBackground(blob.url);
    if (saved.ok === false) throw new Error(saved.error);
    applyRow(saved.value);
  }), [run]);

  const setEnabled = useCallback((enabled: boolean) => run(async () => {
    const row = state.row;
    if (!row) return;
    const res = await setGameBackgroundEnabled(enabled);
    if (res.ok === false) throw new Error(res.error);
    applyRow({ ...row, enabled });
  }), [run]);

  const remove = useCallback(() => run(async () => {
    const res = await removeGameBackground();
    if (res.ok === false) throw new Error(res.error);
    applyRow(null);
  }), [run]);

  return { ...s, uploadFile, setEnabled, remove };
}
