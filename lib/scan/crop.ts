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

/**
 * True when the first pass saw the group sideways or upside down; never for the orphan group 0.
 * Upright groups are not cropped, even when short or with unread titles: re-reading them at effort medium was net negative
 * against the effort-high first pass in two replays, losing as many hits as the sideways crops gained.
 */
export function needsCrop(group: DeckGroup): boolean {
  return group.id !== 0 && group.orientation !== 'upright';
}

/** A wide group no taller than this many upright-column widths is a sideways row: one card's short side, not its long side (about 1.4). */
export const SIDEWAYS_ROW_MAX_HEIGHT = 1.2;

/**
 * Overrides "upright" on wide groups whose height is about one card's short side, measured against the median width of the
 * photo's upright columns. The first pass sometimes calls a sideways row upright, and then nothing crops it. The direction cannot be
 * seen from the box, so it is taken as rotated_ccw, the one seen in every eval photo. No upright column, no change.
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
    return s.w > s.h && s.h <= SIDEWAYS_ROW_MAX_HEIGHT * cardWidth ? { ...g, orientation: 'rotated_ccw' } : g;
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
