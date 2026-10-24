import { CARD_BY_FULL_KEY } from "../../decklist/card-search/data/cardIndex";
import { categorizeRarity } from "../../decklist/card-search/utils";
import type { DisplayTradeItem, TradeItem } from "./tradeList";

/**
 * Joins trade items to the card catalog for display. Lives apart from
 * tradeList.ts so the public page can run it on the server and not ship the
 * catalog to the browser.
 */
export function withCardInfo(items: TradeItem[]): DisplayTradeItem[] {
  return items.map((item) => {
    const card = CARD_BY_FULL_KEY.get(`${item.cardName}|${item.cardSet}|${item.cardImgFile}`);
    return {
      ...item,
      setName: card?.officialSet || item.cardSet,
      rarity: card ? categorizeRarity(card.rarity, card.officialSet) : "",
    };
  });
}
