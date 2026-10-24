import { describe, it, expect } from "vitest";
import {
  clampTradeQuantity,
  cleanTradeNote,
  filterTradeItems,
  sortTradeItems,
  tradeFilterOptions,
  DEFAULT_TRADE_FILTERS,
  type DisplayTradeItem,
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
    priority: false,
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

  it("drops the priority flag from Haves", () => {
    expect(normalizeTradeItem(item({ kind: "have", priority: true })).priority).toBe(false);
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

  it("pulls priority Wants into their own group", () => {
    const { priorityWants, wants } = splitTradeItems([
      item({ cardName: "Abel" }),
      item({ cardName: "Zeal", priority: true }),
    ]);
    expect(priorityWants.map((w) => w.cardName)).toEqual(["Zeal"]);
    expect(wants.map((w) => w.cardName)).toEqual(["Abel"]);
  });
});

function shown(overrides: Partial<DisplayTradeItem> = {}): DisplayTradeItem {
  return { ...item(), setName: "Priests", rarity: "Common", ...overrides };
}

describe("filterTradeItems", () => {
  const list = [
    shown({ cardName: "Son of God", setName: "Priests", rarity: "Ultra Rare" }),
    shown({ cardName: "Goliath", setName: "Kings", rarity: "Rare", note: "NM only" }),
    shown({ cardName: "Abel", setName: "Kings", rarity: "Common" }),
  ];

  it("returns everything with default filters", () => {
    expect(filterTradeItems(list, DEFAULT_TRADE_FILTERS)).toHaveLength(3);
  });

  it("searches name, set and note, ignoring case", () => {
    const names = (q: string) =>
      filterTradeItems(list, { ...DEFAULT_TRADE_FILTERS, query: q }).map((i) => i.cardName);
    expect(names("son of")).toEqual(["Son of God"]);
    expect(names("KINGS")).toEqual(["Goliath", "Abel"]);
    expect(names("nm only")).toEqual(["Goliath"]);
  });

  it("combines set and rarity filters", () => {
    const result = filterTradeItems(list, { ...DEFAULT_TRADE_FILTERS, set: "Kings", rarity: "Rare" });
    expect(result.map((i) => i.cardName)).toEqual(["Goliath"]);
  });
});

describe("sortTradeItems", () => {
  const list = [
    shown({ cardName: "Abel", setName: "Kings", rarity: "Common" }),
    shown({ cardName: "Goliath", setName: "Apostles", rarity: "Ultra Rare" }),
    shown({ cardName: "Son of God", setName: "Priests", rarity: "Promo" }),
  ];

  it("sorts by set name", () => {
    expect(sortTradeItems(list, "set").map((i) => i.setName)).toEqual(["Apostles", "Kings", "Priests"]);
  });

  it("sorts rarest first", () => {
    expect(sortTradeItems(list, "rarity").map((i) => i.rarity)).toEqual(["Ultra Rare", "Promo", "Common"]);
  });
});

describe("tradeFilterOptions", () => {
  it("lists only the sets and rarities present, rarest first", () => {
    const { sets, rarities } = tradeFilterOptions([
      shown({ setName: "Kings", rarity: "Common" }),
      shown({ setName: "Apostles", rarity: "Ultra Rare" }),
      shown({ setName: "Kings", rarity: "Common" }),
    ]);
    expect(sets).toEqual(["Apostles", "Kings"]);
    expect(rarities).toEqual(["Ultra Rare", "Common"]);
  });
});

describe("totalCopies", () => {
  it("sums quantities", () => {
    expect(totalCopies([item({ quantity: 2 }), item({ quantity: 3 })])).toBe(5);
  });
});
