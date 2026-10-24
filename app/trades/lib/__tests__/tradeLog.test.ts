import { describe, it, expect } from "vitest";
import {
  applyCollectionDeltas,
  collectionDeltas,
  suggestTradeListUpdates,
  tradeSideValue,
  type TradeLogCard,
} from "../tradeLog";
import type { TradeItem } from "../tradeList";

function card(overrides: Partial<TradeLogCard> = {}): TradeLogCard {
  return {
    direction: "received",
    cardName: "Son of God",
    cardSet: "Pri",
    cardImgFile: "sog-pri",
    quantity: 1,
    unitPrice: null,
    ...overrides,
  };
}

function item(overrides: Partial<TradeItem> = {}): TradeItem {
  return {
    kind: "want",
    cardName: "Son of God",
    cardSet: "Pri",
    cardImgFile: "sog-pri",
    anyVersion: false,
    priority: false,
    quantity: 1,
    note: "",
    ...overrides,
  };
}

describe("collectionDeltas", () => {
  it("adds received and subtracts given, per printing", () => {
    const deltas = collectionDeltas([
      card({ quantity: 2 }),
      card({ direction: "gave", cardName: "Goliath", cardSet: "Ki", cardImgFile: "g", quantity: 3 }),
    ]);
    expect(deltas.get("Son of God|Pri|sog-pri")).toBe(2);
    expect(deltas.get("Goliath|Ki|g")).toBe(-3);
  });

  it("drops printings that net to zero", () => {
    expect(collectionDeltas([card(), card({ direction: "gave" })]).size).toBe(0);
  });
});

describe("applyCollectionDeltas", () => {
  it("returns new quantities and floors at zero", () => {
    const next = applyCollectionDeltas(
      new Map([["a", 2], ["b", 1]]),
      new Map([["a", 1], ["b", -5], ["c", 2]])
    );
    expect(Object.fromEntries(next)).toEqual({ a: 3, b: 0, c: 2 });
  });
});

describe("suggestTradeListUpdates", () => {
  it("reduces a Want of the same printing", () => {
    const want = item({ quantity: 3 });
    const [s] = suggestTradeListUpdates([card({ quantity: 2 })], [want]);
    expect(s.item).toBe(want);
    expect(s.newQuantity).toBe(1);
    expect(s.reason).toBe("Received 2");
  });

  it("fills an any-printing Want from a different printing", () => {
    const want = item({ anyVersion: true, cardSet: "Pmo", cardImgFile: "sog-promo" });
    const [s] = suggestTradeListUpdates([card()], [want]);
    expect(s.newQuantity).toBe(0);
  });

  it("does not fill an exact-printing Want from a different printing", () => {
    const want = item({ cardSet: "Pmo", cardImgFile: "sog-promo" });
    expect(suggestTradeListUpdates([card()], [want])).toEqual([]);
  });

  it("prefers the exact-printing Want before an any-printing one", () => {
    const exact = item();
    const any = item({ anyVersion: true, cardSet: "Pmo", cardImgFile: "sog-promo" });
    const result = suggestTradeListUpdates([card()], [any, exact]);
    expect(result.map((s) => s.item)).toEqual([exact]);
  });

  it("uses up a Have of the same printing when given", () => {
    const have = item({ kind: "have", quantity: 2 });
    const [s] = suggestTradeListUpdates([card({ direction: "gave" })], [have]);
    expect(s.newQuantity).toBe(1);
    expect(s.reason).toBe("Gave 1");
  });

  it("never touches Wants for given cards or Haves for received ones", () => {
    const want = item();
    const have = item({ kind: "have" });
    expect(suggestTradeListUpdates([card({ direction: "gave" })], [want])).toEqual([]);
    expect(suggestTradeListUpdates([card()], [have])).toEqual([]);
  });
});

describe("tradeSideValue", () => {
  it("totals priced copies and counts unpriced ones per side", () => {
    const cards = [
      card({ unitPrice: 2.5, quantity: 2 }),
      card({ unitPrice: null, quantity: 3 }),
      card({ direction: "gave", unitPrice: 10 }),
    ];
    expect(tradeSideValue(cards, "received")).toEqual({ total: 5, unpriced: 3 });
    expect(tradeSideValue(cards, "gave")).toEqual({ total: 10, unpriced: 0 });
  });
});
