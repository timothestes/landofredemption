import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { fitToTier, encodeForScan } from '../image';
describe('fitToTier', () => {
  it('4:3 high tier lands at the spec size and token count', () => { const r = fitToTier(4032, 3024, 'high'); expect(r.width).toBeLessThanOrEqual(2212); expect(r.imageTokens).toBeLessThanOrEqual(4784); expect(r.imageTokens).toBeGreaterThan(4600); });
  it('never enlarges', () => expect(fitToTier(600, 800, 'high')).toEqual({ width: 600, height: 800, imageTokens: 22 * 29 }));
  it('low tier caps at 1568 patches', () => expect(fitToTier(4032, 3024, 'low').imageTokens).toBeLessThanOrEqual(1568));
  it('token count matches the patch rule for the returned size', () => { for (const [w, h] of [[4032, 3024], [3024, 4032], [4000, 1000], [8000, 6000]] as const) for (const t of ['high', 'low'] as const) { const r = fitToTier(w, h, t); expect(r.imageTokens).toBe(Math.ceil(r.width / 28) * Math.ceil(r.height / 28)); expect(r.imageTokens).toBeLessThanOrEqual(t === 'high' ? 4784 : 1568); } });
});
describe('encodeForScan', () => {
  it('re-encodes a PNG to JPEG at the tier', async () => { const png = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: '#888' } }).png().toBuffer(); const r = await encodeForScan(png, 'high'); expect(r.imageTokens).toBeLessThanOrEqual(4784); expect(r.jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8])); const m = await sharp(r.jpeg).metadata(); expect([m.width, m.height]).toEqual([r.width, r.height]); });
  it('rejects garbage as undecodable', async () => { await expect(encodeForScan(Buffer.from('not an image'), 'high')).rejects.toMatchObject({ code: 'undecodable' }); });
  it('rejects a 64 MP image over limitInputPixels as too_large', async () => { const png = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: '#888' } }).png({ compressionLevel: 1 }).toBuffer(); await expect(encodeForScan(png, 'high')).rejects.toMatchObject({ code: 'too_large' }); }, 30_000);
});
