import { describe, expect, it } from 'vitest';
import { titleStripPlan, turnPoint, turnedSize } from '../lib/titleCrop';

const img = { w: 2000, h: 1500 };

describe('titleStripPlan', () => {
  it('pads a title band: 4% of width sideways, 25% of height above and below', () => {
    // 400 x 60 px band at (400, 300)
    const p = titleStripPlan([0.2, 0.2, 0.4, 0.24], img, 'upright')!;
    expect(p).toMatchObject({ sx: 384, sy: 285, sw: 432, sh: 90, rotate: 0 });
  });
  it('clamps padding at the photo edge', () => {
    const p = titleStripPlan([0, 0, 0.2, 0.04], img, 'upright')!;
    expect([p.sx, p.sy]).toEqual([0, 0]);
  });
  it('drops a box under 2:1 that is not tall', () => {
    expect(titleStripPlan([0.2, 0.2, 0.25, 0.26], img, 'upright')).toBeNull(); // 100 x 90 px
  });
  it('cuts a whole-card box to its top band at 3.5:1', () => {
    // 280 x 390 px, 26% of the height
    const p = titleStripPlan([0.5, 0.5, 0.64, 0.76], img, 'upright')!;
    expect(p.sy).toBe(750 - 20); // band top less 25% of the 80 px band
    expect(p.sh).toBe(80 + 40);
  });
  it('takes the band from the card top for each orientation', () => {
    const box: [number, number, number, number] = [0.5, 0.2, 0.76, 0.4]; // 520 x 300 px, sideways whole card
    const cw = titleStripPlan(box, img, 'rotated_cw')!; // top toward the right edge
    expect(cw.sx + cw.sw).toBeGreaterThan(1520);
    expect(cw.sx).toBeGreaterThan(1300);
    expect(cw.rotate).toBe(-90);
    const ccw = titleStripPlan(box, img, 'rotated_ccw')!; // top toward the left edge
    expect(ccw.sx).toBeLessThan(1000);
    expect(ccw.sx + ccw.sw).toBeLessThan(1200);
    const flip = titleStripPlan([0.5, 0.5, 0.64, 0.76], img, 'upside_down')!;
    expect(flip.sy + flip.sh).toBeGreaterThan(1140);
    expect(flip.sy).toBeGreaterThan(1000);
  });
  it('gives an upright strip (wider than tall) for a sideways title band', () => {
    const p = titleStripPlan([0.2, 0.2, 0.23, 0.4], img, 'rotated_cw')!; // 60 x 300 px
    expect(p.outW).toBeGreaterThan(p.outH * 2);
  });
  it.each([
    [null], [undefined], [[0, 0, 10, 10]], [[0.4, 0.2, 0.2, 0.3]], [[0.1, 0.1, NaN, 0.2]], [[0.1, 0.1, 0.3]],
  ])('returns null for %j', (box) => {
    expect(titleStripPlan(box as never, img, 'upright')).toBeNull();
  });
});

describe('turns', () => {
  it('swaps the size on quarter turns', () => {
    expect(turnedSize(img, 90)).toEqual({ w: 1500, h: 2000 });
    expect(turnedSize(img, 180)).toEqual(img);
  });
  it('maps the original top-left corner clockwise', () => {
    expect(turnPoint([0, 0], 0)).toEqual([0, 0]);
    expect(turnPoint([0, 0], 90)).toEqual([1, 0]);
    expect(turnPoint([0, 0], 180)).toEqual([1, 1]);
    expect(turnPoint([0, 0], 270)).toEqual([0, 1]);
  });
  it.each([0, 90, 180, 270] as const)('a band turned by %i still yields a wide upright strip for the matching orientation', (turn) => {
    // An upright 400 x 60 band in the original; in the turned frame its orientation is what undoes the turn.
    const a = turnPoint([0.2, 0.2], turn), b = turnPoint([0.4, 0.24], turn);
    const box: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const orientation = { 0: 'upright', 90: 'rotated_cw', 180: 'upside_down', 270: 'rotated_ccw' }[turn];
    const p = titleStripPlan(box, turnedSize(img, turn), orientation)!;
    expect(p.outW).toBeGreaterThan(p.outH * 2);
  });
});
