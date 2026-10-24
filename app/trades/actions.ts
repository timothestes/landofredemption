"use server";

import { createClient } from "../../utils/supabase/server";
import { clampTradeQuantity, normalizeTradeItem, type TradeItem, type TradeKind } from "./lib/tradeList";
import {
  applyCollectionDeltas,
  cleanTradeLogText,
  collectionDeltas,
  MAX_PARTNER_LENGTH,
  MAX_TRADE_LOG_NOTES_LENGTH,
  type TradeLogCard,
  type TradeLogEntry,
} from "./lib/tradeLog";

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

// ---------------------------------------------------------------------------
// Trade log (private)

const MAX_CARDS_PER_TRADE = 200;

interface TradeLogRow {
  id: string;
  traded_on: string;
  partner: string;
  notes: string;
  cards: TradeLogCard[];
  created_at: string;
}

function rowToEntry(row: TradeLogRow): TradeLogEntry {
  return {
    id: row.id,
    tradedOn: row.traded_on,
    partner: row.partner,
    notes: row.notes,
    cards: row.cards,
    createdAt: row.created_at,
  };
}

function cleanLogCards(cards: TradeLogCard[]): TradeLogCard[] {
  return cards
    .filter((c) => (c.direction === "gave" || c.direction === "received") && c.cardName)
    .slice(0, MAX_CARDS_PER_TRADE)
    .map((c) => ({
      direction: c.direction,
      cardName: String(c.cardName),
      cardSet: String(c.cardSet ?? ""),
      cardImgFile: String(c.cardImgFile ?? ""),
      quantity: clampTradeQuantity(c.quantity),
      unitPrice:
        typeof c.unitPrice === "number" && Number.isFinite(c.unitPrice) && c.unitPrice >= 0
          ? Math.round(c.unitPrice * 100) / 100
          : null,
    }))
    .filter((c) => c.quantity > 0);
}

export async function loadTradeLogAction(): Promise<{
  success: boolean;
  error?: string;
  previewMode?: boolean;
  entries: TradeLogEntry[];
}> {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { success: false, error: "You must be logged in", entries: [] };
    const { data, error } = await supabase
      .from("trade_log")
      .select("id, traded_on, partner, notes, cards, created_at")
      .eq("user_id", user.id)
      .order("traded_on", { ascending: false })
      .order("created_at", { ascending: false });
    if (isMissingTableError(error)) return { success: true, previewMode: true, entries: [] };
    if (error) throw error;
    return { success: true, entries: (data || []).map(rowToEntry) };
  } catch (error) {
    console.error("Error in loadTradeLogAction:", error);
    return { success: false, error: "Failed to load trade log", entries: [] };
  }
}

/**
 * Records a trade, then applies it to the collection: received copies are
 * added, given copies removed (floored at 0). The log row is written first so
 * a collection failure never loses the record.
 */
export async function logTradeAction(input: {
  tradedOn: string;
  partner: string;
  notes: string;
  cards: TradeLogCard[];
}): Promise<{ success: boolean; error?: string; entry?: TradeLogEntry }> {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { success: false, error: "You must be logged in" };

    const cards = cleanLogCards(input.cards);
    if (cards.length === 0) return { success: false, error: "Add at least one card" };
    const tradedOn = /^\d{4}-\d{2}-\d{2}$/.test(input.tradedOn) ? input.tradedOn : undefined;

    const { data, error } = await supabase
      .from("trade_log")
      .insert({
        user_id: user.id,
        ...(tradedOn && { traded_on: tradedOn }),
        partner: cleanTradeLogText(input.partner, MAX_PARTNER_LENGTH),
        notes: cleanTradeLogText(input.notes, MAX_TRADE_LOG_NOTES_LENGTH),
        cards,
      })
      .select("id, traded_on, partner, notes, cards, created_at")
      .single();
    if (error) throw error;
    const entry = rowToEntry(data as TradeLogRow);

    const deltas = collectionDeltas(cards);
    const current = new Map<string, number>();
    for (const key of deltas.keys()) {
      const [name, set, imgFile] = key.split("|");
      const { data: row, error: readError } = await supabase
        .from("collection_cards")
        .select("quantity")
        .eq("user_id", user.id)
        .eq("card_name", name)
        .eq("card_set", set)
        .eq("card_img_file", imgFile)
        .maybeSingle();
      if (readError) throw readError;
      current.set(key, row?.quantity ?? 0);
    }

    const next = applyCollectionDeltas(current, deltas);
    for (const [key, quantity] of next) {
      const [name, set, imgFile] = key.split("|");
      const { error: writeError } =
        quantity === 0
          ? await supabase
              .from("collection_cards")
              .delete()
              .eq("user_id", user.id)
              .eq("card_name", name)
              .eq("card_set", set)
              .eq("card_img_file", imgFile)
          : await supabase.from("collection_cards").upsert(
              {
                user_id: user.id,
                card_name: name,
                card_set: set,
                card_img_file: imgFile,
                quantity,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id,card_name,card_set,card_img_file" }
            );
      if (writeError) {
        console.error("Trade logged but collection update failed:", writeError);
        return {
          success: true,
          entry,
          error: "Trade saved, but your collection couldn't be fully updated. Check those cards.",
        };
      }
    }

    return { success: true, entry };
  } catch (error) {
    console.error("Error in logTradeAction:", error);
    return { success: false, error: "Failed to log trade" };
  }
}

/** Removes the record only; the collection is left as it is. */
export async function deleteTradeLogAction(id: string) {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { success: false, error: "You must be logged in" };
    const { error } = await supabase.from("trade_log").delete().eq("user_id", user.id).eq("id", id);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error("Error in deleteTradeLogAction:", error);
    return { success: false, error: "Failed to delete trade" };
  }
}
