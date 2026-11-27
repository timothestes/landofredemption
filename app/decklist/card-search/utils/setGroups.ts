import { compareCardsDefault } from "@/lib/cards/defaultSort";
import type { DeckCard } from "../types/deck";

/**
 * "Group by Set" for the deck builder, for pulling a deck out of a collection
 * that's filed by set: sets A to Z, and inside a set the print order the
 * collection page uses.
 */

function setNameOf(dc: DeckCard): string {
  return dc.card.officialSet || dc.card.set || "Unknown set";
}

export function sortDeckCardsBySet(cards: DeckCard[]): DeckCard[] {
  return [...cards].sort(
    (a, b) => setNameOf(a).localeCompare(setNameOf(b)) || compareCardsDefault(a.card, b.card),
  );
}

export function groupDeckCardsBySet(cards: DeckCard[]) {
  const groups: { set: string; cards: DeckCard[]; count: number }[] = [];
  for (const dc of sortDeckCardsBySet(cards)) {
    const set = setNameOf(dc);
    let group = groups[groups.length - 1];
    if (group?.set !== set) {
      group = { set, cards: [], count: 0 };
      groups.push(group);
    }
    group.cards.push(dc);
    group.count += dc.quantity;
  }
  return groups;
}
