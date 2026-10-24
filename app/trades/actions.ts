"use server";

import { createClient } from "../../utils/supabase/server";
import { normalizeTradeItem, type TradeItem, type TradeKind } from "./lib/tradeList";

interface TradeItemRow {
  kind: TradeKind;
  card_name: string;
  card_set: string;
  card_img_file: string;
  any_version: boolean;
  priority: boolean;
  quantity: number;
  note: string;
}

const ITEM_COLUMNS = "kind, card_name, card_set, card_img_file, any_version, priority, quantity, note";
const ITEM_CONFLICT_KEY = "user_id,kind,card_name,card_set,card_img_file";

function rowToItem(row: TradeItemRow): TradeItem {
  return {
    kind: row.kind,
    cardName: row.card_name,
    cardSet: row.card_set,
    cardImgFile: row.card_img_file,
    anyVersion: row.any_version,
    priority: row.priority,
    quantity: row.quantity,
    note: row.note,
  };
}

// PREVIEW-ONLY: until migration 119 is applied, the trade tables don't exist.
// Callers fall back to sample/browser data instead of erroring. Remove with
// the preview fallback once the migration is live.
function isMissingTableError(error: any): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

async function getAuthedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null };
  return { supabase, user };
}

export async function loadMyTradeListAction(): Promise<{
  success: boolean;
  error?: string;
  previewMode?: boolean;
  items: TradeItem[];
  isShared: boolean;
  username: string | null;
}> {
  const empty = { items: [] as TradeItem[], isShared: false, username: null };
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { success: false, error: "You must be logged in", ...empty };

    const { data: profile } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();
    const username = profile?.username ?? null;

    const [itemsResult, listResult] = await Promise.all([
      supabase.from("trade_list_items").select(ITEM_COLUMNS).eq("user_id", user.id),
      supabase.from("trade_lists").select("is_shared").eq("user_id", user.id).maybeSingle(),
    ]);

    if (isMissingTableError(itemsResult.error) || isMissingTableError(listResult.error)) {
      return { success: true, previewMode: true, ...empty, username };
    }
    if (itemsResult.error) throw itemsResult.error;
    if (listResult.error) throw listResult.error;

    return {
      success: true,
      items: (itemsResult.data || []).map(rowToItem),
      isShared: listResult.data?.is_shared ?? false,
      username,
    };
  } catch (error) {
    console.error("Error in loadMyTradeListAction:", error);
    return { success: false, error: "Failed to load trade list", ...empty };
  }
}

/** Upserts one item; quantity 0 removes it. */
export async function saveTradeItemAction(item: TradeItem) {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { success: false, error: "You must be logged in" };

    const clean = normalizeTradeItem(item);
    if (clean.quantity === 0) {
      const { error } = await supabase
        .from("trade_list_items")
        .delete()
        .eq("user_id", user.id)
        .eq("kind", clean.kind)
        .eq("card_name", clean.cardName)
        .eq("card_set", clean.cardSet)
        .eq("card_img_file", clean.cardImgFile);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("trade_list_items").upsert(
        {
          user_id: user.id,
          kind: clean.kind,
          card_name: clean.cardName,
          card_set: clean.cardSet,
          card_img_file: clean.cardImgFile,
          any_version: clean.anyVersion,
          priority: clean.priority,
          quantity: clean.quantity,
          note: clean.note,
        },
        { onConflict: ITEM_CONFLICT_KEY }
      );
      if (error) throw error;
    }
    return { success: true };
  } catch (error) {
    console.error("Error in saveTradeItemAction:", error);
    return { success: false, error: "Failed to save trade list" };
  }
}

/** Sharing needs a username, since the link is /trades/<username>. */
export async function setTradeListSharedAction(isShared: boolean) {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { success: false, error: "You must be logged in" };

    if (isShared) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();
      if (!profile?.username) return { success: false, needsUsername: true };
    }

    const { error } = await supabase
      .from("trade_lists")
      .upsert({ user_id: user.id, is_shared: isShared }, { onConflict: "user_id" });
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error("Error in setTradeListSharedAction:", error);
    return { success: false, error: "Failed to update sharing" };
  }
}

/**
 * Loads the list behind /trades/<username>. RLS hides unshared lists from
 * everyone but the owner; `isOwner` lets the page tell the owner their list
 * is still private instead of 404ing them.
 */
export async function loadPublicTradeListAction(username: string): Promise<{
  found: boolean;
  previewMode?: boolean;
  username?: string;
  items?: TradeItem[];
  isShared?: boolean;
  isOwner?: boolean;
  updatedAt?: string | null;
}> {
  try {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username")
      .eq("username", username)
      .maybeSingle();
    if (!profile?.username) return { found: false };

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const isOwner = user?.id === profile.id;

    const [listResult, itemsResult] = await Promise.all([
      supabase.from("trade_lists").select("is_shared").eq("user_id", profile.id).maybeSingle(),
      supabase.from("trade_list_items").select(`${ITEM_COLUMNS}, updated_at`).eq("user_id", profile.id),
    ]);

    if (isMissingTableError(listResult.error) || isMissingTableError(itemsResult.error)) {
      return { found: true, previewMode: true, username: profile.username, isOwner, items: [], isShared: false };
    }
    if (listResult.error) throw listResult.error;
    if (itemsResult.error) throw itemsResult.error;

    const isShared = listResult.data?.is_shared ?? false;
    if (!isShared && !isOwner) return { found: false };

    const rows = (itemsResult.data || []) as (TradeItemRow & { updated_at: string })[];
    // "Last updated" reflects the newest item change, not the sharing toggle.
    const updatedAt = rows.reduce<string | null>(
      (latest, r) => (!latest || r.updated_at > latest ? r.updated_at : latest),
      null
    );

    return {
      found: true,
      username: profile.username,
      items: rows.map(rowToItem),
      isShared,
      isOwner,
      updatedAt,
    };
  } catch (error) {
    console.error("Error in loadPublicTradeListAction:", error);
    return { found: false };
  }
}
