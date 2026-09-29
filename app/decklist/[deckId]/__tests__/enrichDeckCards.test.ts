import { describe, it, expect } from "vitest";
import { enrichDeckCards } from "../enrichDeckCards";
import type { Card } from "../../card-search/utils";

const card = (over: Partial<Card>): Card => ({
  dataLine: "", name: "", set: "", imgFile: "", officialSet: "", type: "", brigade: "",
  strength: "", toughness: "", class: "", identifier: "", specialAbility: "", rarity: "",
  reference: "", alignment: "", legality: "", testament: "", isGospel: false, ...over,
});

describe("enrichDeckCards", () => {
  const sog = card({
    name: "Son of God", set: "Roots", imgFile: "Son_of_God_(Roots)",
    type: "Dominant", alignment: "Good", brigade: "Good Multi",
  });
  const lookup = new Map<string, Card>([["Son of God|Roots|Son_of_God_(Roots)", sog]]);

  it("attaches the catalog record and its type/alignment/brigade by name|set|image key", () => {
    const [row] = enrichDeckCards(
      [{ card_name: "Son of God", card_set: "Roots", card_img_file: "Son_of_God_(Roots).jpg", quantity: 1, zone: "main" }],
      lookup,
    );
    expect(row.fullCard).toBe(sog);
    expect(row.type).toBe("Dominant");
    expect(row.alignment).toBe("Good");
    expect(row.brigade).toBe("Good Multi");
    expect(row.quantity).toBe(1);
  });

  it("matches an image saved with a slash against the catalog's underscore form", () => {
    const ab = card({ name: "A/B", set: "S", imgFile: "A_B", type: "Hero" });
    const [row] = enrichDeckCards(
      [{ card_name: "A/B", card_set: "S", card_img_file: "A/B.jpg", quantity: 1, zone: "main" }],
      new Map([["A/B|S|A_B", ab]]),
    );
    expect(row.type).toBe("Hero");
  });

  it("leaves an unknown card renderable with empty fields and no catalog record", () => {
    const [row] = enrichDeckCards(
      [{ card_name: "Nope", card_set: "X", card_img_file: "Nope", quantity: 2, zone: "reserve" }],
      lookup,
    );
    expect(row).toMatchObject({
      card_name: "Nope", quantity: 2, zone: "reserve",
      type: "", alignment: "", brigade: "", fullCard: null,
    });
  });
});
