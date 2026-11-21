// Client-safe: the caller supplies the card lookup, so nothing here loads the catalog.
import type { DeckSnapshotCard } from "./deckSubmission";

export const VIEWS = ["images", "list"] as const;
export const GROUPS = ["type", "brigade", "alignment", "none"] as const;
export const SORTS = ["name", "quantity", "set"] as const;
export const SIZES = ["small", "large"] as const;

export interface SubmissionViewPrefs {
  view: (typeof VIEWS)[number];
  group: (typeof GROUPS)[number];
  sort: (typeof SORTS)[number];
  size: (typeof SIZES)[number];
}

/** Card art first: a host checking a deck recognises cards faster than they read names. */
export const DEFAULT_VIEW_PREFS: SubmissionViewPrefs = { view: "images", group: "type", sort: "name", size: "small" };

export const VIEW_PREFS_KEY = "lor:submission-view:v1";

export const GROUP_LABELS: Record<SubmissionViewPrefs["group"], string> = {
  type: "Type",
  brigade: "Brigade",
  alignment: "Alignment",
  none: "No groups",
};

export const SORT_LABELS: Record<SubmissionViewPrefs["sort"], string> = {
  name: "Name",
  quantity: "Most copies",
  set: "Set",
};

/** Stored preferences, each field falling back to its default when missing or no longer an option. */
export function parseViewPrefs(raw: string | null | undefined): SubmissionViewPrefs {
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) v = parsed as Record<string, unknown>;
  } catch {
    // Not JSON: defaults.
  }
  const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
    options.includes(value as T) ? (value as T) : fallback;
  return {
    view: pick(VIEWS, v.view, DEFAULT_VIEW_PREFS.view),
    group: pick(GROUPS, v.group, DEFAULT_VIEW_PREFS.group),
    sort: pick(SORTS, v.sort, DEFAULT_VIEW_PREFS.sort),
    size: pick(SIZES, v.size, DEFAULT_VIEW_PREFS.size),
  };
}

/** The catalog abbreviates two types; a heading spells them out. */
const TYPE_NAMES: Record<string, string> = { GE: "Good Enhancement", EE: "Evil Enhancement" };
export const typeLabel = (type: string | undefined): string => (type ? TYPE_NAMES[type] ?? type : "");

/** What the grouping and sorting read off a card; a card the catalog does not know resolves to undefined. */
export interface ResolvedCard {
  type?: string;
  brigade?: string;
  alignment?: string;
  officialSet?: string;
}

export type ResolveCard = (card: DeckSnapshotCard) => ResolvedCard | undefined;

const ALIGNMENT_ORDER = ["Good", "Evil", "Neutral"];
const LAST = "Other";

function groupLabel(group: SubmissionViewPrefs["group"], r: ResolvedCard | undefined): string {
  if (group === "none") return "";
  if (group === "type") return typeLabel(r?.type) || LAST;
  if (group === "alignment") return r?.alignment || LAST;
  // A card with no brigade (a Dominant, a Lost Soul) is grouped by what it is instead of piled under "None".
  return r?.brigade || typeLabel(r?.type) || LAST;
}

/**
 * One zone's cards as labelled groups, each sorted. Groups run alphabetically with "Other" last, except
 * alignments, which run Good, Evil, Neutral. Ties in a sort fall back to the name, so the order never shifts
 * between renders.
 */
export function groupCards(
  cards: DeckSnapshotCard[],
  prefs: Pick<SubmissionViewPrefs, "group" | "sort">,
  resolve: ResolveCard,
): { label: string; cards: DeckSnapshotCard[] }[] {
  const resolved = new Map(cards.map((c) => [c, resolve(c)]));
  const groups = new Map<string, DeckSnapshotCard[]>();
  for (const c of cards) {
    const label = groupLabel(prefs.group, resolved.get(c));
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  const rank = (label: string) => {
    if (label === LAST) return 1000;
    if (prefs.group === "alignment") {
      const i = ALIGNMENT_ORDER.indexOf(label);
      return i === -1 ? 999 : i;
    }
    return 0;
  };
  const setOf = (c: DeckSnapshotCard) => resolved.get(c)?.officialSet || c.set;
  const byName = (a: DeckSnapshotCard, b: DeckSnapshotCard) => a.name.localeCompare(b.name);
  const compare = (a: DeckSnapshotCard, b: DeckSnapshotCard) =>
    prefs.sort === "quantity"
      ? b.quantity - a.quantity || byName(a, b)
      : prefs.sort === "set"
        ? setOf(a).localeCompare(setOf(b)) || byName(a, b)
        : byName(a, b);
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([label, list]) => ({ label, cards: [...list].sort(compare) }));
}
