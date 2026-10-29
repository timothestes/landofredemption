import { describe, expect, it } from 'vitest';
import { cropPlan } from '../lib/photoCrops';

const img = { w: 4000, h: 3000 };

describe('cropPlan', () => {
  it('maps orientation to rotation', () => {
    const box: [number, number, number, number] = [0.1, 0.1, 0.3, 0.2];
    expect(cropPlan(box, img, 'upright').rotate).toBe(0);
    expect(cropPlan(box, img, 'rotated_cw').rotate).toBe(-90);
    expect(cropPlan(box, img, 'rotated_ccw').rotate).toBe(90);
    expect(cropPlan(box, img, 'upside_down').rotate).toBe(180);
    expect(cropPlan(box, img, 'weird').rotate).toBe(0);
  });

  it('converts to rounded pixels', () => {
    const p = cropPlan([0.1, 0.2, 0.3, 0.4], img, 'upright');
    expect(p).toMatchObject({ sx: 400, sy: 600, sw: 800, sh: 600, outW: 800, outH: 600 });
  });

  it('swaps the output size for quarter turns only', () => {
    const box: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
    const cw = cropPlan(box, img, 'rotated_cw');
    expect([cw.sw, cw.sh, cw.outW, cw.outH]).toEqual([800, 600, 600, 800]);
    const ccw = cropPlan(box, img, 'rotated_ccw');
    expect([ccw.outW, ccw.outH]).toEqual([600, 800]);
    const flip = cropPlan(box, img, 'upside_down');
    expect([flip.outW, flip.outH]).toEqual([800, 600]);
  });

  it('caps the long edge at 1200 for a whole photo', () => {
    const p = cropPlan([0, 0, 1, 1], img, 'upright');
    expect(Math.max(p.outW, p.outH)).toBe(1200);
    expect(p.outW).toBe(1200);
    expect(p.outH).toBe(900);
    const r = cropPlan([0, 0, 1, 1], img, 'rotated_cw');
    expect(r.outH).toBe(1200);
    expect(r.outW).toBe(900);
  });

  it('never upscales', () => {
    const p = cropPlan([0, 0, 0.1, 0.1], img, 'upright');
    expect([p.outW, p.outH]).toEqual([400, 300]);
  });

  it('clamps to the image and keeps at least one pixel', () => {
    const p = cropPlan([-0.5, -0.2, 1.5, 2], img, 'upright');
    expect([p.sx, p.sy, p.sw, p.sh]).toEqual([0, 0, 4000, 3000]);
    const q = cropPlan([0.9, 0.9, 0.9, 0.9], img, 'upright');
    expect(q.sw).toBeGreaterThanOrEqual(1);
    expect(q.sh).toBeGreaterThanOrEqual(1);
    expect(q.sx + q.sw).toBeLessThanOrEqual(4000);
  });
});
