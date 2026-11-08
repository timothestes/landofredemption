"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { diffCards } from "@/app/forge/lib/cardDiff";
import { ACCEPT_NEEDS_NAME_AND_TYPE } from "@/app/forge/lib/proposeCopy";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type ProposalStatus = "open" | "accepted" | "denied" | "superseded";

export type ProposalRow = {
  id: string;
  cardId: string;
  baseVersionId: string | null;
  resultingVersionId: string | null;
  closedBy: string | null;
  summary: string | null;
  status: ProposalStatus;
  proposedSnapshot: DesignCard;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  // Display names resolved from playtest_members (null until listProposals
  // enriches them). proposerName = who authored the proposal; approverName =
  // who closed it (the accepting elder on an accept). Preserves proposer
  // credit in History even though the resulting version is stamped to the
  // approver.
  proposerName: string | null;
  approverName: string | null;
};

export type ProposalDiffData = { proposal: ProposalRow; current: DesignCard };

const COLS =
  "id, card_id, base_version_id, resulting_version_id, summary, status, proposed_snapshot, created_by, created_at, closed_at, closed_by";

function toProposal(row: any): ProposalRow {
  return {
    id: row.id,
    cardId: row.card_id,
    baseVersionId: row.base_version_id ?? null,
    resultingVersionId: row.resulting_version_id ?? null,
    closedBy: row.closed_by ?? null,
    summary: row.summary ?? null,
    status: row.status,
    proposedSnapshot: (row.proposed_snapshot ?? {}) as DesignCard,
    createdBy: row.created_by,
    createdAt: row.created_at,
    closedAt: row.closed_at ?? null,
    proposerName: null,
    approverName: null,
  };
}

// Resolve user UUIDs -> display names (member-readable). Same pattern as versions.ts / comments.ts.
async function nameMap(
  ctx: NonNullable<Awaited<ReturnType<typeof requireForge>>>,
  ids: string[]
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await ctx.supabase
    .from("playtest_members")
    .select("user_id, display_name")
    .in("user_id", [...new Set(ids)]);
  return new Map((data ?? []).map((m: any) => [m.user_id, m.display_name]));
}

export async function createProposal(
  cardId: string,
  summary: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireForge();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (!summary.trim()) return { ok: false, error: "A summary is required" };

  // The proposal freezes the card's SAVED working draft (server truth). The
  // editor autosaves within ~1s and proposing happens after typing a summary,
  // so the draft is current by submit time; server truth is also what the
  // no-op guard below compares.
  const { data: card } = await ctx.supabase
    .from("forge_cards")
    .select("working_snapshot")
    .eq("id", cardId)
    .maybeSingle();
  if (!card) return { ok: false, error: "Card not found" };
  const snapshot = (card.working_snapshot ?? {}) as DesignCard;

  // No-op guard: a proposal must differ from the card's LATEST version of any
  // status — draft iterations included — matching the base the RPC records and
  // the diff the reviewer will see. Cards with no versions ({} base) still
  // allow a first real proposal.
  const { data: latest } = await ctx.supabase
    .from("card_versions")
    .select("data")
    .eq("card_id", cardId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = (latest?.data ?? {}) as DesignCard;
  if (diffCards(base, snapshot).length === 0) {
    return { ok: false, error: "No changes to review since the last accepted version." };
  }

  const { data, error } = await ctx.supabase.rpc("forge_create_proposal", {
    p_card_id: cardId,
    p_snapshot: snapshot,
    p_summary: summary,
  });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create proposal" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true, id: data };
}

// `closed` = the proposal is no longer open, so there is nothing left to retry.
export async function acceptProposal(
  proposalId: string
): Promise<{ ok: boolean; error?: string; closed?: boolean }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_accept_proposal", {
    p_proposal_id: proposalId,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("needs a name and a type") ? ACCEPT_NEEDS_NAME_AND_TYPE : "Could not accept proposal",
    };
  }
  // Since migration 083 a release closes open proposals itself, so a stale base
  // here means a genuine race: someone released while this review was open.
  if (data === null) {
    return {
      ok: false,
      error:
        "A newer version was released while this was open, so this proposal was closed. Re-propose from the current draft if the change is still needed.",
      closed: true,
    };
  }
  // Lifecycle change ripples to set/card/queue views.
  revalidatePath("/forge", "layout");
  return { ok: true };
}

// `restoreDraft` also puts the working draft back to the card's latest version, in the same
// transaction. The caller flushes the editor first (see flushThen).
export async function denyProposal(
  proposalId: string,
  cardId: string,
  reason: string,
  restoreDraft = false
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (!reason.trim()) return { ok: false, error: "A reason is required" };
  const { error } = await ctx.supabase.rpc(
    restoreDraft ? "forge_deny_proposal_restore_draft" : "forge_deny_proposal",
    { p_proposal_id: proposalId, p_reason: reason },
  );
  if (error) return { ok: false, error: "Could not deny proposal" };
  // Restoring can change the title, which set views show.
  if (restoreDraft) revalidatePath("/forge", "layout");
  else revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function listProposals(cardId: string): Promise<ProposalRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_proposals")
    .select(COLS)
    .eq("card_id", cardId)
    .order("created_at", { ascending: false });
  const proposals = (data ?? []).map(toProposal);
  const names = await nameMap(
    ctx,
    proposals.flatMap((p) => [p.createdBy, p.closedBy].filter((x): x is string => !!x))
  );
  return proposals.map((p) => ({
    ...p,
    proposerName: names.get(p.createdBy) ?? null,
    approverName: p.closedBy ? names.get(p.closedBy) ?? null : null,
  }));
}

export async function getOpenProposalDiffs(cardId: string): Promise<ProposalDiffData[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data: rows } = await ctx.supabase
    .from("card_proposals")
    .select(COLS)
    .eq("card_id", cardId)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  const proposals = (rows ?? []).map(toProposal);
  const baseIds = proposals
    .map((p) => p.baseVersionId)
    .filter((x): x is string => !!x);
  const baseMap = new Map<string, DesignCard>();
  if (baseIds.length) {
    const { data: vers } = await ctx.supabase
      .from("card_versions")
      .select("id, data")
      .in("id", baseIds);
    for (const v of vers ?? []) baseMap.set(v.id, (v.data ?? {}) as DesignCard);
  }
  const names = await nameMap(ctx, proposals.map((p) => p.createdBy));
  return proposals.map((p) => ({
    proposal: { ...p, proposerName: names.get(p.createdBy) ?? null },
    current: p.baseVersionId ? baseMap.get(p.baseVersionId) ?? {} : {},
  }));
}

// Per-card count of open proposals for a set of card ids — drives the grid badge.
// Mirrors listUnresolvedCommentCounts; runs under the caller's RLS, only counts
// cross to the client.
export async function listOpenProposalCounts(
  cardIds: string[]
): Promise<Record<string, number>> {
  const ctx = await requireForge();
  if (!ctx || cardIds.length === 0) return {};
  const { data } = await ctx.supabase
    .from("card_proposals")
    .select("card_id")
    .in("card_id", cardIds)
    .eq("status", "open");
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = (row as any).card_id as string;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
