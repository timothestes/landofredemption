import { findCard } from "@/lib/cards/lookup";

type CoverRow = {
  card_name: string;
  card_set?: string | null;
  card_img_file?: string | null;
  quantity: number;
  zone: string;
};

const HERO_TYPES = ["Hero", "HC", "Hero Character"];
const EVIL_TYPES = ["Evil Character", "EC"];

/**
 * The covers the deck builder picks when a player hasn't (useDeckState's save): the main deck's first
 * Hero and first Evil Character, else its first two cards. For saves that come from elsewhere.
 */
export function defaultCovers(cards: CoverRow[]): [string | null, string | null] {
  const main = cards.filter((c) => c.zone === "main" && c.quantity > 0 && c.card_img_file);
  const typeOf = (c: CoverRow) =>
    findCard(c.card_name, c.card_set ?? undefined, c.card_img_file ?? undefined)?.type ?? "";
  const hero = main.find((c) => HERO_TYPES.includes(typeOf(c)));
  const evil = main.find((c) => EVIL_TYPES.includes(typeOf(c)));
  return [
    hero?.card_img_file ?? main[0]?.card_img_file ?? null,
    evil?.card_img_file ?? main[1]?.card_img_file ?? null,
  ];
}
