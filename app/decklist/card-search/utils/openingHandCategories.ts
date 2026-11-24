import { matchesDeckCard, type DeckCardMatch } from "@/lib/cards/cardAbilities";
import type { Card } from "../utils";

/**
 * What the opening-hand odds can be asked about. The matches are the same ones
 * the game's "search deck for a good weapon" abilities use, so "good weapon"
 * means here what it means there: class Weapon, good, dual-aligned cards included.
 */
export interface OpeningHandCategory {
  id: string;
  /** Option text in the dropdown. */
  label: string;
  /** Used in "3 Good Weapons in 43 non-Lost Soul cards". */
  one: string;
  many: string;
  match: DeckCardMatch[];
}

export const OPENING_HAND_CATEGORIES: OpeningHandCategory[] = [
  { id: "hero", label: "Hero", one: "Hero", many: "Heroes", match: [{ types: ["Hero"] }] },
  { id: "evil-character", label: "Evil Character", one: "Evil Character", many: "Evil Characters", match: [{ types: ["Evil Character"] }] },
  { id: "good-weapon", label: "Good Weapon", one: "Good Weapon", many: "Good Weapons", match: [{ alignments: ["good"], cardClass: "Weapon" }] },
  { id: "evil-weapon", label: "Evil Weapon", one: "Evil Weapon", many: "Evil Weapons", match: [{ alignments: ["evil"], cardClass: "Weapon" }] },
  { id: "good-enhancement", label: "Good Enhancement", one: "Good Enhancement", many: "Good Enhancements", match: [{ types: ["Enhancement"], alignments: ["good"] }] },
  { id: "evil-enhancement", label: "Evil Enhancement", one: "Evil Enhancement", many: "Evil Enhancements", match: [{ types: ["Enhancement"], alignments: ["evil"] }] },
  { id: "artifact", label: "Artifact", one: "Artifact", many: "Artifacts", match: [{ types: ["Artifact"] }] },
  { id: "dominant", label: "Dominant", one: "Dominant", many: "Dominants", match: [{ types: ["Dominant"] }] },
];

export const DEFAULT_OPENING_HAND_CATEGORY = OPENING_HAND_CATEGORIES[0];

export function openingHandCategory(id: string): OpeningHandCategory {
  return OPENING_HAND_CATEGORIES.find((c) => c.id === id) ?? DEFAULT_OPENING_HAND_CATEGORY;
}

/** Does this deck card count toward the category? */
export function isInCategory(card: Card, category: OpeningHandCategory): boolean {
  return matchesDeckCard(card, category.match);
}
