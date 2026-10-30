import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { cropRect, rotationFor, needsCrop, titleCentreInBox, keepCropRead, cropGroup, cropBoxToPhoto, inferSidewaysRows, nestedGroups } from '../crop';
import type { Box, DeckGroup, DeckRead } from '../deckSchema';

const read = (group: number, title: string | null = 'X', titleBox: Box | null = null): DeckRead => ({ title, strength: null, toughness: null, type: 'unknown', brigade: null, reference: null, group, position: 1, titleBox, confidence: 'high' });
const grp = (id: number, orientation: DeckGroup['orientation'] = 'upright', cardCount = 2): DeckGroup => ({ id, orientation, bbox: [0, 0, 1, 1], cardCount });

describe('cropRect', () => {
  it('pads by 4% of each dimension and clamps', () => expect(cropRect([0.5, 0.5, 0.6, 0.9], 1000, 500, 0.04)).toEqual({ left: 460, top: 230, width: 180, height: 240 }));
  it('clamps at the image edges', () => expect(cropRect([0, 0.9, 0.1, 1], 1000, 500)).toEqual({ left: 0, top: 430, width: 140, height: 70 }));
  it('a zero-width box gives a 1 px rect', () => { const r = cropRect([0.5, 0.5, 0.5, 0.5], 1000, 500, 0); expect(r.width).toBe(1); expect(r.height).toBe(1); });
});
describe('rotationFor', () => {
  it('maps orientations to rotations', () => expect(['upright', 'rotated_ccw', 'rotated_cw', 'upside_down'].map(o => rotationFor(o as any))).toEqual([0, 90, 270, 180]));
});
describe('needsCrop', () => {
  it('non-upright groups; never group 0', () => {
    expect(needsCrop(grp(1, 'rotated_ccw', 2), 2)).toBe(true);
    expect(needsCrop(grp(2, 'rotated_cw', 2), 2)).toBe(true);
    expect(needsCrop(grp(3, 'upside_down', 2), 2)).toBe(true);
    expect(needsCrop(grp(4, 'upright', 2), 2)).toBe(false);
    expect(needsCrop(grp(0, 'rotated_ccw', 2), 0)).toBe(false);
  });
  it('an upright group the first pass listed under half of is cropped', () => {
    expect(needsCrop(grp(1, 'upright', 10), 4)).toBe(true);
    expect(needsCrop(grp(1, 'upright', 10), 0)).toBe(true);
    expect(needsCrop(grp(0, 'upright', 10), 0)).toBe(false);
  });
  it('an upright group at half or more of its count, or under three cards, is not', () => {
    expect(needsCrop(grp(1, 'upright', 10), 5)).toBe(false);
    expect(needsCrop(grp(1, 'upright', 4), 3)).toBe(false);
    expect(needsCrop(grp(1, 'upright', 2), 0)).toBe(false);
  });
});
describe('nestedGroups', () => {
  const g = (id: number, bbox: Box): DeckGroup => ({ id, orientation: 'rotated_cw', bbox, cardCount: 5 });
  it('maps a group mostly inside a bigger one to it (recorded on 20240804_163529)', () => {
    const gs = [g(7, [0.53, 0.77, 0.88, 0.89]), g(8, [0, 0.57, 0.31, 0.8]), g(9, [0, 0.57, 0.45, 1])];
    expect([...nestedGroups(gs)]).toEqual([[8, 9]]);
  });
  it('leaves neighbours that only touch or overlap a little', () => {
    expect(nestedGroups([g(1, [0, 0, 0.5, 0.5]), g(2, [0.45, 0, 1, 0.5])]).size).toBe(0);
  });
  it('maps to the outermost container and never involves group 0', () => {
    const gs = [g(0, [0, 0, 1, 1]), g(1, [0.1, 0.1, 0.2, 0.2]), g(2, [0, 0, 0.5, 0.5]), g(3, [0, 0, 0.3, 0.3])];
    expect([...nestedGroups(gs)].sort()).toEqual([[1, 2], [3, 2]]);
  });
});
describe('inferSidewaysRows', () => {
  const g = (id: number, bbox: Box, orientation: DeckGroup['orientation'] = 'upright'): DeckGroup => ({ id, orientation, bbox, cardCount: 5 });
  // First-pass groups recorded on 1024 x 769 eval photos, where the model called a sideways row upright.
  const dark1 = [g(1, [0.23, 0.07, 0.76, 0.25]), g(2, [0.01, 0.24, 0.17, 0.77]), g(3, [0.15, 0.26, 0.30, 0.73]), g(4, [0.30, 0.26, 0.44, 0.69]), g(5, [0.43, 0.25, 0.62, 0.96])];
  const starWars = [g(1, [0.02, 0.04, 0.17, 0.73]), g(2, [0.19, 0.05, 0.35, 0.79]), g(3, [0.37, 0.05, 0.53, 0.70]), g(6, [0.10, 0.78, 0.61, 0.98]), g(7, [0.61, 0.75, 0.93, 0.96])];
  it('turns a wide group about one card-width tall to rotated_ccw (dark photo 1)', () => {
    expect(inferSidewaysRows(dark1, 1024, 769).map(x => x.orientation)).toEqual(['rotated_ccw', 'upright', 'upright', 'upright', 'upright']);
  });
  it('leaves a row the photo edge cuts off: its height is not a card\'s (IMG_2745, turned upright)', () => {
    const turned = [g(1, [0, 0, 1, 0.2]), g(2, [0, 0.18, 0.11, 0.86]), g(3, [0.1, 0.17, 0.27, 0.78]), g(4, [0.24, 0.19, 0.4, 0.99]), g(5, [0.4, 0.19, 0.53, 0.72])];
    expect(inferSidewaysRows(turned, 1536, 1152).map(x => x.orientation)).toEqual(['upright', 'upright', 'upright', 'upright', 'upright']);
    const bottom = [g(1, [0.1, 0.85, 0.9, 1]), ...turned.slice(1)];
    expect(inferSidewaysRows(bottom, 1536, 1152)[0].orientation).toBe('upright');
  });
  it('catches both halves of a split sideways row (Star Wars mat)', () => {
    expect(inferSidewaysRows(starWars, 1024, 769).map(x => x.orientation)).toEqual(['upright', 'upright', 'upright', 'rotated_ccw', 'rotated_ccw']);
  });
  it('leaves a row of upright cards side by side (a card-height tall) upright', () => {
    const row = g(9, [0.1, 0.7, 0.6, 0.7 + (1.4 * 0.16 * 1024) / 769]);
    expect(inferSidewaysRows([...dark1.slice(1), row], 1024, 769).at(-1)!.orientation).toBe('upright');
  });
  it("keeps the model's orientation when it already saw the row sideways", () => {
    expect(inferSidewaysRows([g(1, [0.25, 0.08, 0.76, 0.26], 'rotated_cw'), ...dark1.slice(1)], 1024, 769)[0].orientation).toBe('rotated_cw');
  });
  it('changes nothing without an upright column to measure against, or for group 0', () => {
    expect(inferSidewaysRows([dark1[0]], 1024, 769)[0].orientation).toBe('upright');
    expect(inferSidewaysRows([{ ...dark1[0], id: 0 }, ...dark1.slice(1)], 1024, 769)[0].orientation).toBe('upright');
  });
});
describe('titleCentreInBox', () => {
  it('inside, outside, and within tolerance', () => {
    const rect = { left: 460, top: 230, width: 180, height: 240 };
    const bbox: Box = [0.5, 0.5, 0.6, 0.9];
    expect(titleCentreInBox([0.4, 0.4, 0.6, 0.5], rect, bbox, 1000, 500)).toBe(true);
    expect(titleCentreInBox([0.9, 0.4, 1, 0.5], rect, bbox, 1000, 500)).toBe(false);
    expect(titleCentreInBox([0.0, 0.4, 0.1, 0.5], rect, bbox, 1000, 500, 0.015)).toBe(false);
    expect(titleCentreInBox([0.0, 0.4, 0.1, 0.5], rect, bbox, 1000, 500, 0.05)).toBe(true);
  });
});
describe('cropBoxToPhoto', () => {
  it('maps a crop box into whole-photo fractions', () => {
    // x → (460 + x·180)/1000, y → (230 + y·240)/500.
    const box = cropBoxToPhoto([0.5, 0.25, 1, 0.5], { left: 460, top: 230, width: 180, height: 240 }, 1000, 500);
    [0.55, 0.58, 0.64, 0.7].forEach((v, i) => expect(box[i]).toBeCloseTo(v, 9));
  });
  it('clamps to 0..1', () => expect(cropBoxToPhoto([-1, -1, 2, 2], { left: 0, top: 0, width: 1000, height: 500 }, 1000, 500)).toEqual([0, 0, 1, 1]));
});
describe('keepCropRead', () => {
  it('keeps boxless reads and everything in a rotated group', () => {
    const rect = { left: 460, top: 230, width: 180, height: 240 };
    const far: Box = [0.9, 0.4, 1, 0.5];
    const up: DeckGroup = { id: 1, orientation: 'upright', bbox: [0.5, 0.5, 0.6, 0.9], cardCount: 2 };
    expect(keepCropRead(read(1, 'X', null), up, rect, 1000, 500)).toBe(true);
    expect(keepCropRead(read(1, 'X', far), { ...up, orientation: 'rotated_ccw' }, rect, 1000, 500)).toBe(true);
    expect(keepCropRead(read(1, 'X', far), up, rect, 1000, 500)).toBe(false);
  });
});
describe('cropGroup', () => {
  const expectFillsBudget = (w: number, h: number) => {
    const patches = Math.ceil(w / 28) * Math.ceil(h / 28);
    expect(patches).toBeLessThanOrEqual(4784);
    expect(patches).toBeGreaterThan(4600);
  };
  const make = () => sharp({ create: { width: 1000, height: 500, channels: 3, background: '#888' } }).jpeg().toBuffer();
  it('rotates a sideways group upright and fills the high tier patch budget', async () => {
    const out = await cropGroup(await make(), { id: 1, orientation: 'rotated_ccw', bbox: [0.1, 0.1, 0.5, 0.3], cardCount: 5 }, 1000, 500);
    const m = await sharp(out).metadata();
    expect(m.format).toBe('jpeg');
    expect(m.height!).toBeGreaterThan(m.width!);
    expectFillsBudget(m.width!, m.height!);
  });
  // Left half red, right half blue, one group over the whole image. sharp.rotate(90) is clockwise, so the left edge ends on top.
  const halves = () => sharp({ create: { width: 200, height: 100, channels: 3, background: '#0000ff' } })
    .composite([{ input: { create: { width: 100, height: 100, channels: 3, background: '#ff0000' } }, left: 0, top: 0 }])
    .jpeg().toBuffer();
  const rowColour = async (buf: Buffer, edge: 'top' | 'bottom') => {
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const y = edge === 'top' ? 10 : info.height - 10;
    const i = (y * info.width + Math.floor(info.width / 2)) * info.channels;
    return { r: data[i], b: data[i + 2] };
  };
  it('rotated_ccw turns the left half to the top', async () => {
    const out = await cropGroup(await halves(), { id: 1, orientation: 'rotated_ccw', bbox: [0, 0, 1, 1], cardCount: 1 }, 200, 100);
    const top = await rowColour(out, 'top');
    const bottom = await rowColour(out, 'bottom');
    expect(top.r).toBeGreaterThan(200); expect(top.b).toBeLessThan(60);
    expect(bottom.b).toBeGreaterThan(200); expect(bottom.r).toBeLessThan(60);
  });
  it('rotated_cw turns the left half to the bottom', async () => {
    const out = await cropGroup(await halves(), { id: 1, orientation: 'rotated_cw', bbox: [0, 0, 1, 1], cardCount: 1 }, 200, 100);
    const top = await rowColour(out, 'top');
    const bottom = await rowColour(out, 'bottom');
    expect(bottom.r).toBeGreaterThan(200); expect(bottom.b).toBeLessThan(60);
    expect(top.b).toBeGreaterThan(200); expect(top.r).toBeLessThan(60);
  });
  it('keeps an upright group landscape', async () => {
    const out = await cropGroup(await make(), { id: 1, orientation: 'upright', bbox: [0.1, 0.1, 0.5, 0.3], cardCount: 5 }, 1000, 500);
    const m = await sharp(out).metadata();
    expect(m.width!).toBeGreaterThan(m.height!);
    expectFillsBudget(m.width!, m.height!);
  });
});
