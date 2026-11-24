import type { Card } from "../utils";

/**
 * What the opening-hand odds can be asked about.
 *
 * These mirror `matchesDeckCard` in lib/cards/cardAbilities.ts (the matcher the
 * in-game "search deck for a good weapon" abilities use), but are self-contained
 * on purpose: that module imports the card catalog, and the public deck page's
 * client bundle must not (see clientBundleNoCatalog.test.ts). A parity test
 * keeps the two in step.
 */
export interface OpeningHandCategory {
  id: string;
  /** Option text in the dropdown. */
  label: string;
  /** Used in "3 Good Weapons in 43 non-Lost Soul cards". */
  one: string;
  many: string;
  matches: (card: Card) => boolean;
}

/** Types that are also other types (REG): a Covenant is a good Enhancement and an Artifact. */
const ALSO_TYPES: Record<string, string[]> = {
  Covenant: ["GE", "Artifact"],
  Curse: ["EE", "Artifact"],
};

/** Each half of a dual type ("Hero/Evil Character", "GE/EE"), plus every type a half also is. */
function typeParts(card: Card): string[] {
  return (card.type ?? "")
    .split("/")
    .map((s) => s.trim())
    .flatMap((p) => [p, ...(ALSO_TYPES[p] ?? [])]);
}

const isWeapon = (card: Card) =>
  (card.class ?? "").split(/[,/]/).some((s) => s.trim() === "Weapon");

const isGood = (card: Card, parts: string[]) =>
  card.alignment === "Good" || parts.includes("GE") || parts.includes("Hero");

const isEvil = (card: Card, parts: string[]) =>
  card.alignment === "Evil" || parts.includes("EE") || parts.includes("Evil Character");

export const OPENING_HAND_CATEGORIES: OpeningHandCategory[] = [
  { id: "hero", label: "Hero", one: "Hero", many: "Heroes", matches: (c) => typeParts(c).includes("Hero") },
  { id: "evil-character", label: "Evil Character", one: "Evil Character", many: "Evil Characters", matches: (c) => typeParts(c).includes("Evil Character") },
  { id: "good-weapon", label: "Good Weapon", one: "Good Weapon", many: "Good Weapons", matches: (c) => isWeapon(c) && isGood(c, typeParts(c)) },
  { id: "evil-weapon", label: "Evil Weapon", one: "Evil Weapon", many: "Evil Weapons", matches: (c) => isWeapon(c) && isEvil(c, typeParts(c)) },
  { id: "good-enhancement", label: "Good Enhancement", one: "Good Enhancement", many: "Good Enhancements", matches: (c) => typeParts(c).includes("GE") },
  { id: "evil-enhancement", label: "Evil Enhancement", one: "Evil Enhancement", many: "Evil Enhancements", matches: (c) => typeParts(c).includes("EE") },
  { id: "artifact", label: "Artifact", one: "Artifact", many: "Artifacts", matches: (c) => typeParts(c).includes("Artifact") },
  { id: "dominant", label: "Dominant", one: "Dominant", many: "Dominants", matches: (c) => typeParts(c).includes("Dominant") },
];

export const DEFAULT_OPENING_HAND_CATEGORY = OPENING_HAND_CATEGORIES[0];

export function openingHandCategory(id: string): OpeningHandCategory {
  return OPENING_HAND_CATEGORIES.find((c) => c.id === id) ?? DEFAULT_OPENING_HAND_CATEGORY;
}

/** Does this deck card count toward the category? */
export function isInCategory(card: Card, category: OpeningHandCategory): boolean {
  return category.matches(card);
}
