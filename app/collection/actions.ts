"use server";

import { createClient } from "../../utils/supabase/server";
import { isKnownCardKey } from "@/lib/scan/cardKeys";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { pgrestInList } from "@/lib/pricing/helpers";
import type { ClientOutcome } from "./scan/lib/outcomes";
import {
  runCommit,
  runUndo,
  validateCommitInput,
  splitKey,
  UUID,
  type CommitResult,
  type UndoResult,
} from "./scan/lib/commitCore";

export interface CollectionCardRow {
  card_name: string;
  card_set: string;
  card_img_file: string;
  quantity: number;
}

const PAGE_SIZE = 1000;
const UPSERT_CHUNK_SIZE = 500;
const CONFLICT_KEY = "user_id,card_name,card_set,card_img_file";

async function getAuthedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase: null, user: null };
  }
  return { supabase, user };
}

/** Load every row for the user's collection, batched past the 1000-row limit. */
async function loadAllRows(supabase: any, userId: string): Promise<CollectionCardRow[]> {
  let rows: CollectionCardRow[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const { data: batch, error } = await supabase
      .from("collection_cards")
      .select("card_name, card_set, card_img_file, quantity")
      .eq("user_id", userId)
      .order("card_name")
      .order("card_set")
      .order("card_img_file")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    rows = rows.concat(batch || []);
    hasMore = (batch?.length || 0) === PAGE_SIZE;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function loadCollectionAction() {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, error: "You must be logged in to view your collection", cards: [] as CollectionCardRow[] };
    }
    const cards = await loadAllRows(supabase, user.id);
    return { success: true, cards };
  } catch (error) {
    console.error("Error in loadCollectionAction:", error);
    return { success: false, error: "Failed to load collection", cards: [] as CollectionCardRow[] };
  }
}

export async function setCollectionCardQuantityAction(
  cardName: string,
  cardSet: string,
  cardImgFile: string,
  quantity: number
) {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, error: "You must be logged in to manage your collection" };
    }

    if (quantity <= 0) {
      const { error } = await supabase
        .from("collection_cards")
        .delete()
        .eq("user_id", user.id)
        .eq("card_name", cardName)
        .eq("card_set", cardSet)
        .eq("card_img_file", cardImgFile);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("collection_cards").upsert(
        {
          user_id: user.id,
          card_name: cardName,
          card_set: cardSet,
          card_img_file: cardImgFile,
          quantity,
          updated_at: new Date().toISOString(),
        },
        { onConflict: CONFLICT_KEY }
      );
      if (error) throw error;
    }

    return { success: true };
  } catch (error) {
    console.error("Error in setCollectionCardQuantityAction:", error);
    return { success: false, error: "Failed to update collection" };
  }
}

/**
 * Bulk import rows from CSV.
 *  - merge:   add imported quantities to existing ones
 *  - replace: wipe the collection, then insert imported rows
 * Rows with the same identity are pre-summed; quantities are clamped to >= 1.
 */
export async function bulkImportCollectionAction(
  rows: CollectionCardRow[],
  mode: "merge" | "replace"
) {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, error: "You must be logged in to import a collection" };
    }

    // Collapse duplicate identities within the import itself
    const incoming = new Map<string, CollectionCardRow>();
    for (const row of rows) {
      if (!row.card_name || row.quantity <= 0) continue;
      const key = `${row.card_name}|${row.card_set}|${row.card_img_file}`;
      const existing = incoming.get(key);
      if (existing) {
        existing.quantity += row.quantity;
      } else {
        incoming.set(key, { ...row });
      }
    }

    if (mode === "replace") {
      const { error } = await supabase
        .from("collection_cards")
        .delete()
        .eq("user_id", user.id);
      if (error) throw error;
    } else {
      // Merge: add to existing quantities
      const current = await loadAllRows(supabase, user.id);
      for (const row of current) {
        const key = `${row.card_name}|${row.card_set}|${row.card_img_file}`;
        const imported = incoming.get(key);
        if (imported) imported.quantity += row.quantity;
      }
    }

    const now = new Date().toISOString();
    const toUpsert = Array.from(incoming.values()).map((row) => ({
      user_id: user.id,
      card_name: row.card_name,
      card_set: row.card_set,
      card_img_file: row.card_img_file,
      quantity: row.quantity,
      updated_at: now,
    }));

    for (let i = 0; i < toUpsert.length; i += UPSERT_CHUNK_SIZE) {
      const chunk = toUpsert.slice(i, i + UPSERT_CHUNK_SIZE);
      const { error } = await supabase
        .from("collection_cards")
        .upsert(chunk, { onConflict: CONFLICT_KEY });
      if (error) throw error;
    }

    return { success: true, imported: toUpsert.length };
  } catch (error) {
    console.error("Error in bulkImportCollectionAction:", error);
    return { success: false, error: "Failed to import collection" };
  }
}

export async function clearCollectionAction() {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, error: "You must be logged in to manage your collection" };
    }
    const { error } = await supabase
      .from("collection_cards")
      .delete()
      .eq("user_id", user.id);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error("Error in clearCollectionAction:", error);
    return { success: false, error: "Failed to clear collection" };
  }
}

/**
 * Owned quantities aggregated by `name|set` (summed across printings/imgFiles).
 * Used by the YTG cart to subtract cards the user already owns. Returns an
 * empty map when signed out so callers can degrade gracefully.
 */
export async function getOwnedQuantitiesAction(): Promise<{
  success: boolean;
  owned: Record<string, number>;
}> {
  try {
    const { supabase, user } = await getAuthedClient();
    if (!user) {
      return { success: false, owned: {} };
    }
    const rows = await loadAllRows(supabase, user.id);
    const owned: Record<string, number> = {};
    for (const row of rows) {
      const key = `${row.card_name}|${row.card_set}`;
      owned[key] = (owned[key] || 0) + row.quantity;
    }
    return { success: true, owned };
  } catch (error) {
    console.error("Error in getOwnedQuantitiesAction:", error);
    return { success: false, owned: {} };
  }
}

// --- Card scanner commit and undo ---
// Logic lives in ./scan/lib/commitCore.ts. scan_events/scan_commits are
// SELECT-only for authenticated, so writes go through the service-role client,
// always filtered by the verified user id; collection_cards uses the user's client.

export async function commitScanAction(
  commitId: string,
  rows: { key: string; qty: number }[],
  outcomesByScanId: Record<string, ClientOutcome[]>
): Promise<CommitResult> {
  const { user } = await getAuthedClient();
  if (!user) return { ok: false, code: "unauthorized" };
  const payload = validateCommitInput(commitId, { rows, outcomesByScanId }, isKnownCardKey);
  if (!payload) return { ok: false, code: "bad_request" };

  const admin = getSupabaseAdmin();
  const userId = user.id;
  return runCommit(
    {
      userId,
      loadScans: async (ids) => {
        if (ids.length === 0) return [];
        const { data, error } = await admin
          .from("scan_events")
          .select("id, user_id, status, detections, commit_id")
          .eq("user_id", userId)
          .in("id", ids);
        if (error) throw error;
        return data ?? [];
      },
      insertCommit: async (row) => {
        // INSERT ... ON CONFLICT (commit_id) DO NOTHING RETURNING commit_id
        const { data, error } = await admin
          .from("scan_commits")
          .upsert(row, { onConflict: "commit_id", ignoreDuplicates: true })
          .select("commit_id");
        if (error) throw error;
        return (data ?? []).length === 1;
      },
      getCommit: async (id) => {
        // Not filtered by user: runCommit tells a foreign id (bad_request) from in-progress.
        const { data, error } = await admin
          .from("scan_commits")
          .select("commit_id, user_id, created_at, deltas, result")
          .eq("commit_id", id)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      deleteCommit: async (id) => {
        const { error } = await admin
          .from("scan_commits")
          .delete()
          .eq("commit_id", id)
          .eq("user_id", userId)
          .is("result", null);
        if (error) throw error;
      },
      claimScans: async (cid, scanIds, undoneIds) => {
        // Up to three single-statement conditional updates, each
        //   UPDATE scan_events SET commit_id = $cid
        //    WHERE user_id = $user AND id IN (...scanIds) AND <one condition> RETURNING id
        // and the claimed count is their sum. Not one .or(): this project's PostgREST
        // rejects or=(...) on PATCH (42703 "column scan_events.commit_id does not exist").
        // Each statement is atomic per row (row lock + WHERE re-check), so a competing
        // commit cannot take a row we claimed. `= cid` runs FIRST so rows the later
        // statements move to cid are not counted twice.
        const conditions: Array<(q: any) => any> = [
          (q) => q.eq("commit_id", cid),
          (q) => q.is("commit_id", null),
        ];
        if (undoneIds.length > 0) conditions.push((q) => q.in("commit_id", undoneIds));
        let claimed = 0;
        for (const where of conditions) {
          const { data, error } = await where(
            admin.from("scan_events").update({ commit_id: cid }).eq("user_id", userId).in("id", scanIds)
          ).select("id");
          if (error) throw error;
          claimed += (data ?? []).length;
        }
        return claimed;
      },
      releaseScans: async (cid) => {
        const { error } = await admin
          .from("scan_events")
          .update({ commit_id: null })
          .eq("commit_id", cid)
          .eq("user_id", userId);
        if (error) throw error;
      },
      merge: async (mergeRows) => (await bulkImportCollectionAction(mergeRows, "merge")).success,
      writeOutcomes: async (scanId, outcomes, cid) => {
        // commit_id was set by claimScans; write only where this commit still holds the scan.
        const { error } = await admin
          .from("scan_events")
          .update({ outcomes })
          .eq("id", scanId)
          .eq("user_id", userId)
          .eq("commit_id", cid);
        if (error) throw error;
      },
      storeResult: async (id, result) => {
        const { error } = await admin
          .from("scan_commits")
          .update({ result })
          .eq("commit_id", id)
          .eq("user_id", userId);
        if (error) throw error;
      },
    },
    commitId,
    payload
  );
}

export async function adjustCollectionQuantitiesAction(commitId: string): Promise<UndoResult> {
  const { supabase, user } = await getAuthedClient();
  if (!user || !supabase) return { ok: false, code: "unauthorized" };
  if (typeof commitId !== "string" || !UUID.test(commitId)) return { ok: false, code: "not_found" };

  const admin = getSupabaseAdmin();
  const userId = user.id;
  return runUndo(
    {
      userId,
      getCommit: async (id) => {
        const { data, error } = await admin
          .from("scan_commits")
          .select("commit_id, user_id, created_at, deltas, result")
          .eq("commit_id", id)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) throw error;
        return data;
      },
      hasLaterCommit: async (uid, createdAt) => {
        const { count, error } = await admin
          .from("scan_commits")
          .select("commit_id", { count: "exact", head: true })
          .eq("user_id", uid)
          .gt("created_at", createdAt)
          // Only a later add that landed and is still live blocks undo: not one undone, or one that never finished.
          .eq("result->>ok", "true")
          .is("result->>undoneAt", null);
        if (error) throw error;
        return (count ?? 0) > 0;
      },
      claimUndo: async (id, result) => {
        // UPDATE scan_commits SET result = $1
        //  WHERE commit_id = $2 AND user_id = $3 AND result->>'undoneAt' IS NULL
        //  RETURNING commit_id
        const { data, error } = await admin
          .from("scan_commits")
          .update({ result })
          .eq("commit_id", id)
          .eq("user_id", userId)
          .is("result->>undoneAt", null)
          .select("commit_id");
        if (error) throw error;
        return (data ?? []).length === 1;
      },
      storeUndoResult: async (id, result) => {
        const { error } = await admin
          .from("scan_commits")
          .update({ result })
          .eq("commit_id", id)
          .eq("user_id", userId);
        if (error) throw error;
      },
      currentQuantities: async (keys) => {
        const out: Record<string, number> = {};
        const names = [...new Set(keys.map((k) => splitKey(k).card_name))];
        // pgrestInList, not .in(): Lost Soul names carry double quotes that .in() drops rows on.
        for (let i = 0; i < names.length; i += 100) {
          const { data, error } = await supabase
            .from("collection_cards")
            .select("card_name, card_set, card_img_file, quantity")
            .eq("user_id", userId)
            .filter("card_name", "in", pgrestInList(names.slice(i, i + 100)));
          if (error) throw error;
          for (const r of (data ?? []) as CollectionCardRow[]) {
            out[`${r.card_name}|${r.card_set}|${r.card_img_file}`] = r.quantity;
          }
        }
        return out;
      },
      setQuantity: async (key, qty) => {
        const { card_name, card_set, card_img_file } = splitKey(key);
        if (qty <= 0) {
          const { error } = await supabase
            .from("collection_cards")
            .delete()
            .eq("user_id", userId)
            .eq("card_name", card_name)
            .eq("card_set", card_set)
            .eq("card_img_file", card_img_file);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("collection_cards").upsert(
            { user_id: userId, card_name, card_set, card_img_file, quantity: qty, updated_at: new Date().toISOString() },
            { onConflict: CONFLICT_KEY }
          );
          if (error) throw error;
        }
      },
    },
    commitId
  );
}
