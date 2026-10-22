import { describe, expect, it } from 'vitest';
import {
  backgroundPathname,
  fitWithin,
  gameBackgroundCss,
  isAllowedBackgroundUrl,
  isOwnBackgroundPathname,
  parseBackgroundHint,
  serializeBackgroundHint,
  GAME_BACKGROUND_PENDING_CSS,
} from '../gameBackground';

const UID = '0b9a2f4c-1d2e-4f3a-9b8c-7d6e5f4a3b2c';
const OTHER = '11111111-2222-4333-8444-555555555555';
const HOST = 'https://qrpnuz0u6exnvyt8.public.blob.vercel-storage.com';
const good = `${HOST}/game-backgrounds/${UID}/background-AbC123xyz.webp`;
const NONCE = 'aB3dE5gH7jK9mN1p';

describe('isAllowedBackgroundUrl', () => {
  it('accepts an upload in the owner folder', () => {
    expect(isAllowedBackgroundUrl(good)).toBe(true);
    expect(isAllowedBackgroundUrl(good, UID)).toBe(true);
    expect(isAllowedBackgroundUrl(`${HOST}/game-backgrounds/${UID}/background-x.jpg`, UID)).toBe(true);
  });

  it('rejects another user folder when an owner is given', () => {
    expect(isAllowedBackgroundUrl(good, OTHER)).toBe(false);
  });

  it('rejects anything that could break out of url("…") or leave our store', () => {
    for (const bad of [
      `${good}")`,
      `${HOST}/game-backgrounds/${UID}/a b.webp`,
      `${HOST}/game-backgrounds/${UID}/a'.webp`,
      `${HOST}/game-backgrounds/${UID}/a).webp`,
      `${HOST}/game-backgrounds/${UID}/a.svg`,
      `${HOST}/game-backgrounds/${UID}/a.webp?x=1`,
      `${HOST}/posts/${UID}/a.webp`,
      `http://qrpnuz0u6exnvyt8.public.blob.vercel-storage.com/game-backgrounds/${UID}/a.webp`,
      `https://evil.example/game-backgrounds/${UID}/a.webp`,
      `https://x.public.blob.vercel-storage.com.evil.example/game-backgrounds/${UID}/a.webp`,
      `https://someoneelse.public.blob.vercel-storage.com/game-backgrounds/${UID}/a.webp`,
      `${HOST}/game-backgrounds/${UID}/../${OTHER}/a.webp`,
      'javascript:alert(1)',
      null,
      undefined,
      42,
    ]) {
      expect(isAllowedBackgroundUrl(bad), String(bad)).toBe(false);
    }
  });
});

describe('gameBackgroundCss', () => {
  it('uses the default art without a valid custom URL', () => {
    expect(gameBackgroundCss(false, null)).toBe('url(/gameplay/cave_background.png)');
    expect(gameBackgroundCss(true, undefined)).toBe('url(/gameplay/forge_background.png)');
    expect(gameBackgroundCss(false, `${good}")`)).toBe('url(/gameplay/cave_background.png)');
  });

  it('dims a custom image', () => {
    const css = gameBackgroundCss(true, good);
    expect(css.startsWith('linear-gradient(')).toBe(true);
    expect(css.endsWith(`url("${good}")`)).toBe(true);
  });
});

describe('backgroundPathname / isOwnBackgroundPathname', () => {
  it('builds a path the token route accepts for that user only', () => {
    const p = backgroundPathname(UID, 'image/webp', NONCE);
    expect(p).toBe(`game-backgrounds/${UID}/background-${NONCE}.webp`);
    expect(isOwnBackgroundPathname(p, UID)).toBe(true);
    expect(isOwnBackgroundPathname(p, OTHER)).toBe(false);
    expect(backgroundPathname(UID, 'image/jpeg', NONCE).endsWith('.jpg')).toBe(true);
  });

  it('rejects traversal and other folders', () => {
    expect(isOwnBackgroundPathname(`game-backgrounds/${UID}/../${OTHER}/background-${NONCE}.webp`, UID)).toBe(false);
    expect(isOwnBackgroundPathname(`posts/${UID}/background-${NONCE}.webp`, UID)).toBe(false);
    expect(isOwnBackgroundPathname(`game-backgrounds/${UID}/background-${NONCE}.svg`, UID)).toBe(false);
    // a fixed or short name would let one path be re-targeted
    expect(isOwnBackgroundPathname(`game-backgrounds/${UID}/background.webp`, UID)).toBe(false);
    expect(isOwnBackgroundPathname(`game-backgrounds/${UID}/background-abc.webp`, UID)).toBe(false);
  });

  it('refuses a non-uuid user id or a weak nonce', () => {
    expect(() => backgroundPathname('../x', 'image/webp', NONCE)).toThrow();
    expect(() => backgroundPathname(UID, 'image/webp', 'short')).toThrow();
    expect(() => backgroundPathname(UID, 'image/webp', `${NONCE}/../x`)).toThrow();
  });
});

describe('fitWithin', () => {
  it('never upscales', () => {
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 });
  });
  it('scales the longest side to the cap', () => {
    expect(fitWithin(4032, 3024, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3024, 4032, 2560)).toEqual({ width: 1920, height: 2560 });
  });
});

describe('background hint', () => {
  const palette = { '--gf-bg': '#1a1410', '--gf-accent-rgb': '196, 149, 90' };

  it('round-trips an image and its palette for the same user', () => {
    const raw = serializeBackgroundHint(UID, { url: good, palette });
    expect(parseBackgroundHint(raw, UID)).toEqual({ url: good, palette });
  });

  it('round-trips "no custom background"', () => {
    const raw = serializeBackgroundHint(UID, { url: null, palette: null });
    expect(parseBackgroundHint(raw, UID)).toEqual({ url: null, palette: null });
  });

  it('ignores a hint stored for another account', () => {
    expect(parseBackgroundHint(serializeBackgroundHint(OTHER, { url: null, palette: null }), UID)).toBeNull();
  });

  it('rejects a url outside the owner folder or our store', () => {
    const raw = JSON.stringify({ userId: UID, url: 'https://evil.example/x.webp', palette: null });
    expect(parseBackgroundHint(raw, UID)).toBeNull();
    expect(parseBackgroundHint(serializeBackgroundHint(UID, { url: good, palette: null }), OTHER)).toBeNull();
  });

  it('drops a palette with unexpected keys or values but keeps the image', () => {
    const raw = JSON.stringify({ userId: UID, url: good, palette: { color: 'red' } });
    expect(parseBackgroundHint(raw, UID)).toEqual({ url: good, palette: null });
    const raw2 = JSON.stringify({ userId: UID, url: good, palette: { '--gf-bg': 'url(x)};' } });
    expect(parseBackgroundHint(raw2, UID)).toEqual({ url: good, palette: null });
  });

  it('returns null for missing or corrupt storage', () => {
    expect(parseBackgroundHint(null, UID)).toBeNull();
    expect(parseBackgroundHint('{nope', UID)).toBeNull();
  });
});

describe('gameBackgroundCss pending', () => {
  it('shows the neutral fill, never the default art, while pending', () => {
    expect(gameBackgroundCss(false, null, true)).toBe(GAME_BACKGROUND_PENDING_CSS);
  });
});
