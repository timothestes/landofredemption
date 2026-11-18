import type { DeckZone } from "./card-search/types/deck";
import type { DeckCardData } from "./actions";

/** A deck_cards row as saveDeckAction writes it. */
export interface DeckCardRow {
  card_name: string;
  card_set: string | null;
  card_img_file: string | null;
  quantity: number;
  zone: DeckZone;
}

/**
 * The rows to write for a deck: one per (card_name, card_set, zone), the
 * unique key on deck_cards. A list that names a card twice in one zone — an
 * import of two decklists pasted together — would otherwise fail the insert
 * and lose the whole save. Repeats add their quantities and keep the first
 * row's image file; the catalog has one printing per name + set, so the merged
 * rows are always the same card.
 */
export function mergeDeckCardRows(cards: DeckCardData[]): DeckCardRow[] {
  const rows = new Map<string, DeckCardRow>();
  for (const card of cards) {
    const card_set = card.card_set || null;
    const zone = card.zone ?? "main";
    const key = JSON.stringify([card.card_name, card_set, zone]);
    const row = rows.get(key);
    if (row) {
      row.quantity += card.quantity;
    } else {
      rows.set(key, {
        card_name: card.card_name,
        card_set,
        card_img_file: card.card_img_file || null,
        quantity: card.quantity,
        zone,
      });
    }
  }
  return [...rows.values()];
}
