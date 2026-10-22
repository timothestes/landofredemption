import { describe, expect, it } from 'vitest';
import {
  backgroundPathname,
  fitWithin,
  gameBackgroundCss,
  isAllowedBackgroundUrl,
  isOwnBackgroundPathname,
} from '../gameBackground';

const UID = '0b9a2f4c-1d2e-4f3a-9b8c-7d6e5f4a3b2c';
const OTHER = '11111111-2222-4333-8444-555555555555';
const HOST = 'https://qrpnuz0u6exnvyt8.public.blob.vercel-storage.com';
const good = `${HOST}/game-backgrounds/${UID}/background-AbC123xyz.webp`;

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
    const p = backgroundPathname(UID, 'image/webp');
    expect(p).toBe(`game-backgrounds/${UID}/background.webp`);
    expect(isOwnBackgroundPathname(p, UID)).toBe(true);
    expect(isOwnBackgroundPathname(p, OTHER)).toBe(false);
    expect(backgroundPathname(UID, 'image/jpeg').endsWith('.jpg')).toBe(true);
  });

  it('rejects traversal and other folders', () => {
    expect(isOwnBackgroundPathname(`game-backgrounds/${UID}/../${OTHER}/background.webp`, UID)).toBe(false);
    expect(isOwnBackgroundPathname(`posts/${UID}/background.webp`, UID)).toBe(false);
    expect(isOwnBackgroundPathname(`game-backgrounds/${UID}/background.svg`, UID)).toBe(false);
  });

  it('refuses a non-uuid user id', () => {
    expect(() => backgroundPathname('../x', 'image/webp')).toThrow();
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
