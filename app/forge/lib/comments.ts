"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";

export type CommentRow = {
  id: string;
  cardId: string;
  proposalId: string | null;
  field: string | null;
  suggestedValue: unknown;
  parentId: string | null;
  body: string;
  resolved: boolean;
  createdBy: string;
  createdAt: string;
  authorName: string | null;
};

const COLS =
  "id, card_id, proposal_id, field, suggested_value, parent_comment_id, body, resolved, created_by, created_at";

function toComment(row: any): CommentRow {
  return {
    id: row.id,
    cardId: row.card_id,
    proposalId: row.proposal_id ?? null,
    field: row.field ?? null,
    suggestedValue: row.suggested_value ?? null,
    parentId: row.parent_comment_id ?? null,
    body: row.body,
    resolved: !!row.resolved,
    createdBy: row.created_by,
    createdAt: row.created_at,
    authorName: null,
  };
}

// Resolve author UUIDs -> display names (member-readable). Same pattern as sets.ts.
async function resolveAuthorNames(
  ctx: NonNullable<Awaited<ReturnType<typeof requireForge>>>,
  rows: CommentRow[]
): Promise<CommentRow[]> {
  if (rows.length === 0) return rows;
  const ids = [...new Set(rows.map((r) => r.createdBy))];
  const { data: members } = await ctx.supabase
    .from("playtest_members")
    .select("user_id, display_name")
    .in("user_id", ids);
  const names = new Map((members ?? []).map((m: any) => [m.user_id, m.display_name]));
  return rows.map((r) => ({ ...r, authorName: names.get(r.createdBy) ?? "Forge member" }));
}

export async function listComments(cardId: string): Promise<CommentRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_comments")
    .select(COLS)
    .eq("card_id", cardId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []).map(toComment);
  return resolveAuthorNames(ctx, rows);
}

// Card-level thread only (proposal_id IS NULL) with author names. Used by the
// playtester reveal modal; runs under the caller's session so RLS applies.
export async function listCardComments(cardId: string): Promise<CommentRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_comments")
    .select(COLS)
    .eq("card_id", cardId)
    .is("proposal_id", null)
    .order("created_at", { ascending: true });
  const rows = (data ?? []).map(toComment);
  return resolveAuthorNames(ctx, rows);
}

export async function addComment(input: {
  cardId: string;
  proposalId?: string | null;
  parentId?: string | null;
  field?: string | null;
  suggestedValue?: unknown;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (!input.body.trim()) return { ok: false, error: "Comment cannot be empty" };
  const { error } = await ctx.supabase.rpc("forge_add_comment", {
    p_card_id: input.cardId,
    p_proposal_id: input.proposalId ?? null,
    p_parent_id: input.parentId ?? null,
    p_field: input.field ?? null,
    p_suggested_value: input.suggestedValue ?? null,
    p_body: input.body,
  });
  if (error) return { ok: false, error: "Could not add comment" };
  revalidatePath(`/forge/cards/${input.cardId}`);
  return { ok: true };
}

export async function resolveComment(
  commentId: string,
  cardId: string,
  resolved: boolean
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_resolve_comment", {
    p_comment_id: commentId,
    p_resolved: resolved,
  });
  if (error) return { ok: false, error: "Could not update comment" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function applySuggestion(
  commentId: string,
  cardId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_apply_suggestion", {
    p_comment_id: commentId,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("a promoted card is read-only") ? "A promoted card is read-only." : "Could not apply suggestion",
    };
  }
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function deleteComment(
  commentId: string,
  cardId: string
): Promise<{ ok: boolean; error?: string }> {
  // Any Forge member may call; forge_delete_comment restricts to author or set-elder/super,
  // so a playtester can only delete a comment they authored.
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_delete_comment", {
    p_comment_id: commentId,
  });
  if (error) return { ok: false, error: "Could not delete comment" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export type SetCommentRow = CommentRow & { cardTitle: string | null };

// Every comment on every card in a set, newest first, with card title + author name.
// Filtered through forge_cards.set_id with an !inner embed: card_comments' RLS policy
// is a security-definer check on card_id, so the join cannot widen or narrow it.
export async function listSetComments(
  setId: string,
  opts?: { since?: string; limit?: number }
): Promise<SetCommentRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  let q = ctx.supabase
    .from("card_comments")
    .select(`${COLS}, card:forge_cards!inner(id, title)`)
    .eq("card.set_id", setId)
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 500); // PostgREST silently caps at 1000 with no error
  if (opts?.since) q = q.gte("created_at", opts.since);
  const { data } = await q;
  const rows = (data ?? []).map((row: any) => ({ ...toComment(row), cardTitle: row.card?.title ?? null }));
  // resolveAuthorNames spreads each row, so cardTitle survives; the cast restores the type.
  return (await resolveAuthorNames(ctx, rows)) as SetCommentRow[];
}

// Per-card count of unresolved, card-level comments (proposal_id IS NULL) for a set
// of card ids. Card-level only so the badge matches what the card-level thread shows.
// Runs under the caller's RLS; only integer counts cross to the client, never bodies.
export async function listUnresolvedCommentCounts(
  cardIds: string[]
): Promise<Record<string, number>> {
  const ctx = await requireForge();
  if (!ctx || cardIds.length === 0) return {};
  const { data } = await ctx.supabase
    .from("card_comments")
    .select("card_id")
    .in("card_id", cardIds)
    .eq("resolved", false)
    .is("proposal_id", null);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = (row as any).card_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
