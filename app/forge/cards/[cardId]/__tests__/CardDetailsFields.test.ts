import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardDetailsFields from "../CardDetailsFields";
import type { DesignCard } from "@/app/forge/lib/designCard";

const render = (snapshot: DesignCard) =>
  renderToStaticMarkup(React.createElement(CardDetailsFields, { snapshot, update: () => {} }));

// Every picker option is an icon tile, so a tile is found by its `title` — the value
// as it's stored — rather than by its visible (friendlier) label.
const tile = (html: string, title: string) => {
  const m = html.match(new RegExp(`<button[^>]*\\btitle="${title}"[^>]*>.*?</button>`, "s"));
  if (!m) throw new Error(`no "${title}" tile`);
  return m[0];
};
const ALL_GOOD: DesignCard["brigades"] = ["Blue", "Clay", "GoodGold", "Green", "Purple", "Red", "Silver", "Teal", "White"];

// Clicking is covered by toggleMultiBrigade's tests; vitest here has no DOM.
describe("CardDetailsFields Multi brigade", () => {
  it("offers a Multi tile per alignment, pressed only when that whole set is selected", () => {
    const full = render({ cardType: ["GE"], alignment: "Good", brigades: ALL_GOOD });
    expect(tile(full, "Good Multi")).toMatch(/aria-pressed="true"/);
    expect(tile(full, "Evil Multi")).toMatch(/aria-pressed="false"/);
    const three = render({ cardType: ["EE"], alignment: "Evil", brigades: ["Crimson", "EvilGold", "Gray"] });
    expect(tile(three, "Evil Multi")).toMatch(/aria-pressed="false"/);
  });

  it("summarizes a full set as Multi instead of listing every brigade", () => {
    const summary = render({ cardType: ["GE"], alignment: "Good", brigades: ALL_GOOD })
      .match(/<summary[^>]*>[\s\S]*?<\/summary>/)![0];
    expect(summary).toContain("GE · Good Multi");
    expect(summary).not.toContain("Clay");
  });
});

describe("CardDetailsFields icon tiles", () => {
  it("shows each card type's own art, spacing the run-together names", () => {
    const html = render({ cardType: ["EvilCharacter"], alignment: "Evil" });
    expect(tile(html, "Hero")).toContain("/filter-icons/Hero.png");
    expect(tile(html, "EvilCharacter")).toContain("/filter-icons/Evil%20Character.png");
    expect(tile(html, "EvilCharacter")).toContain("Evil Character");
    expect(tile(html, "LostSoul")).toContain("Lost Soul");
  });

  it("follows alignment for the types printed in a good and an evil version", () => {
    expect(tile(render({ alignment: "Evil" }), "Dominant")).toContain("Evil%20Dominant");
    expect(tile(render({ alignment: "Good" }), "Dominant")).toContain("Good%20Dominant");
    expect(tile(render({}), "Fortress")).toContain("Good%20Fortress");
  });

  it("gives every brigade its colored art at rest, not just when selected", () => {
    const html = render({ cardType: ["Hero"] });
    expect(tile(html, "Crimson")).toContain("/filter-icons/Color=Crimson.png");
    expect(tile(html, "Crimson")).toMatch(/aria-pressed="false"/);
    expect(tile(html, "GoodGold")).toContain("Color=Good%20Gold.png");
    expect(tile(html, "PaleGreen")).toContain("Pale Green");
  });

  it("uses the frame kit's glyphs for class and icons, including Star and Cloud", () => {
    const html = render({ cardType: ["Hero"] });
    expect(tile(html, "Warrior")).toContain("/forge/frames/icons/warrior.png");
    expect(tile(html, "Territory")).toContain("/forge/frames/icons/territory.png");
    expect(tile(html, "Star")).toContain("/forge/frames/icons/star.png");
    expect(tile(html, "Cloud")).toContain("/forge/frames/icons/cloud.png");
  });

  it("never leaves selection to color alone, and defers the art until opened", () => {
    const html = render({ cardType: ["Hero"], brigades: ["Blue"] });
    // 12 types + 16 brigades + 2 Multi + 2 classes + 3 icons.
    expect(html.match(/aria-pressed=/g)!.length).toBe(35);
    expect(html.match(/loading="lazy"/g)!.length).toBe(35);
    expect(tile(html, "Blue")).toMatch(/aria-pressed="true"/);
  });
});
