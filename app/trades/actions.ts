"use server";

import { createClient } from "../../utils/supabase/server";
import { pgrestInList } from "@/lib/pricing/helpers";
import {
  clampTradeQuantity,
  mergeWants,
  normalizeTradeItem,
  type TradeItem,
  type TradeKind,
} from "./lib/tradeList";
import {
  cleanTradeLogText,
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

async function getAuthedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null };
  return { supabase, user };
}

// PostgREST caps a select at 1000 rows; "Add my spares" can list more
// printings than that, so reads page like loadCollectionAction does.
const PAGE_SIZE = 1000;

async function loadAllItems<T extends TradeItemRow>(
  supabase: any,
  userId: string,
  columns: string = ITEM_COLUMNS
): Promise<T[]> {
  let rows: T[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch, error } = await supabase
      .from("trade_list_items")
      .select(columns)
      .eq("user_id", userId)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows = rows.concat(batch || []);
    hasMore = (batch?.length || 0) === PAGE_SIZE;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function loadMyTradeListAction(): Promise<{
  success: boolean;
  error?: string;
  items: TradeItem[];
  isShared: boolean;
  username: string | null;
}> {
  const empty = { items: [] as TradeItem[], isShared: false, username: null };
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { success: false, error: "You must be logged in", ...empty };

    const [{ data: profile }, rows, listResult] = await Promise.all([
      supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
      loadAllItems(supabase, user.id),
      supabase.from("trade_lists").select("is_shared").eq("user_id", user.id).maybeSingle(),
    ]);
    if (listResult.error) throw listResult.error;

    return {
      success: true,
      items: rows.map(rowToItem),
      isShared: listResult.data?.is_shared ?? false,
      username: profile?.username ?? null,
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
      const { error } = await supabase
        .from("trade_list_items")
        .upsert(toRow(user.id, clean), { onConflict: ITEM_CONFLICT_KEY });
      if (error) throw error;
    }
    return { success: true };
  } catch (error) {
    console.error("Error in saveTradeItemAction:", error);
    return { success: false, error: "Failed to save trade list" };
  }
}

const UPSERT_CHUNK_SIZE = 500;
const NAME_CHUNK_SIZE = 100;
// Match lookups are bounded by the owner's list in practice; this caps what a
// caller of the action can ask for directly.
const MAX_MATCH_NAMES = 5000;

function toRow(userId: string, item: TradeItem) {
  return {
    user_id: userId,
    kind: item.kind,
    card_name: item.cardName,
    card_set: item.cardSet,
    card_img_file: item.cardImgFile,
    any_version: item.anyVersion,
    priority: item.priority,
    quantity: item.quantity,
    note: item.note,
  };
}

async function upsertItems(supabase: any, userId: string, items: TradeItem[]) {
  for (let i = 0; i < items.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = items.slice(i, i + UPSERT_CHUNK_SIZE).map((item) => toRow(userId, item));
    const { error } = await supabase.from("trade_list_items").upsert(chunk, { onConflict: ITEM_CONFLICT_KEY });
    if (error) throw error;
  }
}

/** Upserts many items at once (bulk adds). Items with quantity 0 are skipped. */
export async function saveTradeItemsAction(items: TradeItem[]) {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { success: false, error: "You must be logged in" };
    const clean = items.map(normalizeTradeItem).filter((i) => i.quantity > 0);
    await upsertItems(supabase, user.id, clean);
    return { success: true };
  } catch (error) {
    console.error("Error in saveTradeItemsAction:", error);
    return { success: false, error: "Failed to save trade list" };
  }
}

/** Adds Wants (e.g. a deck's missing cards), merged with existing Wants via mergeWants. */
export async function addWantsAction(
  incoming: TradeItem[]
): Promise<{ success: boolean; error?: string; added?: number }> {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { success: false, error: "Sign in to save Wants" };
    const existing = (await loadAllItems(supabase, user.id)).map(rowToItem).filter((i) => i.kind === "want");
    const changes = mergeWants(existing, incoming);
    await upsertItems(supabase, user.id, changes);
    return { success: true, added: changes.length };
  } catch (error) {
    console.error("Error in addWantsAction:", error);
    return { success: false, error: "Failed to add Wants" };
  }
}

/**
 * What a signed-in visitor brings to someone else's list: the visitor's owned
 * printings among the owner's Want names, and the visitor's Wants among the
 * owner's Have names. Restricted by name so the page payload stays small.
 */
export async function loadVisitorMatchDataAction(names: {
  wantNames: string[];
  haveNames: string[];
}): Promise<{
  signedIn: boolean;
  owned: Record<string, number>;
  wants: TradeItem[];
}> {
  const empty = { owned: {}, wants: [] as TradeItem[] };
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) return { signedIn: false, ...empty };

    // Card names carry quotes and commas; pgrestInList quotes them so
    // PostgREST's in() parse doesn't silently drop the rest of the list.
    // Chunks run in parallel: this sits on the public page's request path.
    const chunksOf = (all: string[]) => {
      const unique = Array.from(new Set(all)).slice(0, MAX_MATCH_NAMES);
      const chunks: string[][] = [];
      for (let i = 0; i < unique.length; i += NAME_CHUNK_SIZE) chunks.push(unique.slice(i, i + NAME_CHUNK_SIZE));
      return chunks;
    };

    const [ownedResults, wantResults] = await Promise.all([
      Promise.all(
        chunksOf(names.wantNames).map((chunk) =>
          supabase
            .from("collection_cards")
            .select("card_name, card_set, card_img_file, quantity")
            .eq("user_id", user.id)
            .filter("card_name", "in", pgrestInList(chunk))
        )
      ),
      Promise.all(
        chunksOf(names.haveNames).map((chunk) =>
          supabase
            .from("trade_list_items")
            .select(ITEM_COLUMNS)
            .eq("user_id", user.id)
            .eq("kind", "want")
            .filter("card_name", "in", pgrestInList(chunk))
        )
      ),
    ]);

    const owned: Record<string, number> = {};
    for (const { data, error } of ownedResults) {
      if (error) throw error;
      for (const r of data || []) owned[`${r.card_name}|${r.card_set}|${r.card_img_file}`] = r.quantity;
    }
    const wants: TradeItem[] = [];
    for (const { data, error } of wantResults) {
      if (error) throw error;
      wants.push(...((data || []) as TradeItemRow[]).map(rowToItem));
    }
    return { signedIn: true, owned, wants };
  } catch (error) {
    console.error("Error in loadVisitorMatchDataAction:", error);
    return { signedIn: false, ...empty };
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

    const [listResult, rows] = await Promise.all([
      supabase.from("trade_lists").select("is_shared").eq("user_id", profile.id).maybeSingle(),
      loadAllItems<TradeItemRow & { updated_at: string }>(supabase, profile.id, `${ITEM_COLUMNS}, updated_at`),
    ]);
    if (listResult.error) throw listResult.error;

    const isShared = listResult.data?.is_shared ?? false;
    if (!isShared && !isOwner) return { found: false };

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
    if (error) throw error;
    return { success: true, entries: (data || []).map(rowToEntry) };
  } catch (error) {
    console.error("Error in loadTradeLogAction:", error);
    return { success: false, error: "Failed to load trade log", entries: [] };
  }
}

/**
 * Records a trade and applies it to the collection (received copies added,
 * given copies removed, floored at 0) in one transaction, via the log_trade
 * RPC from migration 120.
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
    const tradedOn = /^\d{4}-\d{2}-\d{2}$/.test(input.tradedOn) ? input.tradedOn : null;

    const { data, error } = await supabase.rpc("log_trade", {
      p_traded_on: tradedOn,
      p_partner: cleanTradeLogText(input.partner, MAX_PARTNER_LENGTH),
      p_notes: cleanTradeLogText(input.notes, MAX_TRADE_LOG_NOTES_LENGTH),
      p_cards: cards,
    });
    if (error) throw error;
    return { success: true, entry: rowToEntry(data as TradeLogRow) };
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
