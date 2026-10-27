import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { loadPriceRows, type PriceRow } from '@/lib/scan/prices';
import type { PricesResponse } from '@/lib/pricing/types';

export const revalidate = 86400; // 1 day

export async function GET() {
  const supabase = getSupabaseAdmin();

  let allData: PriceRow[];
  try {
    allData = await loadPriceRows(supabase);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const prices: PricesResponse['prices'] = {};
  let latestUpdate = '';

  for (const row of allData) {
    prices[row.card_key] = {
      price: row.price,
      shopify_handle: row.shopify_handle,
      shopify_title: row.shopify_title,
    };
    if (row.updated_at > latestUpdate) latestUpdate = row.updated_at;
  }

  const response: PricesResponse = {
    updated_at: latestUpdate || new Date().toISOString(),
    prices,
  };

  return NextResponse.json(response, {
    headers: {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
    },
  });
}
