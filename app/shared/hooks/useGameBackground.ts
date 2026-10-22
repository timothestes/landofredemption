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
import { THEME_PROPERTIES, dominantColor, paletteFromColor } from '../utils/backgroundPalette';

/**
 * One module-level store shared by every table surface (goldfish, multiplayer,
 * pregame, spectate) and the gear-menu setting, so a change in the menu
 * repaints the table behind it. Refetched on every surface mount, because
 * sign-in/out are soft navigations that keep this module alive — a stale
 * store would show the previous account's image to the next one. A custom
 * image is swapped in only after it has fully loaded, so the table never shows
 * a blank or broken background; a failed load keeps what was there.
 *
 * While a table surface is mounted and the custom image is up, the `--gf-*`
 * theme on <html> is retinted to the image's colour (unless the player turned
 * "Match UI Colors" off); it is removed again on unmount, so nothing outside
 * the table ever sees it.
 */
interface State {
  loaded: boolean;
  signedIn: boolean;
  /** Whose row this is; a different id on refetch wipes everything. */
  userId: string | null;
  row: GameBackgroundRow | null;
  /** The custom URL to paint, set only once that image has loaded. */
  displayUrl: string | null;
  /** `--gf-*` overrides derived from displayUrl's image; null = keep the default theme. */
  palette: Record<string, string> | null;
  /** Player preference (localStorage, default on): retint the UI to the image. */
  matchUi: boolean;
  busy: boolean;
  error: string | null;
}

const MATCH_UI_STORAGE_KEY = 'redemption-match-ui-to-background';

function readMatchUi(): boolean {
  try {
    return typeof window === 'undefined' || localStorage.getItem(MATCH_UI_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

let state: State = {
  loaded: false, signedIn: false, userId: null, row: null, displayUrl: null,
  palette: null, matchUi: true, busy: false, error: null,
};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
/** Table surfaces currently mounted; the theme is only applied while > 0. */
let mountedSurfaces = 0;
/** Serialized overrides currently on <html>, '' when none. */
let appliedTheme = '';

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  syncTheme();
  listeners.forEach((l) => l());
}

/** Put the derived palette on <html> exactly when it should be visible, else remove it. */
function syncTheme() {
  if (typeof document === 'undefined') return;
  const on = mountedSurfaces > 0 && state.matchUi && state.displayUrl !== null
    && state.palette !== null && cookieUserId() === state.userId;
  const next = on ? JSON.stringify(state.palette) : '';
  if (next === appliedTheme) return;
  const style = document.documentElement.style;
  for (const prop of THEME_PROPERTIES) style.removeProperty(prop);
  if (on) for (const [prop, value] of Object.entries(state.palette!)) style.setProperty(prop, value);
  appliedTheme = next;
}

/**
 * Sample the loaded image small and derive the theme. A separate CORS-mode
 * load (Blob serves `access-control-allow-origin: *`), so the canvas is not
 * tainted; any failure just leaves the default theme.
 */
function samplePalette(url: string): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 48, 48);
        const color = dominantColor(ctx.getImageData(0, 0, 48, 48).data);
        resolve(color ? paletteFromColor(color) : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const SERVER_STATE = state;

/**
 * Preload `row`'s image, then paint it — unless the row changed meanwhile.
 * Until it loads the previous image stays up (a Replace never flashes the
 * default art); turning the background off clears it at once.
 */
function applyRow(row: GameBackgroundRow | null) {
  if (!row?.enabled) {
    set({ row, displayUrl: null, palette: null });
    return;
  }
  set({ row });
  if (row.url === state.displayUrl) return;
  const img = new Image();
  img.onload = async () => {
    // Image and theme swap together, so the chrome never lags the table.
    const palette = await samplePalette(row.url);
    if (state.row?.url === row.url && state.row.enabled) set({ displayUrl: row.url, palette, error: null });
  };
  img.onerror = () => {
    if (state.row?.url === row.url) set({ error: 'Your background image could not be loaded' });
  };
  img.src = row.url;
}

function switchUser(userId: string | null) {
  if (userId !== state.userId) set({ userId, row: null, displayUrl: null, palette: null, error: null });
}

/**
 * The signed-in user id, read synchronously from the @supabase/ssr auth
 * cookie (`sb-<ref>-auth-token[.N]` = "base64-" + base64url(session JSON)).
 * Lets render refuse to paint an image cached for a different account in the
 * frame before any async session check could run. Null when absent/unreadable.
 */
function cookieUserId(): string | null {
  if (typeof document === 'undefined') return null;
  const chunks = document.cookie.split('; ')
    .map((c) => c.split('='))
    .filter(([name]) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/.test(name))
    .sort(([a], [b]) => (Number(a.split('.')[1] ?? 0) - Number(b.split('.')[1] ?? 0)));
  if (!chunks.length) return null;
  try {
    let raw = decodeURIComponent(chunks.map(([, v]) => v ?? '').join(''));
    if (raw.startsWith('base64-')) raw = atob(raw.slice(7).replace(/-/g, '+').replace(/_/g, '/'));
    const id = (JSON.parse(raw) as { user?: { id?: unknown } }).user?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

function refresh() {
  if (loading || typeof window === 'undefined') return;
  if (readMatchUi() !== state.matchUi) set({ matchUi: !state.matchUi });
  switchUser(cookieUserId());
  loading = getGameBackground()
    .then(({ userId, row }) => {
      switchUser(userId);
      set({ loaded: true, signedIn: userId !== null });
      // An upload/toggle that started meanwhile has the newer row.
      if (!state.busy) applyRow(row);
    })
    .catch(() => set({ loaded: true }))
    .finally(() => { loading = null; });
}

/** CSS `background-image` for the table: the viewer's own image when enabled, else the default art. */
export function useGameBackground(isForge?: boolean): string {
  useEffect(() => {
    mountedSurfaces++;
    refresh();
    syncTheme();
    return () => {
      mountedSurfaces--;
      syncTheme();
    };
  }, []);
  const displayUrl = useSyncExternalStore(
    subscribe,
    () => (state.displayUrl && cookieUserId() === state.userId ? state.displayUrl : null),
    () => SERVER_STATE.displayUrl,
  );
  return gameBackgroundCss(isForge, displayUrl);
}

/** State + actions for the gear-menu background setting. */
export function useGameBackgroundSettings() {
  useEffect(refresh, []);
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
    const blob = await upload(backgroundPathname(user.id, encoded.type, randomNonce()), encoded, {
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

  const setMatchUi = useCallback((matchUi: boolean) => {
    try {
      localStorage.setItem(MATCH_UI_STORAGE_KEY, matchUi ? '1' : '0');
    } catch {
      // Private mode etc.: the choice just lasts for this page.
    }
    set({ matchUi });
  }, []);

  return { ...s, uploadFile, setEnabled, remove, setMatchUi };
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
}
