"use server";

import { requireForge } from "@/app/forge/lib/auth";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type VersionRow = {
  id: string;
  versionNumber: number;
  // 'draft' = elder-only iteration record (never shown to playtesters — the
  // 057 RLS whitelist only exposes published/approved rows to them).
  status: "draft" | "published" | "approved" | "superseded";
  data: DesignCard;
  note: string | null;
  createdBy: string;
  createdAt: string;
  authorName: string | null;
};

export type CardEventRow = {
  id: number;
  action: string;
  actor: string;
  actorName: string | null;
  at: string;
};

export type ReleaseInfo = { versionNumber: number; releasedAt: string; status: VersionRow["status"] };

// The lifecycle actions written by migration 072 (see forge_audit inserts).
const CARD_EVENT_ACTIONS = [
  "card_approved",
  "card_unapproved",
  "card_archived",
  "card_unarchived",
  "card_returned_to_ideas",
];

// Resolve user UUIDs -> display names (member-readable). Same pattern as comments.ts.
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

// Full version history for a card (draft iterations included), newest first.
// Elder/owner RLS sees all rows; playtesters see only published/approved rows
// (and never reach the studio anyway).
export async function listVersions(cardId: string): Promise<VersionRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("card_versions")
    .select("id, card_id, version_number, status, data, note, created_by, created_at")
    .eq("card_id", cardId)
    .order("version_number", { ascending: false });
  const rows = data ?? [];
  const names = await nameMap(ctx, rows.map((r: any) => r.created_by));
  return rows.map((r: any) => ({
    id: r.id,
    versionNumber: r.version_number,
    status: r.status,
    data: (r.data ?? {}) as DesignCard,
    note: r.note ?? null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    authorName: names.get(r.created_by) ?? "Forge member",
  }));
}

// Whether the card's artwork differs from a version's, using the same fields
// forge_publish_card compares (migration 127). Answered here so the blob keys stay on
// the server. Words the release dialog only; the RPC decides what a release does.
export async function artChangedSince(cardId: string, versionId: string): Promise<boolean> {
  const ctx = await requireForge();
  if (!ctx) return false;
  const [{ data: card }, { data: version }] = await Promise.all([
    ctx.supabase
      .from("forge_cards")
      .select("working_art_key, working_art_is_placeholder, working_art_original_key, working_finished_key")
      .eq("id", cardId)
      .maybeSingle(),
    ctx.supabase
      .from("card_versions")
      .select("art_key, art_is_placeholder, art_original_key, finished_key")
      .eq("id", versionId)
      .maybeSingle(),
  ]);
  if (!card || !version) return false;
  return (
    card.working_art_key !== version.art_key ||
    card.working_art_is_placeholder !== version.art_is_placeholder ||
    card.working_art_original_key !== version.art_original_key ||
    card.working_finished_key !== version.finished_key
  );
}

// Lifecycle events (post-072 only), oldest first. forge_audit is elder-read
// RLS-gated; non-elders simply get [].
export async function listCardEvents(cardId: string): Promise<CardEventRow[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_audit")
    .select("id, actor, action, target, at")
    .eq("target", cardId)
    .in("action", CARD_EVENT_ACTIONS)
    .order("at", { ascending: true });
  const rows = data ?? [];
  const names = await nameMap(ctx, rows.map((r: any) => r.actor));
  return rows.map((r: any) => ({
    id: r.id,
    action: r.action,
    actor: r.actor,
    actorName: names.get(r.actor) ?? "Forge member",
    at: r.at,
  }));
}

// Latest version per card (draft iterations included — the set page is an
// elder surface and iteration IS activity) — mirrors listOpenProposalCounts:
// takes cardIds, runs under the caller's RLS, returns a compact record.
export async function listSetActivity(
  cardIds: string[]
): Promise<Record<string, ReleaseInfo>> {
  const ctx = await requireForge();
  if (!ctx || cardIds.length === 0) return {};
  const { data } = await ctx.supabase
    .from("card_versions")
    .select("card_id, version_number, status, created_at")
    .in("card_id", cardIds)
    .order("created_at", { ascending: false });
  const out: Record<string, ReleaseInfo> = {};
  for (const r of data ?? []) {
    const id = (r as any).card_id as string;
    if (!out[id]) out[id] = { versionNumber: (r as any).version_number, releasedAt: (r as any).created_at, status: (r as any).status };
  }
  return out;
}
