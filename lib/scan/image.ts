import sharp, { type Metadata } from 'sharp';

// The one place sharp is configured for the scanner: re-encode a phone photo
// to the token tier the recognizer is billed at (28-pixel patches).

export type Tier = 'high' | 'low';
export const TIER_PATCH_CAP: Record<Tier, number> = { high: 4784, low: 1568 };

const PATCH = 28;
const LIMIT_INPUT_PIXELS = 60_000_000;
// What a phone camera or photo picker produces. Anything else (GIF, SVG, TIFF, PDF, raw) is refused.
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'avif']);

export class ScanImageError extends Error {
  constructor(readonly code: 'undecodable' | 'too_large') {
    super(`scan image ${code}`);
    this.name = 'ScanImageError';
  }
}

const tokens = (w: number, h: number) => Math.ceil(w / PATCH) * Math.ceil(h / PATCH);

// Largest size at the same aspect with ⌈w/28⌉×⌈h/28⌉ ≤ cap, searched down from just above the continuous solution (capped at maxLong).
function largestUnderCap(width: number, height: number, cap: number, maxLong: number): { width: number; height: number; imageTokens: number } {
  const landscape = width >= height;
  const long = landscape ? width : height;
  const short = landscape ? height : width;
  let l = Math.min(maxLong, Math.ceil(long * Math.sqrt((cap * PATCH * PATCH) / (width * height))) + 1);
  for (; l > 1; l--) {
    const s = Math.max(1, Math.round((l * short) / long));
    const [w, h] = landscape ? [l, s] : [s, l];
    if (tokens(w, h) <= cap) return { width: w, height: h, imageTokens: tokens(w, h) };
  }
  return { width: 1, height: 1, imageTokens: 1 };
}

/** Largest size at the same aspect with ⌈w/28⌉×⌈h/28⌉ ≤ the tier cap; never enlarges. */
export function fitToTier(width: number, height: number, tier: Tier): { width: number; height: number; imageTokens: number } {
  const cap = TIER_PATCH_CAP[tier];
  if (tokens(width, height) <= cap) return { width, height, imageTokens: tokens(width, height) };
  return largestUnderCap(width, height, cap, Math.max(width, height));
}

/** Largest size at the same aspect with ⌈w/28⌉×⌈h/28⌉ ≤ the tier cap; enlarges a smaller image, shrinks a larger one. */
export function fillToTier(width: number, height: number, tier: Tier): { width: number; height: number; imageTokens: number } {
  return largestUnderCap(width, height, TIER_PATCH_CAP[tier], Infinity);
}

// sharp reports limitInputPixels as "Input image exceeds pixel limit"; anything else is unreadable input.
function toScanImageError(e: unknown): ScanImageError {
  return new ScanImageError(/pixel limit/i.test((e as Error)?.message ?? '') ? 'too_large' : 'undecodable');
}

export async function encodeForScan(input: Buffer, tier: Tier): Promise<{ jpeg: Buffer; width: number; height: number; imageTokens: number }> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS }).metadata();
  } catch (e) {
    throw toScanImageError(e);
  }
  if (!meta.width || !meta.height || !ALLOWED_FORMATS.has(meta.format ?? '')) throw new ScanImageError('undecodable');
  if (meta.width * meta.height > LIMIT_INPUT_PIXELS) throw new ScanImageError('too_large');
  // EXIF-oriented size, so the tier fit matches what .rotate() produces.
  const oriented = meta.autoOrient ?? { width: meta.width, height: meta.height };
  const fit = fitToTier(oriented.width, oriented.height, tier);
  try {
    const jpeg = await sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS })
      .rotate()
      .resize({ width: fit.width, height: fit.height, fit: 'fill', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { jpeg, ...fit };
  } catch (e) {
    throw toScanImageError(e);
  }
}
