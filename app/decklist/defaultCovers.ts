import { CARDS, findCard } from "@/lib/cards/lookup";
import { pickCovers } from "./pickCovers";

type CoverRow = {
  card_name: string;
  card_set?: string | null;
  card_img_file?: string | null;
  quantity: number;
  zone: string;
};

/**
 * The covers a save stores (see pickCovers): the chosen ones while their cards are still in the main deck,
 * the builder's picks for the rest. Server side, so card types and names come from the catalog.
 */
export function defaultCovers(
  cards: CoverRow[],
  chosen: readonly [string | null | undefined, string | null | undefined] = [null, null],
): [string | null, string | null] {
  return pickCovers(
    chosen,
    cards.map((c) => ({
      imgFile: c.card_img_file,
      name: c.card_name,
      zone: c.zone,
      quantity: c.quantity,
      type: findCard(c.card_name, c.card_set ?? undefined, c.card_img_file ?? undefined)?.type,
    })),
    (file) => CARDS.find((c) => c.imgFile === file)?.name,
  );
}
