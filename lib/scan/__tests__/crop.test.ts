import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { cropRect, rotationFor, needsCrop, titleCentreInBox, keepCropRead, cropGroup } from '../crop';
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
  it('unread, short, or sideways; never group 0', () => {
    expect(needsCrop(grp(1, 'upright', 2), [read(1), read(1, null)])).toBe(true);
    expect(needsCrop(grp(2, 'upright', 4), [read(2), read(2), read(2)])).toBe(true);
    expect(needsCrop(grp(3, 'rotated_ccw', 2), [read(3), read(3)])).toBe(true);
    expect(needsCrop(grp(4, 'upright', 2), [read(4), read(4)])).toBe(false);
    expect(needsCrop(grp(0, 'upright', 2), [read(0, null)])).toBe(false);
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
  const make = () => sharp({ create: { width: 1000, height: 500, channels: 3, background: '#888' } }).jpeg().toBuffer();
  it('rotates a sideways group upright and upscales to the long edge', async () => {
    const out = await cropGroup(await make(), { id: 1, orientation: 'rotated_ccw', bbox: [0.1, 0.1, 0.5, 0.3], cardCount: 5 }, 1000, 500);
    const m = await sharp(out).metadata();
    expect(m.format).toBe('jpeg');
    expect(Math.max(m.width!, m.height!)).toBe(1600);
    expect(m.height!).toBeGreaterThan(m.width!);
  });
  it('keeps an upright group landscape', async () => {
    const out = await cropGroup(await make(), { id: 1, orientation: 'upright', bbox: [0.1, 0.1, 0.5, 0.3], cardCount: 5 }, 1000, 500);
    const m = await sharp(out).metadata();
    expect(m.width!).toBeGreaterThan(m.height!);
    expect(Math.max(m.width!, m.height!)).toBe(1600);
  });
});
