import { describe, expect, it } from "vitest";
import { mergeDeckCardRows } from "../mergeDeckCards";

describe("mergeDeckCardRows", () => {
  it("sums a card named twice in one zone into one row", () => {
    const rows = mergeDeckCardRows([
      { card_name: "Delivered", card_set: "PoC", card_img_file: "107-Delivered", quantity: 1, zone: "main" },
      { card_name: "Egypt", card_set: "PoC", card_img_file: "020-Egypt", quantity: 1, zone: "main" },
      { card_name: "Delivered", card_set: "PoC", card_img_file: "107-Delivered", quantity: 2, zone: "main" },
    ]);
    expect(rows).toEqual([
      { card_name: "Delivered", card_set: "PoC", card_img_file: "107-Delivered", quantity: 3, zone: "main" },
      { card_name: "Egypt", card_set: "PoC", card_img_file: "020-Egypt", quantity: 1, zone: "main" },
    ]);
  });

  it("keeps the same card in different zones apart", () => {
    const rows = mergeDeckCardRows([
      { card_name: "Foreign Horses (LoC)", card_set: "LoC", quantity: 1, zone: "reserve" },
      { card_name: "Foreign Horses (LoC)", card_set: "LoC", quantity: 1, zone: "maybeboard" },
    ]);
    expect(rows.map((r) => r.zone)).toEqual(["reserve", "maybeboard"]);
  });

  it("keeps different sets of one name apart", () => {
    const rows = mergeDeckCardRows([
      { card_name: "Son of God", card_set: "Pmo-P1", quantity: 1, zone: "main" },
      { card_name: "Son of God", card_set: "Fund", quantity: 1, zone: "main" },
    ]);
    expect(rows).toHaveLength(2);
  });

  it("treats a missing set and an empty set as the same null set", () => {
    const rows = mergeDeckCardRows([
      { card_name: "Unknown Card", card_set: "", quantity: 1, zone: "main" },
      { card_name: "Unknown Card", quantity: 1, zone: "main" },
    ]);
    expect(rows).toEqual([
      { card_name: "Unknown Card", card_set: null, card_img_file: null, quantity: 2, zone: "main" },
    ]);
  });

  it("does not change the rows it was given", () => {
    const input = [
      { card_name: "Delivered", card_set: "PoC", quantity: 1, zone: "main" as const },
      { card_name: "Delivered", card_set: "PoC", quantity: 1, zone: "main" as const },
    ];
    mergeDeckCardRows(input);
    expect(input.map((c) => c.quantity)).toEqual([1, 1]);
  });
});
