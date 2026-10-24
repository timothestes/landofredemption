import { describe, it, expect } from "vitest";
import {
  findTradeMatches,
  keyOfItem,
  mergeWants,
  spareHaves,
  tradeListText,
  type DisplayTradeItem,
  type TradeItem,
} from "../tradeList";

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

describe("findTradeMatches", () => {
  it("flags owner Wants the visitor owns, by exact printing", () => {
    const want = item();
    const other = item({ cardSet: "Pmo", cardImgFile: "sog-promo" });
    const { youOwn } = findTradeMatches([want, other], new Map([["Son of God|Pri|sog-pri", 1]]), []);
    expect([...youOwn]).toEqual([keyOfItem(want)]);
  });

  it("covers an any-printing Want with any printing the visitor owns", () => {
    const want = item({ anyVersion: true, cardSet: "Pmo", cardImgFile: "sog-promo" });
    const { youOwn } = findTradeMatches([want], new Map([["Son of God|Pri|sog-pri", 2]]), []);
    expect(youOwn.has(keyOfItem(want))).toBe(true);
  });

  it("ignores zero-quantity collection rows", () => {
    const { youOwn } = findTradeMatches([item()], new Map([["Son of God|Pri|sog-pri", 0]]), []);
    expect(youOwn.size).toBe(0);
  });

  it("flags owner Haves the visitor wants, exact or any printing", () => {
    const have = item({ kind: "have" });
    const otherHave = item({ kind: "have", cardName: "Goliath", cardSet: "Ki", cardImgFile: "g" });
    const exact = findTradeMatches([have, otherHave], new Map(), [item()]);
    expect([...exact.youWant]).toEqual([keyOfItem(have)]);
    const any = findTradeMatches(
      [have],
      new Map(),
      [item({ anyVersion: true, cardSet: "Pmo", cardImgFile: "sog-promo" })]
    );
    expect(any.youWant.has(keyOfItem(have))).toBe(true);
  });

  it("does not match a different printing for an exact Want", () => {
    const have = item({ kind: "have" });
    const { youWant } = findTradeMatches([have], new Map(), [item({ cardSet: "Pmo", cardImgFile: "x" })]);
    expect(youWant.size).toBe(0);
  });
});

describe("spareHaves", () => {
  const owned = new Map([
    ["Son of God|Pri|sog-pri", 4],
    ["Goliath|Ki|g", 1],
    ["Abel|Pa|a", 3],
  ]);

  it("offers copies beyond the number kept", () => {
    const result = spareHaves(owned, 2, []);
    expect(result.map((h) => `${h.cardName}:${h.quantity}`)).toEqual(["Abel:1", "Son of God:2"]);
    expect(result.every((h) => h.kind === "have")).toBe(true);
  });

  it("skips printings already listed as Haves", () => {
    const result = spareHaves(owned, 0, [item({ kind: "have", cardName: "Abel", cardSet: "Pa", cardImgFile: "a" })]);
    expect(result.map((h) => h.cardName)).toEqual(["Goliath", "Son of God"]);
  });
});

describe("mergeWants", () => {
  it("adds new Wants", () => {
    expect(mergeWants([], [item({ quantity: 2 })])).toEqual([item({ quantity: 2 })]);
  });

  it("raises an existing Want to the larger quantity, keeping its note", () => {
    const existing = item({ quantity: 1, note: "NM", priority: true });
    expect(mergeWants([existing], [item({ quantity: 3 })])).toEqual([{ ...existing, quantity: 3 }]);
  });

  it("leaves an existing Want alone when it already covers the quantity", () => {
    expect(mergeWants([item({ quantity: 4 })], [item({ quantity: 2 })])).toEqual([]);
  });

  it("collapses duplicates within the incoming list", () => {
    expect(mergeWants([], [item({ quantity: 1 }), item({ quantity: 2 })])).toEqual([item({ quantity: 2 })]);
  });

  it("merges an any-printing Want into the existing any-printing Want of another printing", () => {
    const existing = item({ anyVersion: true, note: "keep me" });
    const fromDeck = item({ anyVersion: true, cardSet: "Pmo", cardImgFile: "sog-promo", quantity: 2 });
    expect(mergeWants([existing], [fromDeck])).toEqual([{ ...existing, quantity: 2 }]);
    expect(mergeWants([existing], [item({ anyVersion: true, cardSet: "Pmo", cardImgFile: "sog-promo" })])).toEqual([]);
  });

  it("keeps an exact-printing Want separate from an any-printing one", () => {
    const anyPrinting = item({ anyVersion: true });
    const exactPromo = item({ cardSet: "Pmo", cardImgFile: "sog-promo" });
    expect(mergeWants([anyPrinting], [exactPromo])).toEqual([exactPromo]);
  });

  it("collapses any-printing duplicates of one card within the incoming list", () => {
    const a = item({ anyVersion: true, quantity: 1 });
    const b = item({ anyVersion: true, cardSet: "Pmo", cardImgFile: "sog-promo", quantity: 3 });
    expect(mergeWants([], [a, b])).toEqual([{ ...a, quantity: 3 }]);
  });
});

describe("tradeListText", () => {
  const shown = (o: Partial<DisplayTradeItem>): DisplayTradeItem => ({ ...item(), setName: "Priests", rarity: "Rare", ...o });

  it("lists sections with counts, printings, notes and the link", () => {
    const text = tradeListText(
      "jhendrix",
      [
        shown({ priority: true, quantity: 2, note: "NM only" }),
        shown({ cardName: "Michael", anyVersion: true }),
        shown({ kind: "have", cardName: "Goliath", setName: "Kings" }),
      ],
      "https://example.com/trades/jhendrix"
    );
    expect(text).toBe(
      [
        "jhendrix's trade list",
        "https://example.com/trades/jhendrix",
        "",
        "★ PRIORITY WANTS (2)",
        "2x Son of God (Priests) — NM only",
        "",
        "WANTS (1)",
        "1x Michael (any printing)",
        "",
        "HAVES (1)",
        "1x Goliath (Kings)",
      ].join("\n")
    );
  });

  it("omits the link and empty sections", () => {
    expect(tradeListText("a", [shown({ kind: "have" })], null)).toBe("a's trade list\n\nHAVES (1)\n1x Son of God (Priests)");
  });

  it("titles the list 'My trade list' when the owner has no username", () => {
    expect(tradeListText(null, [shown({ kind: "have" })], null)).toBe("My trade list\n\nHAVES (1)\n1x Son of God (Priests)");
  });
});
