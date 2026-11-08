// Playtester reveal reader. SERVER-ONLY: it reads under the caller's RLS. A granted
// playtester can SELECT a granted set's TESTABLE cards — those in 'playtesting' (the
// frozen published snapshot) or 'approved' (the final snapshot). It exposes only the
// DesignCard payload + a hasApprovedArt boolean — never a blob key (use the
// /forge/api/art/<id>?v=approved proxy to render the image).
import { requireForge } from "@/app/forge/lib/auth";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type RevealCard = { cardId: string; data: DesignCard; hasApprovedArt: boolean; hasApprovedFinished: boolean; versionId: string; versionNumber: number };

// NOTE: still named listSetApprovedCards for caller stability, but it now reveals
// playtesting cards too (see migration 057). The revealed version is the approved
// snapshot when finalized, else the published (in-testing) snapshot.
// 'promoted' (publicly released, migration 091) stays in this filter deliberately:
// this reader feeds both the deck-builder pool and play-deck hydration, and
// hydration fail-closes — dropping promoted cards here would break every deck
// holding a forge ref the instant a set is promoted, before deck migration runs
// (the Roots 2 outage mechanism). Keep it in sync with the 091 RLS policy.
export async function listSetApprovedCards(setId: string): Promise<RevealCard[]> {
  const ctx = await requireForge();
  if (!ctx) return [];

  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("id, approved_version_id, published_version_id")
    .eq("set_id", setId)
    .in("status", ["playtesting", "approved", "promoted"]);

  const byVersion = new Map<string, string>(); // version_id -> card_id
  for (const c of cards ?? []) {
    const vid = c.approved_version_id ?? c.published_version_id; // approved wins, else published
    if (vid) byVersion.set(vid, c.id);
  }
  if (byVersion.size === 0) return [];

  const { data: versions } = await ctx.supabase
    .from("card_versions")
    .select("id, card_id, version_number, data, art_key, art_original_key, art_is_placeholder, finished_key")
    .in("status", ["published", "approved"]) // self-defend alongside RLS
    .in("id", Array.from(byVersion.keys()));

  return (versions ?? []).map((v: any): RevealCard => ({
    cardId: v.card_id as string,
    data: (v.data ?? {}) as DesignCard,
    hasApprovedArt: !!(v.art_original_key ?? v.art_key) && !v.art_is_placeholder,
    hasApprovedFinished: !!v.finished_key,
    versionId: v.id as string,
    versionNumber: v.version_number as number,
  }));
}
