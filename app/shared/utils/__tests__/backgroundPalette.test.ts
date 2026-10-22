import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  THEME_PROPERTIES,
  contrastRatio,
  dominantColor,
  hslToRgb,
  paletteFromColor,
  rgbToHsl,
} from '../backgroundPalette';

/** RGBA buffer of `n` pixels of each [r,g,b] given. */
function pixels(...runs: [number, [number, number, number]][]): Uint8ClampedArray {
  const total = runs.reduce((a, [n]) => a + n, 0);
  const out = new Uint8ClampedArray(total * 4);
  let i = 0;
  for (const [n, [r, g, b]] of runs) {
    for (let k = 0; k < n; k++) { out.set([r, g, b, 255], i); i += 4; }
  }
  return out;
}

const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

describe('rgb/hsl round trip', () => {
  it('is stable for the default theme', () => {
    for (const h of Object.values(DEFAULT_THEME)) {
      const rgb = hex(h);
      const back = hslToRgb(rgbToHsl(...rgb));
      back.forEach((v, i) => expect(Math.abs(v - rgb[i])).toBeLessThanOrEqual(1));
    }
  });
});

describe('dominantColor', () => {
  it('finds a purple image', () => {
    const c = dominantColor(pixels([100, [70, 30, 120]]));
    expect(c).not.toBeNull();
    expect(c!.h).toBeGreaterThan(260);
    expect(c!.h).toBeLessThan(285);
  });

  it('picks the larger colourful area', () => {
    const c = dominantColor(pixels([30, [200, 30, 30]], [70, [60, 30, 140]]));
    expect(c!.h).toBeGreaterThan(250);
  });

  it('averages hues across the 0/360 seam', () => {
    const c = dominantColor(pixels([50, [200, 30, 60]], [50, [200, 60, 30]]));
    expect(c!.h < 10 || c!.h > 350).toBe(true);
  });

  it('returns null for grey, black-and-white or nearly black images', () => {
    expect(dominantColor(pixels([100, [128, 128, 128]]))).toBeNull();
    expect(dominantColor(pixels([50, [0, 0, 0]], [50, [255, 255, 255]]))).toBeNull();
    expect(dominantColor(pixels([100, [10, 5, 20]]))).toBeNull();
    // a sliver of colour on a grey image is not enough
    expect(dominantColor(pixels([97, [120, 120, 120]], [3, [200, 30, 30]]))).toBeNull();
  });

  it('ignores transparent pixels and empty input', () => {
    expect(dominantColor(new Uint8ClampedArray(0))).toBeNull();
    expect(dominantColor(new Uint8ClampedArray([200, 30, 30, 0]))).toBeNull();
  });
});

describe('paletteFromColor', () => {
  it('sets exactly the theme properties', () => {
    const p = paletteFromColor({ h: 270, s: 0.6, l: 0.5 })!;
    expect(Object.keys(p).sort()).toEqual([...THEME_PROPERTIES].sort());
    expect(p['--gf-accent-rgb']).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
    expect(p['--gf-hover']).toMatch(/^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.15\)$/);
  });

  it('moves the hue but keeps text readable for every hue', () => {
    for (let h = 0; h < 360; h += 15) {
      for (const s of [0.25, 0.6, 1]) {
        const p = paletteFromColor({ h, s, l: 0.5 });
        expect(p, `h=${h} s=${s}`).not.toBeNull();
        const bg = hex(p!['--gf-bg']);
        expect(contrastRatio(hex(p!['--gf-text-bright']), bg)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(hex(p!['--gf-text']), bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(hex(p!['--gf-accent']), bg)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(hex(p!['--gf-text-dim']), bg)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('a purple image gives purple chrome no brighter than the default', () => {
    const p = paletteFromColor({ h: 275, s: 0.6, l: 0.5 })!;
    const bg = rgbToHsl(...hex(p['--gf-bg']));
    const def = rgbToHsl(...hex(DEFAULT_THEME['--gf-bg']));
    expect(bg.h).toBeGreaterThan(265);
    expect(bg.h).toBeLessThan(285);
    expect(bg.s).toBeLessThanOrEqual(def.s + 0.01);
    expect(Math.abs(bg.l - def.l)).toBeLessThan(0.01);
  });

  it('only emits hex / rgb triplets (nothing that could break a style declaration)', () => {
    const p = paletteFromColor({ h: 123.456, s: 0.9, l: 0.5 })!;
    for (const v of Object.values(p)) expect(v).toMatch(/^(#[0-9a-f]{6}|rgba?\([\d, .]+\)|\d{1,3}, \d{1,3}, \d{1,3})$/);
  });
});
