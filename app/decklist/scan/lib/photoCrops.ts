import type { Box } from '@/lib/scan/deckSchema';

export type CropPlan = {
  sx: number; sy: number; sw: number; sh: number;
  rotate: 0 | 90 | -90 | 180;
  outW: number; outH: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Pixel rectangle for a normalized box, the turn that makes it upright, and the output size. */
export function cropPlan(
  bbox: Box,
  img: { w: number; h: number },
  orientation: string,
  maxEdge = 1200,
): CropPlan {
  const x0 = clamp(Math.round(bbox[0] * img.w), 0, img.w - 1);
  const y0 = clamp(Math.round(bbox[1] * img.h), 0, img.h - 1);
  const x1 = clamp(Math.round(bbox[2] * img.w), x0 + 1, img.w);
  const y1 = clamp(Math.round(bbox[3] * img.h), y0 + 1, img.h);
  const sw = x1 - x0;
  const sh = y1 - y0;
  const rotate: CropPlan['rotate'] =
    orientation === 'rotated_cw' ? -90 : orientation === 'rotated_ccw' ? 90 : orientation === 'upside_down' ? 180 : 0;
  const quarter = rotate === 90 || rotate === -90;
  const rw = quarter ? sh : sw;
  const rh = quarter ? sw : sh;
  const scale = Math.min(1, maxEdge / Math.max(rw, rh));
  return {
    sx: x0, sy: y0, sw, sh, rotate,
    outW: Math.max(1, Math.round(rw * scale)),
    outH: Math.max(1, Math.round(rh * scale)),
  };
}

/** Draw a plan from the photo onto a canvas and return an object URL for the JPEG. Browser only. */
export async function cropToUrl(photoUrl: string, plan: CropPlan): Promise<string> {
  const blob = await (await fetch(photoUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = plan.outW;
    canvas.height = plan.outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.translate(plan.outW / 2, plan.outH / 2);
    ctx.rotate((plan.rotate * Math.PI) / 180);
    const quarter = plan.rotate === 90 || plan.rotate === -90;
    const dw = quarter ? plan.outH : plan.outW;
    const dh = quarter ? plan.outW : plan.outH;
    ctx.drawImage(bitmap, plan.sx, plan.sy, plan.sw, plan.sh, -dw / 2, -dh / 2, dw, dh);
    const out = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    if (!out) throw new Error('toBlob failed');
    return URL.createObjectURL(out);
  } finally {
    bitmap.close();
  }
}
