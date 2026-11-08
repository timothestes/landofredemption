"use server";

import { requireForge } from "@/app/forge/lib/auth";
import { proposalReviewItem, suggestionReviewItem, type ReviewCardRow, type ReviewOpenItem } from "@/app/forge/lib/reviewView";

export type SetReviewQueue = { cards: ReviewCardRow[]; items: ReviewOpenItem[] };

// Open proposals and unresolved field-anchored suggestions on a set's cards.
// (General unresolved comments are NOT counted — only suggestions with a value.)
// Returns the raw open items, with `cards` narrowed to those holding at least
// one; buildReviewQueue() does the counting so the client can re-filter by date
// or kind without another round trip. Each item carries who, when and a description of
// what changed. Snapshots stay here: the row only needs the labels.
export async function getSetReviewQueue(setId: string): Promise<SetReviewQueue> {
  const ctx = await requireForge();
  if (!ctx) return { cards: [], items: [] };
  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("id, title, status")
    .eq("set_id", setId);
  const list = cards ?? [];
  if (list.length === 0) return { cards: [], items: [] };
  const ids = list.map((c: any) => c.id);

  const { data: props } = await ctx.supabase
    .from("card_proposals")
    .select("id, card_id, created_at, created_by, summary, base_version_id, proposed_snapshot")
    .eq("status", "open")
    .in("card_id", ids);

  const { data: sugg } = await ctx.supabase
    .from("card_comments")
    .select("id, card_id, created_at, created_by, field, suggested_value")
    .eq("resolved", false)
    .not("field", "is", null)
    .not("suggested_value", "is", null)
    .in("card_id", ids);

  const baseIds = [...new Set((props ?? []).map((p: any) => p.base_version_id).filter(Boolean))];
  const { data: bases } = baseIds.length
    ? await ctx.supabase.from("card_versions").select("id, version_number, data").in("id", baseIds)
    : { data: [] };
  const baseById = new Map((bases ?? []).map((v: any) => [v.id, { versionNumber: v.version_number, data: v.data ?? {} }]));

  // Same member-readable name lookup as comments.ts and proposals.ts.
  const authorIds = [...new Set([...(props ?? []), ...(sugg ?? [])].map((r: any) => r.created_by))];
  const { data: members } = authorIds.length
    ? await ctx.supabase.from("playtest_members").select("user_id, display_name").in("user_id", authorIds)
    : { data: [] };
  const names = new Map((members ?? []).map((m: any) => [m.user_id, m.display_name]));
  const who = (id: string): string | null => (id === ctx.user.id ? "You" : (names.get(id) as string) ?? null);

  const items: ReviewOpenItem[] = [
    ...(props ?? []).map((p: any) =>
      proposalReviewItem({
        id: p.id,
        cardId: p.card_id,
        createdAt: p.created_at,
        who: who(p.created_by),
        summary: p.summary ?? null,
        baseVersionId: p.base_version_id ?? null,
        base: (baseById.get(p.base_version_id) as { versionNumber: number; data: any }) ?? null,
        proposed: p.proposed_snapshot ?? {},
      }),
    ),
    ...(sugg ?? []).map((s: any) =>
      suggestionReviewItem({
        id: s.id,
        cardId: s.card_id,
        createdAt: s.created_at,
        who: who(s.created_by),
        field: s.field,
        suggestedValue: s.suggested_value,
      }),
    ),
  ];
  const open = new Set(items.map((i) => i.cardId));

  return {
    cards: list
      .filter((c: any) => open.has(c.id))
      .map((c: any) => ({ id: c.id, title: c.title ?? null, status: c.status })),
    items,
  };
}
