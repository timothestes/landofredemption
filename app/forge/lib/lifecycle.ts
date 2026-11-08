"use server";

import { revalidatePath } from "next/cache";
import { requireElder } from "@/app/forge/lib/auth";
import { isEligible, releaseBlockers, type BulkSkipReason, type LifecycleAction } from "@/app/forge/lib/lifecycleCopy";
import type { DesignCard } from "@/app/forge/lib/designCard";

type Result = { ok: boolean; error?: string };

async function call(fn: string, args: Record<string, unknown>, fail: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc(fn, args);
  if (error) return { ok: false, error: fail };
  // Card and set views both depend on lifecycle; refresh broadly.
  revalidatePath("/forge", "layout");
  return { ok: true };
}

export async function shareToSet(cardId: string, setId: string): Promise<Result> {
  return call("forge_share_card_to_set", { p_card_id: cardId, p_set_id: setId }, "Could not share card");
}
export async function sendToPrivate(cardId: string): Promise<Result> {
  return call("forge_send_card_to_private", { p_card_id: cardId }, "Could not send card to private");
}
// `unchanged`: the card already matches its published version, so nothing was minted
// (migration 127). The RPC returns null for that and the new version's id otherwise.
export async function publish(cardId: string, note?: string): Promise<Result & { unchanged?: boolean }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_publish_card", {
    p_card_id: cardId,
    p_note: note?.trim() || null,
  });
  if (error) return { ok: false, error: "Could not release card" };
  if (data === null) return { ok: true, unchanged: true };
  revalidatePath("/forge", "layout");
  return { ok: true };
}
export async function approve(cardId: string): Promise<Result> {
  return call("forge_approve_card", { p_card_id: cardId }, "Could not approve card");
}
export async function unapprove(cardId: string): Promise<Result> {
  return call("forge_unapprove_card", { p_card_id: cardId }, "Could not unapprove card");
}
export async function archive(cardId: string): Promise<Result> {
  return call("forge_archive_card", { p_card_id: cardId }, "Could not archive card");
}
export async function unarchive(cardId: string): Promise<Result> {
  return call("forge_unarchive_card", { p_card_id: cardId }, "Could not unarchive card");
}
export async function deleteCard(cardId: string): Promise<Result> {
  return call("forge_delete_card", { p_card_id: cardId }, "Could not delete card");
}

export type BulkResult =
  | { ok: true; done: number; skipped: number; failed: number; reasons?: Partial<Record<BulkSkipReason, number>> }
  | { ok: false; error: string };

const BULK_RPC: Record<LifecycleAction, string> = {
  release: "forge_publish_card",
  markFinal: "forge_approve_card",
  reopen: "forge_unapprove_card",
  shelve: "forge_archive_card",
  restore: "forge_unarchive_card",
  returnToIdeas: "forge_send_card_to_private",
  delete: "forge_delete_card",
};

type BulkRow = { id: string; status: string; working_snapshot?: DesignCard };
type BulkOutcome = "done" | "failed" | "skipped" | BulkSkipReason;

// Rows are read once up front (RLS-scoped) and each `step` skips what it can't touch
// deterministically — no Postgres error-string parsing. Ids RLS hides are skipped too.
async function runBulk(
  cardIds: string[],
  columns: string,
  step: (supabase: any, row: BulkRow) => Promise<BulkOutcome>,
): Promise<BulkResult> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (cardIds.length === 0) return { ok: true, done: 0, skipped: 0, failed: 0 };
  if (cardIds.length > 500) return { ok: false, error: "Too many cards selected" };

  const { data: rows, error: readErr } = await ctx.supabase
    .from("forge_cards")
    .select(columns)
    .in("id", cardIds);
  if (readErr) return { ok: false, error: "Could not read cards" };
  const byId = new Map<string, BulkRow>((rows ?? []).map((r: any) => [r.id as string, r as BulkRow]));

  let done = 0, skipped = 0, failed = 0;
  const reasons: Partial<Record<BulkSkipReason, number>> = {};
  for (const id of cardIds) {
    const row = byId.get(id);
    const outcome: BulkOutcome = row ? await step(ctx.supabase, row) : "skipped";
    if (outcome === "done") done++;
    else if (outcome === "failed") failed++;
    else {
      skipped++;
      if (outcome !== "skipped") reasons[outcome] = (reasons[outcome] ?? 0) + 1;
    }
  }
  revalidatePath("/forge", "layout");
  return { ok: true, done, skipped, failed, ...(Object.keys(reasons).length > 0 ? { reasons } : {}) };
}

export async function bulkLifecycle(action: LifecycleAction, cardIds: string[]): Promise<BulkResult> {
  const fn = BULK_RPC[action];
  if (!fn) return { ok: false, error: "Unknown action" };
  if (action === "release") {
    return runBulk(cardIds, "id, status, working_snapshot", async (supabase, row) => {
      if (!isEligible("release", row.status)) return "skipped";
      if (releaseBlockers(row.working_snapshot ?? {}).length > 0) return "noNameOrType";
      const { data, error } = await supabase.rpc(fn, { p_card_id: row.id });
      if (error) return "failed";
      return data === null ? "unchanged" : "done";
    });
  }
  return runBulk(cardIds, "id, status", async (supabase, row) => {
    if (!isEligible(action, row.status)) return "skipped";
    const { error } = await supabase.rpc(fn, { p_card_id: row.id });
    return error ? "failed" : "done";
  });
}

export async function bulkShareToSet(setId: string, cardIds: string[]): Promise<BulkResult> {
  return runBulk(cardIds, "id, status", async (supabase, row) => {
    if (row.status !== "private_idea") return "skipped";
    const { error } = await supabase.rpc("forge_share_card_to_set", { p_card_id: row.id, p_set_id: setId });
    return error ? "failed" : "done";
  });
}
