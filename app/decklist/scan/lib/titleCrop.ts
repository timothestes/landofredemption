import type { Box } from '@/lib/scan/deckSchema';
import { cropPlan, type CropPlan } from './photoCrops';

/** Clockwise degrees the scan turned the photo before reading it. */
export type Turn = 0 | 90 | 180 | 270;

/** A whole-card box is taller than this share of the photo; a title band is 1.7-3.6%. */
const MAX_HEIGHT = 0.1;
const MIN_ASPECT = 2;
/** Width over height of the band cut from the top of a whole-card box. */
const BAND_ASPECT = 3.5;
const PAD_SIDE = 0.04;
const PAD_VERTICAL = 0.25;

export function turnedSize(img: { w: number; h: number }, turn: Turn): { w: number; h: number } {
  return turn === 90 || turn === 270 ? { w: img.h, h: img.w } : { w: img.w, h: img.h };
}

/** A normalized point of the original photo, in the frame turned clockwise by `turn`. */
export function turnPoint([x, y]: [number, number], turn: Turn): [number, number] {
  if (turn === 90) return [1 - y, x];
  if (turn === 180) return [1 - x, 1 - y];
  if (turn === 270) return [y, 1 - x];
  return [x, y];
}

/**
 * The crop that shows a read's title band upright, or null when the box cannot be one. `img` is the frame the
 * box is in (the turned photo). A box as tall as a whole card is cut to the band at the card's top edge.
 */
export function titleStripPlan(
  box: Box | null | undefined,
  img: { w: number; h: number },
  orientation: string,
  maxEdge = 480,
): CropPlan | null {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  let x0 = box[0] * img.w;
  let y0 = box[1] * img.h;
  let x1 = box[2] * img.w;
  let y1 = box[3] * img.h;
  if (x1 <= x0 || y1 <= y0) return null;

  // "Up" for the card runs along the photo's width when the group lies sideways.
  const sideways = orientation === 'rotated_cw' || orientation === 'rotated_ccw';
  const width = sideways ? y1 - y0 : x1 - x0;
  let height = sideways ? x1 - x0 : y1 - y0;

  if (height / (sideways ? img.w : img.h) > MAX_HEIGHT) {
    height = Math.min(height, width / BAND_ASPECT);
    if (orientation === 'rotated_cw') x0 = x1 - height; // tops toward the right edge
    else if (orientation === 'rotated_ccw') x1 = x0 + height;
    else if (orientation === 'upside_down') y0 = y1 - height;
    else y1 = y0 + height;
  } else if (width / height < MIN_ASPECT) {
    return null;
  }

  const side = width * PAD_SIDE;
  const vertical = height * PAD_VERTICAL;
  const padX = sideways ? vertical : side;
  const padY = sideways ? side : vertical;
  const unit = (n: number, of: number) => Math.min(1, Math.max(0, n / of));
  return cropPlan(
    [unit(x0 - padX, img.w), unit(y0 - padY, img.h), unit(x1 + padX, img.w), unit(y1 + padY, img.h)],
    img, orientation, maxEdge,
  );
}
