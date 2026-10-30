import sharp from 'sharp';
import type { Box, DeckGroup, DeckRead } from './deckSchema';
import { fillToTier } from './image';

// Crop pass for deck photos: re-read a group from an upright crop scaled to the high tier. Geometry is pure; cropGroup uses sharp.

/** Padding around a group's box, as a fraction of the image's width (left/right) and height (top/bottom). */
export const CROP_PAD = 0.04;
/** Slack, as a fraction of the image, when checking a crop read's centre against its group's box. */
export const CROP_FILTER_TOL = 0.015;

/** Integer pixels in the source image. */
export interface CropRect { left: number; top: number; width: number; height: number }

// Rounded to micro-pixels so float noise (e.g. 459.99999) cannot move a floor/ceil by a pixel.
const px = (n: number) => Math.round(n * 1e6) / 1e6;

/** Padded, clamped pixel rect for a normalized box; at least 1 x 1. */
export function cropRect(bbox: Box, width: number, height: number, pad = CROP_PAD): CropRect {
  const x0 = Math.min(width, Math.max(0, Math.floor(px((bbox[0] - pad) * width))));
  const y0 = Math.min(height, Math.max(0, Math.floor(px((bbox[1] - pad) * height))));
  const x1 = Math.min(width, Math.max(0, Math.ceil(px((bbox[2] + pad) * width))));
  const y1 = Math.min(height, Math.max(0, Math.ceil(px((bbox[3] + pad) * height))));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return { left: Math.min(x0, width - 1), top: Math.min(y0, height - 1), width: w, height: h };
}

/** Clockwise degrees (sharp's rotate) that turn a group upright. */
export function rotationFor(orientation: DeckGroup['orientation']): 0 | 90 | 180 | 270 {
  if (orientation === 'rotated_ccw') return 90;
  if (orientation === 'rotated_cw') return 270;
  if (orientation === 'upside_down') return 180;
  return 0;
}

/** An upright group the first pass listed under this share of its own cardCount is cropped: the pass truncated it. */
export const SHORT_GROUP_FRACTION = 0.5;
/** Groups under this many cards are never cropped for being short. */
export const SHORT_GROUP_MIN_CARDS = 3;

/**
 * True when the first pass saw the group sideways or upside down, or listed under half of an upright group's cardCount
 * (`reads` counts its first-pass reads); never for the orphan group 0. Upright groups the first pass read in full are not
 * cropped, even with unread titles: re-reading them at effort medium was net negative against the effort-high first pass
 * in two replays, losing as many hits as the sideways crops gained.
 */
export function needsCrop(group: DeckGroup, reads: number): boolean {
  if (group.id === 0) return false;
  if (group.orientation !== 'upright') return true;
  return group.cardCount >= SHORT_GROUP_MIN_CARDS && reads < SHORT_GROUP_FRACTION * group.cardCount;
}

/** A group with at least this share of its box inside a bigger group's box is nested in it: a crop of the bigger one reads its cards too. */
export const NESTED_FRACTION = 0.8;

const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const overlap = (a: Box, b: Box) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);

/** Maps each group nested in another (by NESTED_FRACTION of its area) to its outermost container. Group 0 takes no part. */
export function nestedGroups(groups: DeckGroup[]): Map<number, number> {
  const real = groups.filter(g => g.id !== 0);
  const parent = new Map<number, DeckGroup>();
  for (const a of real) {
    const holders = real.filter(b => b !== a && b.id !== a.id && area(b.bbox) > area(a.bbox) && overlap(a.bbox, b.bbox) >= NESTED_FRACTION * area(a.bbox));
    if (holders.length > 0) parent.set(a.id, holders.reduce((x, y) => (area(y.bbox) < area(x.bbox) ? y : x)));
  }
  const root = new Map<number, number>();
  for (const id of parent.keys()) {
    let top = parent.get(id)!;
    for (let hops = 0; parent.has(top.id) && hops < real.length; hops++) top = parent.get(top.id)!;
    root.set(id, top.id);
  }
  return root;
}

/** A wide group no taller than this many upright-column widths is a sideways row: one card's short side, not its long side (about 1.4). */
export const SIDEWAYS_ROW_MAX_HEIGHT = 1.2;
/** A row whose box reaches this close to the top or bottom edge is cut off by the frame, so its height says nothing. */
export const PHOTO_EDGE = 0.01;

/**
 * Overrides "upright" on wide groups whose height is about one card's short side, measured against the median width of the
 * photo's upright columns. The first pass sometimes calls a sideways row upright, and then nothing crops it. The direction cannot be
 * seen from the box, so it is taken as rotated_ccw, the one seen in every eval photo. No upright column, no change. A row
 * touching the top or bottom edge is left alone: the frame cuts it off, and a cut row of upright cards looks one card short.
 */
export function inferSidewaysRows(groups: DeckGroup[], width: number, height: number): DeckGroup[] {
  const size = (g: DeckGroup) => ({ w: (g.bbox[2] - g.bbox[0]) * width, h: (g.bbox[3] - g.bbox[1]) * height });
  const upright = groups.filter(g => g.id !== 0 && g.orientation === 'upright');
  const columns = upright.map(size).filter(s => s.h > s.w).map(s => s.w).sort((a, b) => a - b);
  if (columns.length === 0) return groups;
  const cardWidth = columns[Math.floor(columns.length / 2)];
  return groups.map(g => {
    if (!upright.includes(g)) return g;
    const s = size(g);
    const cut = g.bbox[1] <= PHOTO_EDGE || g.bbox[3] >= 1 - PHOTO_EDGE;
    return !cut && s.w > s.h && s.h <= SIDEWAYS_ROW_MAX_HEIGHT * cardWidth ? { ...g, orientation: 'rotated_ccw' } : g;
  });
}

/** Maps a point normalized to the unrotated crop into fractions of the whole image (unclamped). */
function cropPointToPhoto(x: number, y: number, rect: CropRect, width: number, height: number): [number, number] {
  return [(rect.left + x * rect.width) / width, (rect.top + y * rect.height) / height];
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Maps a box normalized to the unrotated crop into fractions of the whole image, clamped to 0..1. */
export function cropBoxToPhoto(box: Box, rect: CropRect, width: number, height: number): Box {
  const [x0, y0] = cropPointToPhoto(box[0], box[1], rect, width, height);
  const [x1, y1] = cropPointToPhoto(box[2], box[3], rect, width, height);
  return [clamp01(x0), clamp01(y0), clamp01(x1), clamp01(y1)];
}

/** Maps a crop read's centre (box normalized to the unrotated crop) into the image and tests it against bbox widened by tol. */
export function titleCentreInBox(titleBox: Box, rect: CropRect, bbox: Box, width: number, height: number, tol = CROP_FILTER_TOL): boolean {
  const [cx, cy] = cropPointToPhoto((titleBox[0] + titleBox[2]) / 2, (titleBox[1] + titleBox[3]) / 2, rect, width, height);
  return cx >= bbox[0] - tol && cx <= bbox[2] + tol && cy >= bbox[1] - tol && cy <= bbox[3] + tol;
}

/** Whether a crop read belongs to the group: rotated groups and boxless reads are kept, upright ones must sit inside the box. */
export function keepCropRead(read: DeckRead, group: DeckGroup, rect: CropRect, width: number, height: number): boolean {
  if (group.orientation !== 'upright' || read.titleBox === null) return true;
  return titleCentreInBox(read.titleBox, rect, group.bbox, width, height);
}

/** Crops a group's padded box, rotates it upright, and scales it to fill the high tier's patch budget, as JPEG. Two pipelines: sharp rotates before it extracts. */
export async function cropGroup(jpeg: Buffer, group: DeckGroup, width: number, height: number): Promise<Buffer> {
  const rect = cropRect(group.bbox, width, height);
  const rotation = rotationFor(group.orientation);
  const sideways = rotation === 90 || rotation === 270;
  const size = fillToTier(sideways ? rect.height : rect.width, sideways ? rect.width : rect.height, 'high');
  const cropped = await sharp(jpeg).extract(rect).toBuffer();
  return sharp(cropped)
    .rotate(rotation)
    .resize({ width: size.width, height: size.height, fit: 'fill', kernel: 'lanczos3' })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}
