"use server";

import { revalidatePath } from "next/cache";
import { requireForge, requireElder } from "@/app/forge/lib/auth";
import type { TargetCounts } from "@/app/forge/lib/progress";
import { type ForgeCardFull } from "@/app/forge/lib/cards";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type ForgeSetSummary = { id: string; name: string; slug: string; status: string; total: number; targetTotal: number; statusCounts: Record<string, number>; isPrivate: boolean };
export type ForgeSetDetail = { id: string; name: string; slug: string; notes: string | null; targetCounts: TargetCounts; status: string; isPrivate: boolean };
export type SetElder = { userId: string; displayName: string | null; role: string };

type Result = { ok: true } | { ok: false; error: string };

export async function createSet(name: string, isPrivate = false): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_create_set", { p_name: name, p_is_private: isPrivate });
  if (error || typeof data !== "string") return { ok: false, error: "Could not create set" };
  revalidatePath("/forge/sets");
  return { ok: true, id: data };
}

export async function listSets(): Promise<ForgeSetSummary[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  // RLS restricts to sets the caller may see.
  const { data: sets } = await ctx.supabase
    .from("forge_sets")
    .select("id, name, slug, status, target_counts, is_private")
    .order("created_at", { ascending: false });
  const { data: cards } = await ctx.supabase.from("forge_cards").select("set_id, status");
  const counts = new Map<string, number>();
  const statusCounts = new Map<string, Record<string, number>>();
  for (const c of cards ?? []) {
    if (!c.set_id) continue;
    if (c.status !== "archived") counts.set(c.set_id, (counts.get(c.set_id) ?? 0) + 1);
    const m = statusCounts.get(c.set_id) ?? {};
    m[c.status] = (m[c.status] ?? 0) + 1;
    statusCounts.set(c.set_id, m);
  }
  return (sets ?? []).map((s: any) => ({
    id: s.id, name: s.name, slug: s.slug, status: s.status,
    total: counts.get(s.id) ?? 0,
    targetTotal: (s.target_counts?.total as number) ?? 0,
    statusCounts: statusCounts.get(s.id) ?? {},
    isPrivate: !!s.is_private,
  }));
}

// True when the caller may create/design cards in this set (set elder or superadmin).
// Used to gate the "New card in this set" tile — mirrors forge_share_card_to_set's authz.
export async function canDesignSet(setId: string): Promise<boolean> {
  const ctx = await requireForge();
  if (!ctx) return false;
  if (ctx.role === "superadmin") return true;
  const { data } = await ctx.supabase.rpc("is_forge_set_elder", { p_set_id: setId });
  return data === true;
}

export async function getSet(setId: string): Promise<ForgeSetDetail | null> {
  const ctx = await requireForge();
  if (!ctx) return null;
  const { data } = await ctx.supabase
    .from("forge_sets")
    .select("id, name, slug, notes, target_counts, status, is_private")
    .eq("id", setId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, name: data.name, slug: data.slug, notes: data.notes ?? null, targetCounts: (data.target_counts ?? {}) as TargetCounts, status: data.status, isPrivate: !!data.is_private };
}

export async function renameSet(setId: string, name: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_rename_set", { p_set_id: setId, p_name: name });
  if (error) return { ok: false, error: "Could not rename set" };
  // The name shows in the set header/tabs, the sets index, and every card page
  // for this set — refresh broadly, same as other cross-surface changes.
  revalidatePath("/forge", "layout");
  return { ok: true };
}

export async function saveSetNotes(setId: string, notes: string): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_save_set_notes", { p_set_id: setId, p_notes: notes });
  if (error) return { ok: false, error: "Could not save notes" };
  revalidatePath(`/forge/sets/${setId}/notes`);
  return { ok: true, updatedAt: typeof data === "string" ? data : undefined };
}

export async function saveSetTargets(setId: string, targets: TargetCounts): Promise<{ ok: boolean; error?: string; updatedAt?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { data, error } = await ctx.supabase.rpc("forge_save_set_targets", { p_set_id: setId, p_targets: targets });
  if (error) return { ok: false, error: "Could not save targets" };
  revalidatePath(`/forge/sets/${setId}/progress`);
  revalidatePath(`/forge/sets/${setId}/settings`);
  return { ok: true, updatedAt: typeof data === "string" ? data : undefined };
}

export async function addSetElder(setId: string, userId: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_add_set_elder", { p_set_id: setId, p_user_id: userId });
  if (error) return { ok: false, error: "Could not add designer" };
  revalidatePath(`/forge/sets/${setId}/settings`);
  return { ok: true };
}

export async function removeSetElder(setId: string, userId: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_remove_set_elder", { p_set_id: setId, p_user_id: userId });
  if (error) return { ok: false, error: "Could not remove designer" };
  revalidatePath(`/forge/sets/${setId}/settings`);
  return { ok: true };
}

const CARD_COLS = "id, title, working_snapshot, working_art_key, working_art_is_placeholder, working_finished_key, status, updated_at, set_id, published_version_id, approved_version_id, owner_id, creator_id, created_at";

export async function listSetCards(setId: string): Promise<ForgeCardFull[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase
    .from("forge_cards")
    .select(CARD_COLS)
    .eq("set_id", setId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((row: any): ForgeCardFull => ({
    id: row.id, title: row.title, snapshot: (row.working_snapshot ?? {}) as DesignCard,
    hasArt: !!row.working_art_key, hasFinished: !!row.working_finished_key, isPlaceholder: !!row.working_art_is_placeholder,
    status: row.status, updatedAt: row.updated_at,
    setId: row.set_id ?? null, publishedVersionId: row.published_version_id ?? null,
    approvedVersionId: row.approved_version_id ?? null,
    ownerId: row.owner_id, creatorId: row.creator_id, createdAt: row.created_at,
  }));
}

export async function listSetElders(setId: string): Promise<SetElder[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data: rows } = await ctx.supabase.from("forge_set_elders").select("user_id").eq("set_id", setId);
  const ids = (rows ?? []).map((r: any) => r.user_id);
  if (ids.length === 0) return [];
  const { data: members } = await ctx.supabase.from("playtest_members").select("user_id, display_name, role").in("user_id", ids);
  return (members ?? []).map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null, role: m.role }));
}

export type SetGrant = { userId: string; displayName: string | null };

export async function grantSet(setId: string, userId: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_grant_set", { p_set_id: setId, p_user_id: userId });
  if (error) return { ok: false, error: "Could not grant access" };
  revalidatePath(`/forge/sets/${setId}/settings`);
  return { ok: true };
}

export async function revokeSet(setId: string, userId: string): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_revoke_set", { p_set_id: setId, p_user_id: userId });
  if (error) return { ok: false, error: "Could not revoke access" };
  revalidatePath(`/forge/sets/${setId}/settings`);
  return { ok: true };
}

export async function setSetPrivacy(setId: string, isPrivate: boolean): Promise<Result> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_set_privacy", { p_set_id: setId, p_is_private: isPrivate });
  if (error) return { ok: false, error: "Could not change set privacy" };
  revalidatePath(`/forge/sets/${setId}/settings`);
  revalidatePath("/forge/sets");
  return { ok: true };
}

export async function bulkDeleteSets(
  setIds: string[]
): Promise<{ ok: true; done: number; failed: number } | { ok: false; error: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (setIds.length === 0) return { ok: true, done: 0, failed: 0 };
  if (setIds.length > 100) return { ok: false, error: "Too many sets selected" };
  let done = 0, failed = 0;
  for (const id of setIds) {
    const { error } = await ctx.supabase.rpc("forge_delete_set", { p_set_id: id });
    if (error) failed++; else done++;
  }
  revalidatePath("/forge", "layout");
  return { ok: true, done, failed };
}

export async function listSetGrants(setId: string): Promise<SetGrant[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data: rows } = await ctx.supabase.from("forge_set_grants").select("user_id").eq("set_id", setId);
  const ids = (rows ?? []).map((r: any) => r.user_id);
  if (ids.length === 0) return [];
  const { data: members } = await ctx.supabase.from("playtest_members").select("user_id, display_name").in("user_id", ids);
  return (members ?? []).map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null }));
}

// All grant rows the caller may see (RLS: set-elder scopes to their sets, superadmin
// sees all). Used by the admin Set Access matrix. Returns opaque (setId, userId) pairs.
export async function listAllSetGrants(): Promise<{ setId: string; userId: string }[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  const { data } = await ctx.supabase.from("forge_set_grants").select("set_id, user_id");
  return (data ?? []).map((r: any) => ({ setId: r.set_id, userId: r.user_id }));
}
