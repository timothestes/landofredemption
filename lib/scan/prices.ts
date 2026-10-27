import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import type { PriceMap } from './match';

export type { PriceMap };

export interface PriceRow {
  card_key: string;
  price: number;
  shopify_handle: string | null;
  shopify_title: string | null;
  updated_at: string;
}

/** Pages card_prices (Supabase caps a query at 1000 rows). Throws on a query error. */
export async function loadPriceRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: { from(table: string): any },
  pageSize = 1000,
): Promise<PriceRow[]> {
  const rows: PriceRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await client
      .from('card_prices')
      .select('card_key, price, shopify_handle, shopify_title, updated_at')
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (data ?? []) as any[]) rows.push({ ...r, price: parseFloat(r.price) });
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

/** Only finite prices; an unpriced printing is absent, never 0. */
export function toPriceMap(rows: PriceRow[]): PriceMap {
  const map: PriceMap = {};
  for (const r of rows) if (Number.isFinite(r.price)) map[r.card_key] = r.price;
  return map;
}

export async function loadPriceMap(client = getSupabaseAdmin()): Promise<PriceMap> {
  return toPriceMap(await loadPriceRows(client));
}
