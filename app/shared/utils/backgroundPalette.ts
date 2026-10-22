/**
 * Derive the play UI's `--gf-*` theme from a player's custom background.
 * Pure and DOM-free: `dominantColor` takes raw RGBA pixels (the hook samples a
 * small canvas), `paletteFromColor` returns CSS custom properties or null.
 *
 * The rule is "same UI, new hue": every token keeps the default theme's
 * lightness and (at most) its saturation, and only its hue moves to the image's
 * main color — so a loud image never makes loud chrome. Text tokens are then
 * lightened until they clear WCAG contrast against the panel colour; if that is
 * impossible the palette is rejected and the default brown/gold theme stays.
 */

export interface Hsl {
  h: number; // 0-360
  s: number; // 0-1
  l: number; // 0-1
}

/** The default theme, mirrored from `:root` in app/globals.css. */
export const DEFAULT_THEME = {
  '--gf-bg': '#2a1f12',
  '--gf-bg-dark': '#0d0905',
  '--gf-border': '#6b4e27',
  '--gf-border-dim': '#4a3520',
  '--gf-text': '#c9b99a',
  '--gf-text-bright': '#e8d5a3',
  '--gf-text-dim': '#8b6532',
  '--gf-accent': '#c4955a',
  '--gf-gold': '#f0c060',
  '--gf-panel': '#1e1610',
  /** Near-black panel interior (chat body, right panel, touch top bar). */
  '--gf-deep': '#0a0805',
  /** Game-log line text. */
  '--gf-text-log': '#c8b882',
} as const;

type Token = keyof typeof DEFAULT_THEME;

/** Minimum contrast against --gf-bg for each text-like token. */
const MIN_CONTRAST: Partial<Record<Token, number>> = {
  '--gf-text-bright': 7,
  '--gf-text': 4.5,
  '--gf-accent': 3,
  '--gf-gold': 3,
  '--gf-text-dim': 3,
  '--gf-text-log': 4.5,
  // Panel edges: at least the default theme's own separation (2.11 / 1.40),
  // which blue/violet hues otherwise drop toward 1.2-1.4.
  '--gf-border': 2,
  '--gf-border-dim': 1.35,
};

/** Every property `paletteFromColor` sets — the hook removes exactly these. */
export const THEME_PROPERTIES = [
  ...Object.keys(DEFAULT_THEME).filter((k) => k !== '--gf-panel'),
  '--gf-hover',
  '--gf-hover-strong',
  '--gf-accent-rgb',
  '--gf-panel-rgb',
  '--gf-border-rgb',
  '--gf-text-bright-rgb',
  '--gf-bg-rgb',
  '--gf-bg-dark-rgb',
  '--gf-deep-rgb',
] as const;

// ---- colour math ----

export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0));
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- dominant colour ----

const BUCKETS = 24; // 15° each
/** Share of pixels that must be colourful for the image to count as having a colour. */
const MIN_COVERAGE = 0.06;

/**
 * The image's main colour from RGBA pixels, or null for a grey / black-and-white
 * / near-black image. Only reasonably saturated mid-tone pixels vote (weighted
 * by saturation); the winning 45° window's circular-mean hue is returned.
 */
export function dominantColor(rgba: ArrayLike<number>): Hsl | null {
  const weight = new Array<number>(BUCKETS).fill(0);
  const sinSum = new Array<number>(BUCKETS).fill(0);
  const cosSum = new Array<number>(BUCKETS).fill(0);
  const satSum = new Array<number>(BUCKETS).fill(0);
  let pixels = 0;
  let voted = 0;

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    pixels++;
    const c = rgbToHsl(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (c.s < 0.2 || c.l < 0.12 || c.l > 0.9) continue;
    const b = Math.floor(c.h / (360 / BUCKETS)) % BUCKETS;
    const rad = (c.h * Math.PI) / 180;
    weight[b] += c.s;
    sinSum[b] += Math.sin(rad) * c.s;
    cosSum[b] += Math.cos(rad) * c.s;
    satSum[b] += c.s * c.s;
    voted++;
  }
  if (pixels === 0 || voted / pixels < MIN_COVERAGE) return null;

  let best = 0, bestW = -1;
  for (let b = 0; b < BUCKETS; b++) {
    const w = weight[(b + BUCKETS - 1) % BUCKETS] + weight[b] + weight[(b + 1) % BUCKETS];
    if (w > bestW) { bestW = w; best = b; }
  }
  let sin = 0, cos = 0, w = 0, sat = 0;
  for (const b of [(best + BUCKETS - 1) % BUCKETS, best, (best + 1) % BUCKETS]) {
    sin += sinSum[b]; cos += cosSum[b]; w += weight[b]; sat += satSum[b];
  }
  const h = ((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360;
  return { h, s: sat / w, l: 0.5 };
}

// ---- palette ----

/**
 * CSS custom properties retinting the default theme to `color`'s hue, or null
 * when no accessible palette exists (the caller then keeps the defaults).
 * Saturation follows the image: a washed-out image gives muted chrome.
 */
export function paletteFromColor(color: Hsl): Record<string, string> | null {
  const k = Math.max(0.4, Math.min(1, color.s / 0.5));
  const out = {} as Record<Token, [number, number, number]>;
  for (const [token, hex] of Object.entries(DEFAULT_THEME) as [Token, string][]) {
    const base = rgbToHsl(...hexToRgb(hex));
    out[token] = hslToRgb({ h: color.h, s: base.s * k, l: base.l });
  }

  const bg = out['--gf-bg'];
  for (const [token, min] of Object.entries(MIN_CONTRAST) as [Token, number][]) {
    const hsl = rgbToHsl(...out[token]);
    while (contrastRatio(out[token], bg) < min) {
      if (hsl.l >= 0.95) return null;
      hsl.l = Math.min(0.95, hsl.l + 0.02);
      out[token] = hslToRgb(hsl);
    }
  }

  const accent = out['--gf-accent'].join(', ');
  const props: Record<string, string> = {};
  for (const token of Object.keys(out) as Token[]) {
    if (token !== '--gf-panel') props[token] = rgbToHex(out[token]);
  }
  props['--gf-hover'] = `rgba(${accent}, 0.15)`;
  props['--gf-hover-strong'] = `rgba(${accent}, 0.25)`;
  props['--gf-accent-rgb'] = accent;
  props['--gf-panel-rgb'] = out['--gf-panel'].join(', ');
  props['--gf-border-rgb'] = out['--gf-border'].join(', ');
  props['--gf-text-bright-rgb'] = out['--gf-text-bright'].join(', ');
  props['--gf-bg-rgb'] = out['--gf-bg'].join(', ');
  props['--gf-bg-dark-rgb'] = out['--gf-bg-dark'].join(', ');
  props['--gf-deep-rgb'] = out['--gf-deep'].join(', ');
  return props;
}
