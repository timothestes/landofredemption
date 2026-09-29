import type { DeckCardData } from "../actions";
import type { Card } from "../card-search/utils";
import { sanitizeImgFile } from "@/app/shared/utils/cardImageUrl";

/** A deck row joined to its catalog record, ready to render. */
export interface EnrichedCard extends DeckCardData {
  type: string;
  alignment: string;
  brigade: string;
  fullCard: Card | null;
}

/**
 * Join deck rows to the card catalog on the server.
 *
 * The public deck page used to ship the entire catalog to the browser and do
 * this join in an effect after hydration, which meant the card grid could not
 * paint until ~360 KB of compressed JSON had downloaded and parsed. Doing it
 * here puts the grid in the server-rendered HTML instead.
 *
 * `lookup` is keyed `name|set|imgFile` (CARD_BY_FULL_KEY); deck rows may still
 * carry a `.jpg` suffix or a slash in the image name, so the key is sanitized
 * the same way the builder sanitizes it.
 */
export function enrichDeckCards(
  cards: DeckCardData[],
  lookup: ReadonlyMap<string, Card>,
): EnrichedCard[] {
  return cards.map((card) => {
    const key = `${card.card_name}|${card.card_set}|${sanitizeImgFile(card.card_img_file || "")}`;
    const fullCard = lookup.get(key) || null;
    return {
      ...card,
      type: fullCard?.type || "",
      alignment: fullCard?.alignment || "",
      brigade: fullCard?.brigade || "",
      fullCard,
    };
  });
}
