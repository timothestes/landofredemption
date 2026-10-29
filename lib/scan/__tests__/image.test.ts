import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { fitToTier, fillToTier, encodeForScan } from '../image';
describe('fillToTier', () => {
  const patches = (r: { width: number; height: number }) => Math.ceil(r.width / 28) * Math.ceil(r.height / 28);
  it('enlarges a tall sideways-row crop to just under the high cap', () => { const r = fillToTier(522, 1600, 'high'); expect(r.height).toBeGreaterThan(1600); expect(patches(r)).toBeLessThanOrEqual(4784); expect(patches(r)).toBeGreaterThan(4600); });
  it('shrinks a huge input', () => { const r = fillToTier(8000, 6000, 'high'); expect(r.width).toBeLessThan(8000); expect(patches(r)).toBeLessThanOrEqual(4784); expect(patches(r)).toBeGreaterThan(4600); });
  it('preserves aspect within 1 px and the patch rule holds', () => { for (const [w, h] of [[522, 1600], [1600, 522], [400, 160], [8000, 6000], [100, 100], [3000, 200]] as const) for (const t of ['high', 'low'] as const) { const r = fillToTier(w, h, t); expect(r.imageTokens).toBe(patches(r)); expect(r.imageTokens).toBeLessThanOrEqual(t === 'high' ? 4784 : 1568); if (w >= h) expect(Math.abs(r.height - (r.width * h) / w)).toBeLessThanOrEqual(1); else expect(Math.abs(r.width - (r.height * w) / h)).toBeLessThanOrEqual(1); } });
});
describe('fitToTier', () => {
  it('4:3 high tier lands at the spec size and token count', () => { const r = fitToTier(4032, 3024, 'high'); expect(r.width).toBeLessThanOrEqual(2212); expect(r.imageTokens).toBeLessThanOrEqual(4784); expect(r.imageTokens).toBeGreaterThan(4600); });
  it('never enlarges', () => expect(fitToTier(600, 800, 'high')).toEqual({ width: 600, height: 800, imageTokens: 22 * 29 }));
  it('low tier caps at 1568 patches', () => expect(fitToTier(4032, 3024, 'low').imageTokens).toBeLessThanOrEqual(1568));
  it('token count matches the patch rule for the returned size', () => { for (const [w, h] of [[4032, 3024], [3024, 4032], [4000, 1000], [8000, 6000]] as const) for (const t of ['high', 'low'] as const) { const r = fitToTier(w, h, t); expect(r.imageTokens).toBe(Math.ceil(r.width / 28) * Math.ceil(r.height / 28)); expect(r.imageTokens).toBeLessThanOrEqual(t === 'high' ? 4784 : 1568); } });
});
describe('encodeForScan', () => {
  it('re-encodes a PNG to JPEG at the tier', async () => { const png = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: '#888' } }).png().toBuffer(); const r = await encodeForScan(png, 'high'); expect(r.imageTokens).toBeLessThanOrEqual(4784); expect(r.jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); const m = await sharp(r.jpeg).metadata(); expect([m.width, m.height]).toEqual([r.width, r.height]); });
  it('rejects formats outside the allowlist (GIF, SVG, TIFF) as undecodable', async () => {
    const gif = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#888' } }).gif().toBuffer();
    const tiff = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#888' } }).tiff().toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>');
    for (const b of [gif, tiff, svg]) await expect(encodeForScan(b, 'high')).rejects.toMatchObject({ code: 'undecodable' });
  });
  it('accepts WebP', async () => { const webp = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#888' } }).webp().toBuffer(); expect((await encodeForScan(webp, 'low')).jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); });
  it('rejects garbage as undecodable', async () => { await expect(encodeForScan(Buffer.from('not an image'), 'high')).rejects.toMatchObject({ code: 'undecodable' }); });
  it('rejects a 64 MP image over limitInputPixels as too_large', async () => { const png = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: '#888' } }).png({ compressionLevel: 1 }).toBuffer(); await expect(encodeForScan(png, 'high')).rejects.toMatchObject({ code: 'too_large' }); }, 30_000);
});
