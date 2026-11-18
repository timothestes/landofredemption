// Client-safe constants for the catalog editor. The scripts-side twin is
// scripts/lib/applyCardOverrides.js — a drift-guard test pins them together.
import { findCard, type CardData } from "@/lib/cards/lookup";

export const EDITABLE_FIELDS = [
  "officialSet", "type", "brigade", "strength", "toughness", "class",
  "identifier", "specialAbility", "rarity", "reference", "alignment", "legality", "artist",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const IDENTITY_FIELDS = ["name", "set", "imgFile"] as const;

/**
 * Strict catalog lookup. findCard falls back to name-only and lowercased
 * matches — good for deck resolution, WRONG for admin writes (a typo'd set
 * would edit a different print; promote's verify-live documents the trap).
 */
export function findCardStrict(name: string, set: string): CardData | null {
  const card = findCard(name, set);
  return card && card.name === name && card.set === set ? card : null;
}
