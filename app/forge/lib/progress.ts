// Pure dashboard-model computation. No DB, no UI. Counts a card in every
// (type, brigade) cell it occupies; brigade-less types use the "none" bucket.

export type TargetCounts = {
  total?: number;
  cells?: Record<string, Record<string, number>>;
};

export type ProgressCell = { type: string; brigade: string; actual: number; target: number };

export type ProgressModel = {
  headline: { actual: number; target: number; pct: number };
  byStatus: Record<string, number>;
  types: string[];
  brigades: string[];
  cells: ProgressCell[];
  checklist: { type: string; brigade: string; remaining: number }[];
  // byBrigade counts a card in each brigade it has ("none" if it has none), like the heatmap.
  keywords: { keyword: string; count: number; byBrigade: Record<string, number> }[];
};

// Ability-text phrases the dashboard tallies. A card counts once per phrase; matching is
// case-insensitive from a word start, so "draw" also catches "draws"/"drawn" but not "withdraw".
export const KEYWORDS = [
  "cannot be negated", "cannot be interrupted", "cannot be prevented", "reserve", "draw", "protect",
  "regardless of protect",
];
const KEYWORD_RES = KEYWORDS.map((k) => new RegExp(`\\b${k.replace(/ /g, "\\s+")}`, "i"));

type CardLike = {
  snapshot: { cardType?: string[]; brigades?: string[]; rawText?: string; specialAbility?: string };
  status: string;
};

export function computeProgress(cards: CardLike[], targets: TargetCounts | null | undefined): ProgressModel {
  const safeTargets = targets ?? {};
  const live = cards.filter((c) => c.status !== "archived");

  const byStatus: Record<string, number> = {};
  for (const c of live) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

  // actual[type][brigade] = count
  const actual: Record<string, Record<string, number>> = {};
  const bump = (t: string, b: string) => {
    (actual[t] ??= {})[b] = (actual[t]?.[b] ?? 0) + 1;
  };
  for (const c of live) {
    const types = c.snapshot.cardType ?? [];
    const brigades = c.snapshot.brigades ?? [];
    for (const t of types) {
      if (brigades.length === 0) bump(t, "none");
      else for (const b of brigades) bump(t, b);
    }
  }

  const cellTargets = safeTargets.cells ?? {};
  const types = Array.from(new Set([...Object.keys(cellTargets), ...Object.keys(actual)])).sort();
  const brigades = Array.from(
    new Set([
      ...Object.values(cellTargets).flatMap((row) => Object.keys(row)),
      ...Object.values(actual).flatMap((row) => Object.keys(row)),
    ])
  ).sort();

  const cells: ProgressCell[] = [];
  const checklist: { type: string; brigade: string; remaining: number }[] = [];
  for (const t of types) {
    for (const b of brigades) {
      const a = actual[t]?.[b] ?? 0;
      const tgt = cellTargets[t]?.[b] ?? 0;
      cells.push({ type: t, brigade: b, actual: a, target: tgt });
      if (tgt > a) checklist.push({ type: t, brigade: b, remaining: tgt - a });
    }
  }

  const keywords = KEYWORDS.map((keyword, i) => {
    const matching = live.filter((c) => KEYWORD_RES[i].test(c.snapshot.rawText ?? c.snapshot.specialAbility ?? ""));
    const byBrigade: Record<string, number> = {};
    for (const c of matching) {
      const bs = c.snapshot.brigades?.length ? c.snapshot.brigades : ["none"];
      for (const b of bs) byBrigade[b] = (byBrigade[b] ?? 0) + 1;
    }
    return { keyword, count: matching.length, byBrigade };
  });

  const target = safeTargets.total ?? 0;
  const pct = target > 0 ? Math.round((live.length / target) * 100) : 0;

  return { headline: { actual: live.length, target, pct }, byStatus, types, brigades, cells, checklist, keywords };
}
