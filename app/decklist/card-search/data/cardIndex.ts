/**
 * Module-scope enriched card index for the deck builder.
 *
 * Runs the per-row mapping (testament/gospel derivation, brigade
 * normalization) exactly once per bundle load, against the build-time
 * generated `CARDS` array.
 */

import { CARDS } from "@/lib/cards/lookup";
import { Card, normalizeBrigadeField } from "../utils";
import { deriveTestamentAndGospel } from "./testament";

// Manual Testament overrides for cards with empty reference fields in carddata.txt.
// Keyed by `name|set|imgFile` (matches dataLine).
const TESTAMENT_OVERRIDES: ReadonlyMap<string, "NT" | "OT"> = new Map([
  ["A Child is Born|Pmo-P1|A_Child_is_Born_(Promo)", "NT"],
  ["Caleb (Promo)|Pmo-P1|Caleb_(Promo)", "OT"],
  ["King Solomon (Promo)|Pmo-P1|King_Solomon_(Promo)", "OT"],
  ["Mary's Prophetic Act|Pmo-P1|Mary's_Prophetic_Act_(Promo)", "NT"],
  ["Threatened Lives|AW|Threatened_Lives_(AW)", "OT"],
]);

export const ALL_CARDS: Card[] = CARDS.map((c) => {
  const dataLine = `${c.name}|${c.set}|${c.imgFile}`;
  const derived = deriveTestamentAndGospel(c.reference);
  const override = TESTAMENT_OVERRIDES.get(dataLine);
  const testament = override ?? derived.testament;
  const isGospel = derived.isGospel;

  let normalizedBrigades: string[] = [];
  try {
    normalizedBrigades = normalizeBrigadeField(c.brigade, c.alignment, c.name);
  } catch {
    normalizedBrigades = c.brigade ? [c.brigade] : [];
  }

  return {
    dataLine,
    name: c.name,
    set: c.set,
    imgFile: c.imgFile,
    officialSet: c.officialSet,
    type: c.type,
    brigade: normalizedBrigades.join("/"),
    strength: c.strength,
    toughness: c.toughness,
    class: c.class,
    identifier: c.identifier,
    specialAbility: c.specialAbility,
    rarity: c.rarity,
    reference: c.reference,
    alignment: c.alignment,
    legality: c.legality,
    artist: c.artist,
    testament,
    isGospel,
  };
});

export const CARD_BY_FULL_KEY: ReadonlyMap<string, Card> = (() => {
  const map = new Map<string, Card>();
  for (const card of ALL_CARDS) {
    map.set(`${card.name}|${card.set}|${card.imgFile}`, card);
  }
  return map;
})();
