import { describe, it, expect } from 'vitest';
import sample from '@/scripts/scan-eval/catalog-sample.json';
import recorded from '@/scripts/scan-eval/outputs/catalog-sonnet55-low-v4.json';
import { matchDetection } from '../match';
import { getScanIndex } from '../stemIndex';

describe('catalog golden set (148 labeled printings, recorded Sonnet 5.5 reads)', () => {
  const idx = getScanIndex();
  const rows = (recorded as any).rows as { id: string; detections: any[] }[];
  const labelById = new Map((sample as any[]).map(e => [e.id, e.label]));

  it('identity top-1 at least 144 and at most 2 silent wrongs', () => {
    expect(rows.length).toBe(148);
    let identityOk = 0, silent = 0, matched = 0, noDetection = 0;
    for (const r of rows) {
      const L = labelById.get(r.id)!;
      const d = r.detections[0];
      if (!d) { noDetection++; continue; }
      const m = matchDetection(d, {});
      const ok = m.identityKey === idx.canonicalIdentity(L.identity);
      if (ok) identityOk++;
      if (m.status === 'matched') { matched++; if (!ok) silent++; }
    }
    const msg = `identityOk=${identityOk} silent=${silent} matched=${matched} noDetection=${noDetection}`;
    expect(noDetection, msg).toBe(0);
    expect(identityOk, msg).toBeGreaterThanOrEqual(144);
    expect(silent, msg).toBeLessThanOrEqual(2);
    expect(matched, msg).toBeGreaterThanOrEqual(140);
  });
});
