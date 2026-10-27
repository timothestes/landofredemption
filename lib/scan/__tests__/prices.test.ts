import { describe, it, expect } from 'vitest';
import { loadPriceRows, toPriceMap } from '../prices';

const fakeClient = (total: number, orders: string[] = []) => ({
  from: () => ({
    select: () => ({
      order: (col: string) => {
        orders.push(col);
        return {
          range: async (a: number, b: number) => ({
            data: Array.from({ length: Math.max(0, Math.min(total, b + 1) - a) }, (_, i) => ({
              card_key: `k${a + i}`,
              price: String(a + i),
              shopify_handle: null,
              shopify_title: null,
              updated_at: '2026-10-27',
            })),
            error: null,
          }),
        };
      },
    }),
  }),
});

describe('loadPriceRows', () => {
  it('pages past 1000 and stops on a short page', async () => {
    expect((await loadPriceRows(fakeClient(2500), 1000)).length).toBe(2500);
    expect((await loadPriceRows(fakeClient(1000), 1000)).length).toBe(1000);
  });
  it('orders every page by card_key so pages are stable', async () => {
    const orders: string[] = [];
    await loadPriceRows(fakeClient(2500, orders), 1000);
    expect(orders).toEqual(['card_key', 'card_key', 'card_key']);
  });
  it('parses price strings to numbers', async () => {
    const rows = await loadPriceRows(fakeClient(3), 1000);
    expect(rows.map(r => r.price)).toEqual([0, 1, 2]);
  });
  it('throws the Supabase error message', async () => {
    const client = { from: () => ({ select: () => ({ order: () => ({ range: async () => ({ data: null, error: { message: 'boom' } }) }) }) }) };
    await expect(loadPriceRows(client)).rejects.toThrow('boom');
  });
});

describe('toPriceMap', () => {
  it('maps to numbers and drops NaN', () => {
    const m = toPriceMap([{ card_key: 'a', price: 2.5 } as any, { card_key: 'b', price: NaN } as any]);
    expect(m).toEqual({ a: 2.5 });
  });
});
