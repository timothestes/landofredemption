import { describe, it, expect } from 'vitest';
import { finishScan } from '../events';

function fakeAdmin(rows: any[]) {
  return { from: () => ({ update: (r: any) => { rows.push(r); return { eq: async () => ({ error: null }) }; } }) };
}

describe('finishScan', () => {
  it('writes mode when given', async () => {
    const rows: any[] = [];
    await finishScan(fakeAdmin(rows), 'id1', { status: 'done', attempts: 1, latencyMs: 5, mode: 'deck' });
    expect(rows[0].mode).toBe('deck');
  });

  it('omits mode when not given', async () => {
    const rows: any[] = [];
    await finishScan(fakeAdmin(rows), 'id1', { status: 'done', attempts: 1, latencyMs: 5 });
    expect('mode' in rows[0]).toBe(false);
  });
});
