// SERVER-ONLY: gathers the approved Forge cards across every set granted to the caller,
// reusing the 2.1 RLS-scoped readers. Carries only DesignCard + ids + hasApprovedArt
// (never a blob key — render via /forge/api/art/{cardId}?v=approved).
import { requireForge } from "@/app/forge/lib/auth";
import { listSetApprovedCards } from "@/app/forge/lib/play";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type GrantedForgeCard = {
  cardId: string; setId: string; setName: string; data: DesignCard;
  hasApprovedArt: boolean; hasApprovedFinished: boolean; versionId: string;
};

export async function listGrantedForgeCards(): Promise<GrantedForgeCard[]> {
  const ctx = await requireForge();
  if (!ctx) return [];
  // RLS → only sets the caller may see (a playtester's granted sets). Not listSets: it also
  // counts every card and throws if that fails, and a count must not stop a deck loading.
  const { data: sets } = await ctx.supabase
    .from("forge_sets")
    .select("id, name")
    .order("created_at", { ascending: false });
  const out: GrantedForgeCard[] = [];
  for (const s of sets ?? []) {
    const cards = await listSetApprovedCards(s.id);
    for (const c of cards) {
      out.push({
        cardId: c.cardId, setId: s.id, setName: s.name, data: c.data,
        hasApprovedArt: c.hasApprovedArt, hasApprovedFinished: c.hasApprovedFinished,
        versionId: c.versionId,
      });
    }
  }
  return out;
}
