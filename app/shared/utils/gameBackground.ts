/**
 * Pure rules for the per-player custom game background. A player's upload is
 * only ever shown to that player (and to them while spectating) — nothing here
 * travels through SpacetimeDB. DOM-free so the URL gate is unit-testable; the
 * browser store is `useGameBackground`, the writes are `app/play/backgroundActions.ts`.
 */

/** Blob folder every upload lives under: `game-backgrounds/<userId>/…`. */
export const GAME_BACKGROUND_PREFIX = 'game-backgrounds';

/** Encoded output the browser produces and the token route accepts. */
export const GAME_BACKGROUND_TYPES = ['image/webp', 'image/jpeg'] as const;
/** Cap on the re-encoded file. A 2560px WebP at q0.85 is well under this. */
export const GAME_BACKGROUND_MAX_BYTES = 4 * 1024 * 1024;
/** Cap on the picked file before we try to decode it (phone photos run 4-12 MB). */
export const GAME_BACKGROUND_MAX_INPUT_BYTES = 30 * 1024 * 1024;
/** Longest side after the browser resize. */
export const GAME_BACKGROUND_MAX_EDGE = 2560;

/** Darkening laid over a custom image so cards and zone outlines stay readable. */
export const GAME_BACKGROUND_DIM = 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45))';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Strict on purpose: the URL is interpolated into a CSS `url("…")`, so the
// allowed alphabet can never contain a quote, paren, backslash or whitespace,
// and only our own public Blob store is accepted (no third-party hosts that
// could log the viewer's IP). Mirrored by the CHECK in migration 117.
const URL_RE =
  /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/game-backgrounds\/([0-9a-f-]{36})\/[A-Za-z0-9_-]+\.(webp|jpg)$/;

/** True when `url` is a background upload belonging to `userId` (any user when omitted). */
export function isAllowedBackgroundUrl(url: unknown, userId?: string): url is string {
  if (typeof url !== 'string') return false;
  const m = URL_RE.exec(url);
  if (!m) return false;
  return userId === undefined || m[1] === userId.toLowerCase();
}

/** The pathname the browser uploads to; the token route requires this shape. */
export function backgroundPathname(userId: string, contentType: string): string {
  if (!UUID_RE.test(userId)) throw new Error('Bad user id');
  const ext = contentType === 'image/webp' ? 'webp' : 'jpg';
  return `${GAME_BACKGROUND_PREFIX}/${userId.toLowerCase()}/background.${ext}`;
}

/** True when `pathname` is a valid upload target for `userId`. */
export function isOwnBackgroundPathname(pathname: string, userId: string): boolean {
  return /^game-backgrounds\/[0-9a-f-]{36}\/background\.(webp|jpg)$/.test(pathname)
    && pathname.startsWith(`${GAME_BACKGROUND_PREFIX}/${userId.toLowerCase()}/`);
}

/** The built-in table art: Forge decks get the forge, everything else the cave. */
export function defaultBackgroundUrl(isForge?: boolean): string {
  return `/gameplay/${isForge ? 'forge_background' : 'cave_background'}.png`;
}

/**
 * CSS `background-image` for the table. A custom URL is used only when it
 * passes the gate — anything else (including a hand-edited row) falls back to
 * the default art rather than reaching the stylesheet.
 */
export function gameBackgroundCss(isForge: boolean | undefined, customUrl: string | null | undefined): string {
  if (isAllowedBackgroundUrl(customUrl)) return `${GAME_BACKGROUND_DIM}, url("${customUrl}")`;
  return `url(${defaultBackgroundUrl(isForge)})`;
}

/** Scale (w, h) down so the longest side is at most `maxEdge`; never upscales. */
export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { width: w, height: h };
  const k = maxEdge / longest;
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}
