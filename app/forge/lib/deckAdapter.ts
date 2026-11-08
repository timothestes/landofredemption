// Pure adapter: a Forge approved card (DesignCard) → the deckbuilder's Card shape.
// No "use client"/"use server" — importable on both sides. Maps enum values to the
// canonical public `type` string (GE/EE stay abbreviated, matching the public card
// index) so forge and public cards group/validate identically, and stamps a
// collision-proof `forge:{cardId}` dataLine identity.
import type { Card } from "@/app/decklist/card-search/utils";
import { deriveTestamentAndGospel } from "@/app/decklist/card-search/data/testament";
import { cardRawText, type DesignCard, type CardType, type Brigade } from "@/app/forge/lib/designCard";

export const FORGE_DATALINE_PREFIX = "forge:";
export function forgeDataLine(cardId: string): string { return FORGE_DATALINE_PREFIX + cardId; }
export function isForgeDataLine(dataLine: string): boolean { return dataLine.startsWith(FORGE_DATALINE_PREFIX); }
export function cardIdFromDataLine(dataLine: string): string { return dataLine.slice(FORGE_DATALINE_PREFIX.length); }
// Any Forge card in the builder. A save drops dataLine, so a card the deck can no longer
// resolve keeps the marker only in imgFile. A localStorage draft comes back unvalidated,
// so either field can be missing on a public card.
export function isForgeCard(card: Pick<Card, "dataLine" | "imgFile">): boolean {
  return isForgeDataLine(card.dataLine ?? "") || isForgeDataLine(card.imgFile ?? "");
}

// DesignCard type enum → the public card index's canonical `type` value. The public
// data abbreviates only GE/EE (every other type is spelled out), so we match that
// exactly — otherwise views that group on the raw type string split forge "Good
// Enhancement" from public "GE" into two buckets. Deckbuilder/deck-view UIs prettify
// "GE"/"EE" back to full names for their section headers.
export const TYPE_DISPLAY: Record<CardType, string> = {
  Hero: "Hero", EvilCharacter: "Evil Character", GE: "GE", EE: "EE",
  LostSoul: "Lost Soul", Artifact: "Artifact", Dominant: "Dominant", Fortress: "Fortress",
  Site: "Site", City: "City", Curse: "Curse", Covenant: "Covenant",
};

const BRIGADE_DISPLAY: Record<Brigade, string> = {
  Blue: "Blue", Clay: "Clay", GoodGold: "Good Gold", Green: "Green", Purple: "Purple",
  Red: "Red", Silver: "Silver", Teal: "Teal", White: "White",
  Black: "Black", Brown: "Brown", Crimson: "Crimson", EvilGold: "Evil Gold",
  Gray: "Gray", Orange: "Orange", PaleGreen: "Pale Green",
};

function alignmentDisplay(a?: string): string {
  return a === "Good_Evil" ? "Good/Evil" : (a ?? "");
}

// The subset of card fields the in-game "Search Deck" modal filters on, derived
// from a DesignCard. Mirrors designCardToCard's field mapping but blanks unset
// stats/brigade with "" (not "—") to match how PUBLIC cards are serialized for
// play — so forge and public cards behave identically in the deck-search grid.
// Carried on the forge play resolver so the owner's client can re-hydrate these
// after the leak spine blanks them on the world-readable STDB row.
export interface ForgeSearchFields {
  alignment: string;
  brigade: string;
  strength: string;
  toughness: string;
  identifier: string;
  reference: string;
}

export function designCardSearchFields(data: DesignCard): ForgeSearchFields {
  const brigades = data.brigades ?? [];
  return {
    alignment: alignmentDisplay(data.alignment),
    brigade: brigades.map((b) => BRIGADE_DISPLAY[b] ?? b).join("/"),
    strength: data.strength != null ? String(data.strength) : "",
    toughness: data.toughness != null ? String(data.toughness) : "",
    identifier: (data.identifiers ?? []).join(", "),
    reference: data.reference ?? "",
  };
}

export function designCardToCard(data: DesignCard, cardId: string, setName: string): Card {
  const types = data.cardType ?? [];
  const brigades = data.brigades ?? [];
  // Testament/gospel aren't stored on the DesignCard — derive them from the
  // scripture reference the same way the public card index does, so forge Lost
  // Souls (and every other card) match the deckbuilder's N.T./O.T. filters.
  const { testament, isGospel } = deriveTestamentAndGospel(data.reference ?? "");
  return {
    dataLine: forgeDataLine(cardId),
    name: data.name ?? "Untitled",
    set: "Forge",
    imgFile: "",
    officialSet: setName,
    type: types.map((t) => TYPE_DISPLAY[t] ?? t).join("/"),
    brigade: brigades.map((b) => BRIGADE_DISPLAY[b] ?? b).join("/") || "—",
    strength: data.strength != null ? String(data.strength) : "—",
    toughness: data.toughness != null ? String(data.toughness) : "—",
    // Public data keeps Warrior/Weapon AND the Territory/Star/Cloud icons in one
    // combined `class` string (the deckbuilder's class filters substring-match it).
    // The forge model splits them, so recombine here — mirroring the Lackey export
    // (lackey.ts) — or forge Territory/Star/Cloud cards vanish from those filters.
    class: [...(data.class ?? []), ...(data.icons ?? [])].join("/"),
    identifier: (data.identifiers ?? []).join(", "),
    // rawText-first (via cardRawText) — the studio edits rawText; a stale legacy
    // specialAbility must not shadow it (Heavenly Temple bug, 2026-07-06).
    specialAbility: cardRawText(data),
    rarity: data.rarity ?? "",
    reference: data.reference ?? "",
    alignment: alignmentDisplay(data.alignment),
    // Forge cards are designed for the current (Rotation) environment, so default an unset
    // legality to "Rotation". That makes shared cards visible under the deckbuilder's default
    // legality filter; a designer can still explicitly pick another legality in the card editor.
    legality: data.legality ?? "Rotation",
    testament,
    isGospel,
  };
}
