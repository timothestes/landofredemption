// Pure DesignCard schema + advisory validation. No UI, no DB. Consumed by the
// form, the preview, and (later) publish validation. Arrays are native; the
// legacy delimited-string toCardData() adapter is deferred to Phase 2.

export const CARD_TYPES = [
  "Hero", "EvilCharacter", "GE", "EE", "LostSoul", "Artifact",
  "Dominant", "Fortress", "Site", "City", "Curse", "Covenant",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const ALIGNMENTS = ["Good", "Evil", "Neutral", "Good_Evil"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

const GOOD_TYPES: readonly CardType[] = ["Hero", "GE"];
const EVIL_TYPES: readonly CardType[] = ["EvilCharacter", "EE"];

/**
 * Derives the alignment implied by a card's selected types, for auto-filling the
 * alignment field (still fully overridable — see CardDetailsFields). Returns null
 * when the rule says "leave unchanged": no types selected, or only ambiguous types
 * (Dominant/Fortress/Artifact/Site/City/Covenant/Curse/LostSoul) — those are
 * ignored even alongside a good/evil type. Pure. Exported for the spreadsheet
 * importer's alignment fallback (#386) — keep this name/path stable.
 */
export function deriveAlignmentFromTypes(types: CardType[]): Alignment | null {
  const hasGood = types.some((t) => GOOD_TYPES.includes(t));
  const hasEvil = types.some((t) => EVIL_TYPES.includes(t));
  if (hasGood && hasEvil) return "Good_Evil";
  if (hasGood) return "Good";
  if (hasEvil) return "Evil";
  return null;
}

// Resolved brigades only — no GoodMulti/EvilMulti sentinels (spec Decision #2).
// The kit has no Red/Teal wash — those preview as solid BRIGADE_HEX; EvilGold
// reuses the kit's single "gold" wash.
export const GOOD_BRIGADES = ["Blue", "Clay", "GoodGold", "Green", "Purple", "Red", "Silver", "Teal", "White"] as const;
export const EVIL_BRIGADES = ["Black", "Brown", "Crimson", "EvilGold", "Gray", "Orange", "PaleGreen"] as const;
export const BRIGADES = [...GOOD_BRIGADES, ...EVIL_BRIGADES] as const;
export type Brigade = (typeof BRIGADES)[number];

// A printed "Multi" card is every brigade of its alignment. The forge stores it as that
// full list rather than a sentinel, so everything that reads brigades already handles it;
// the Lackey export and promotion spell it "Multi", as the catalog does.
export type MultiSide = "Good" | "Evil";
export const MULTI_BRIGADES: Record<MultiSide, readonly Brigade[]> = { Good: GOOD_BRIGADES, Evil: EVIL_BRIGADES };

/** The alignment whose every brigade is selected ("Good" if both are), else null. Pure. */
export function multiBrigadeSide(brigades: readonly Brigade[]): MultiSide | null {
  for (const side of ["Good", "Evil"] as const) {
    if (MULTI_BRIGADES[side].every((b) => brigades.includes(b))) return side;
  }
  return null;
}

/** The picker's Multi button: adds that alignment's missing brigades, or clears them all
 *  when every one is already selected. Other brigades are kept. Pure. */
export function toggleMultiBrigade(brigades: Brigade[] | undefined, side: MultiSide): Brigade[] {
  const current = brigades ?? [];
  const all = MULTI_BRIGADES[side];
  if (all.every((b) => current.includes(b))) return current.filter((b) => !all.includes(b));
  return [...current, ...all.filter((b) => !current.includes(b))];
}

/** Brigades for display: a full set collapses to one "Good Multi" / "Evil Multi" entry. Pure. */
export function brigadeLabels(brigades: readonly Brigade[]): string[] {
  const side = multiBrigadeSide(brigades);
  if (!side) return [...brigades];
  return [`${side} Multi`, ...brigades.filter((b) => !MULTI_BRIGADES[side].includes(b))];
}

export const CLASSES = ["Warrior", "Weapon"] as const;
export const ICONS = ["Territory", "Star", "Cloud"] as const;
export const LEGALITIES = ["Rotation", "Classic", "Scrolls", "Paragon", "Banned"] as const;
export const RARITIES = ["Common", "Uncommon", "Rare", "Ultra Rare", "Promo"] as const;

// NOTE: the property keys below are mirrored by the SQL allowlist
// `_forge_is_card_field` (used to validate field-anchored suggestions); its
// current definition is in supabase/migrations/067_forge_scripture_field.sql.
// Keep the two lists in sync.
// A stat is a number, "X" (variable, e.g. The Faithful Followers), or a paired
// dual-side value like "6 (0)" — the official card pool's convention for
// dual-alignment enhancements and dual-sided characters (142 cards use it).
// parseStatInput below is the only producer of the string forms.
export type StatValue = number | string | null;

export type DesignCard = {
  name?: string;
  rawText?: string;
  cardType?: CardType[];
  alignment?: Alignment;
  brigades?: Brigade[];
  strength?: StatValue;
  toughness?: StatValue;
  class?: (typeof CLASSES)[number][];
  icons?: (typeof ICONS)[number][];
  identifiers?: string[];
  specialAbility?: string;
  reference?: string;
  legality?: (typeof LEGALITIES)[number];
  rarity?: string;
  scripture?: string;
  artistCredit?: string;
  cardFrame?: string;
};

export type Applicability = "required" | "optional" | "na";
export type FieldKey =
  | "brigades" | "stats" | "class" | "icons"
  | "identifiers" | "specialAbility" | "reference";

const NA: Record<FieldKey, Applicability> = {
  brigades: "na", stats: "na", class: "na",
  icons: "na", identifiers: "na", specialAbility: "na", reference: "na",
};

// Per-type applicability, grounded in the real Redemption card pool (Site ~100%
// brigade, Fortress ~6%). "stats" = strength+toughness: required for Hero/EvilCharacter,
// optional on GE/EE/Curse/Covenant (printed cards carry them when set).
const MATRIX: Record<CardType, Partial<Record<FieldKey, Applicability>>> = {
  Hero:          { brigades: "required", stats: "required", class: "optional", icons: "optional", identifiers: "optional", specialAbility: "optional", reference: "optional" },
  EvilCharacter: { brigades: "required", stats: "required", class: "optional", icons: "optional", identifiers: "optional", specialAbility: "optional", reference: "optional" },
  GE:            { brigades: "required", stats: "optional", specialAbility: "required", reference: "optional" },
  EE:            { brigades: "required", stats: "optional", specialAbility: "required", reference: "optional" },
  LostSoul:      { specialAbility: "optional", reference: "optional", identifiers: "optional" },
  Artifact:      { specialAbility: "required", identifiers: "optional", reference: "optional" },
  Dominant:      { specialAbility: "required", identifiers: "optional", reference: "optional" },
  Fortress:      { brigades: "optional", specialAbility: "optional", reference: "optional" },
  Site:          { brigades: "required", specialAbility: "optional", reference: "optional" },
  City:          { brigades: "optional", specialAbility: "optional", reference: "optional" },
  Curse:         { brigades: "optional", stats: "optional", specialAbility: "optional", reference: "optional" },
  Covenant:      { brigades: "optional", stats: "optional", specialAbility: "optional", reference: "optional" },
};

const RANK: Record<Applicability, number> = { na: 0, optional: 1, required: 2 };

export function cardApplicability(types: CardType[]): Record<FieldKey, Applicability> {
  const out: Record<FieldKey, Applicability> = { ...NA };
  for (const t of types) {
    const m = MATRIX[t] ?? {};
    for (const k of Object.keys(out) as FieldKey[]) {
      const cand = m[k] ?? "na";
      if (RANK[cand] > RANK[out[k]]) out[k] = cand;
    }
  }
  return out;
}

export function isStatBearing(types: CardType[]): boolean {
  return cardApplicability(types).stats === "required";
}

export type ValidationHint = { field: string; message: string };

// ADVISORY ONLY — never blocks autosave/creation. Empty/napkin card => no hints.
export function validate(card: DesignCard): ValidationHint[] {
  const types = card.cardType ?? [];
  if (types.length === 0) return [];
  const app = cardApplicability(types);
  const hints: ValidationHint[] = [];
  const has = (v: unknown) =>
    Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== "";

  if (app.brigades === "required" && !has(card.brigades))
    hints.push({ field: "brigades", message: "This type usually has a brigade." });
  if (app.stats === "required" && (!has(card.strength) || !has(card.toughness)))
    hints.push({ field: "stats", message: "This type usually has strength / toughness." });
  if (app.specialAbility === "required" && !has(card.specialAbility))
    hints.push({ field: "specialAbility", message: "This type usually has a special ability." });
  return hints;
}

/**
 * The descoped raw-text body. Falls back to the legacy napkin `specialAbility`
 * so cards saved before the 2026-07-03 descope don't read blank. Pure.
 */
/** The name as the card prints it: the catalog's bracketed disambiguator ("Blood of the Lamb
 *  [EoT]", "The Depraved [Gray - EoT]") is dropped, and a Lost Soul is titled just "Lost Soul"
 *  — its quoted word prints in the identifier bubble, not the title. Pure. */
export function printedName(card: DesignCard): string {
  const name = (card.name ?? "").trim();
  if ((card.cardType ?? []).includes("LostSoul") && /^lost soul\b/i.test(name)) return "Lost Soul";
  return name.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
}

export function cardRawText(card: DesignCard): string {
  return card.rawText ?? card.specialAbility ?? "";
}

// A dual-side stat carries both alignments' values. Accept either the pool's
// canonical parens ("6 (0)") or a slash ("6/0") — the separator designers reach for
// first — and normalize both to the canonical `N (M)`.
const PAIRED_STAT_RE = /^(x|\d+)\s*(?:\(\s*(x|\d+)\s*\)|\/\s*(x|\d+))$/i;

/** Parse a stat: "" → null, "x"/"X" → "X", numbers pass, paired dual-side values
 *  normalize to `N (M)` (e.g. "3(2)" → "3 (2)", "6/0" → "6 (0)", "x/0" → "X (0)"),
 *  junk → null. Pure. */
export function parseStatInput(raw: string): StatValue {
  const t = raw.trim();
  if (!t) return null;
  if (/^x$/i.test(t)) return "X";
  const paired = PAIRED_STAT_RE.exec(t);
  if (paired) {
    const side = (s: string) => (/^x$/i.test(s) ? "X" : s);
    return `${side(paired[1])} (${side(paired[2] ?? paired[3])})`;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
