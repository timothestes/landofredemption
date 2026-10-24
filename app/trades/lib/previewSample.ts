// PREVIEW-ONLY — delete with previewStore.ts once migration 119 is live.
// Sample cards for the public page while the trade tables don't exist yet.

import { ALL_CARDS } from "../../decklist/card-search/data/cardIndex";
import type { TradeItem } from "./tradeList";

const SAMPLE_WANT_NAMES = ["Son of God", "Angel of the Lord", "Michael", "Herod's Temple", "Daniel"];
const SAMPLE_HAVE_NAMES = ["Goliath", "Samson", "Gabriel", "Moses", "Abraham", "Lost Soul"];

function pick(names: string[], offset: number) {
  const found = names
    .map((n) => ALL_CARDS.find((c) => c.name === n))
    .filter((c): c is NonNullable<typeof c> => !!c);
  // Top up from the catalog if some names have been renamed.
  for (let i = offset; found.length < names.length && i < ALL_CARDS.length; i += 97) {
    found.push(ALL_CARDS[i]);
  }
  return found;
}

export function sampleTradeItems(): TradeItem[] {
  const notes = ["", "NM only", "", "Will trade 2-for-1", "", ""];
  const wants = pick(SAMPLE_WANT_NAMES, 11).map((c, i): TradeItem => ({
    kind: "want",
    cardName: c.name,
    cardSet: c.set,
    cardImgFile: c.imgFile,
    anyVersion: i % 2 === 1,
    priority: i < 2,
    quantity: (i % 3) + 1,
    note: notes[i] ?? "",
  }));
  const haves = pick(SAMPLE_HAVE_NAMES, 53).map((c, i): TradeItem => ({
    kind: "have",
    cardName: c.name,
    cardSet: c.set,
    cardImgFile: c.imgFile,
    anyVersion: false,
    priority: false,
    quantity: (i % 2) + 1,
    note: notes[(i + 1) % notes.length] ?? "",
  }));
  return [...wants, ...haves];
}
