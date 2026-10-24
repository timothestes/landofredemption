import { describe, it, expect } from "vitest";
import {
  clampTradeQuantity,
  cleanTradeNote,
  haveShortfall,
  keyOfItem,
  normalizeTradeItem,
  splitTradeItems,
  totalCopies,
  tradeItemKey,
  MAX_TRADE_NOTE_LENGTH,
  type TradeItem,
} from "../tradeList";

function item(overrides: Partial<TradeItem> = {}): TradeItem {
  return {
    kind: "want",
    cardName: "Son of God",
    cardSet: "Pri",
    cardImgFile: "/cards/son-of-god.jpg",
    anyVersion: false,
    quantity: 1,
    note: "",
    ...overrides,
  };
}

describe("tradeItemKey", () => {
  it("separates the same printing on the Wants and Haves sides", () => {
    const card = { name: "Son of God", set: "Pri", imgFile: "/a.jpg" };
    expect(tradeItemKey("want", card)).not.toBe(tradeItemKey("have", card));
  });

  it("matches keyOfItem for the same identity", () => {
    const i = item({ kind: "have" });
    expect(keyOfItem(i)).toBe(
      tradeItemKey("have", { name: i.cardName, set: i.cardSet, imgFile: i.cardImgFile })
    );
  });
});

describe("clampTradeQuantity", () => {
  it("treats zero, negatives and junk as remove", () => {
    expect(clampTradeQuantity(0)).toBe(0);
    expect(clampTradeQuantity(-3)).toBe(0);
    expect(clampTradeQuantity(NaN)).toBe(0);
  });

  it("floors and caps at 99", () => {
    expect(clampTradeQuantity(2.7)).toBe(2);
    expect(clampTradeQuantity(500)).toBe(99);
  });
});

describe("cleanTradeNote", () => {
  it("collapses whitespace and trims", () => {
    expect(cleanTradeNote("  NM   only\n please ")).toBe("NM only please");
  });

  it("caps the length", () => {
    expect(cleanTradeNote("x".repeat(500))).toHaveLength(MAX_TRADE_NOTE_LENGTH);
  });
});

describe("normalizeTradeItem", () => {
  it("drops the any-version flag from Haves", () => {
    expect(normalizeTradeItem(item({ kind: "have", anyVersion: true })).anyVersion).toBe(false);
  });

  it("keeps the any-version flag on Wants", () => {
    expect(normalizeTradeItem(item({ anyVersion: true })).anyVersion).toBe(true);
  });
});

describe("haveShortfall", () => {
  it("is zero when the collection covers the Have", () => {
    expect(haveShortfall(item({ kind: "have", quantity: 2 }), 3)).toBe(0);
  });

  it("counts copies offered beyond what is owned", () => {
    expect(haveShortfall(item({ kind: "have", quantity: 4 }), 1)).toBe(3);
  });

  it("never flags Wants", () => {
    expect(haveShortfall(item({ kind: "want", quantity: 4 }), 0)).toBe(0);
  });
});

describe("splitTradeItems", () => {
  it("splits by kind and sorts by name then set", () => {
    const { wants, haves } = splitTradeItems([
      item({ cardName: "Zeal", kind: "want" }),
      item({ cardName: "Abraham", kind: "have" }),
      item({ cardName: "Abel", kind: "want", cardSet: "Pa" }),
      item({ cardName: "Abel", kind: "want", cardSet: "Ki" }),
    ]);
    expect(wants.map((w) => `${w.cardName}/${w.cardSet}`)).toEqual(["Abel/Ki", "Abel/Pa", "Zeal/Pri"]);
    expect(haves.map((h) => h.cardName)).toEqual(["Abraham"]);
  });
});

describe("totalCopies", () => {
  it("sums quantities", () => {
    expect(totalCopies([item({ quantity: 2 }), item({ quantity: 3 })])).toBe(5);
  });
});
