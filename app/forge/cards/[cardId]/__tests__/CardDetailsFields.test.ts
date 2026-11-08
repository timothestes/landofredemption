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

// `open` is seeded once at mount, so nothing here can close it under someone mid-edit; that
// half needs a DOM and was checked in a mounted harness.
describe("CardDetailsFields starting state", () => {
  const details = (html: string) => html.match(/<details[^>]*>/)![0];

  it("starts open on a card with no type yet", () => {
    expect(details(render({}))).toMatch(/\bopen\b/);
    expect(details(render({ name: "Named only", rawText: "Some text." }))).toMatch(/\bopen\b/);
    expect(details(render({ cardType: [] }))).toMatch(/\bopen\b/);
  });

  it("starts collapsed once the card has a type", () => {
    expect(details(render({ cardType: ["Hero"] }))).not.toMatch(/\bopen\b/);
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

  // Each side control is a group named for the icon ("Territory class icon side"); its three
  // buttons carry the stored value as `title`, so a button is found inside its group.
  const group = (html: string, name: string) => {
    const m = html.match(new RegExp(`<div[^>]*aria-label="${name} side"[^>]*>.*?</div>`, "s"));
    if (!m) throw new Error(`no "${name}" group`);
    return m[0];
  };

  it("lets a Good/Evil Territory card choose the territory class icon's side, the good side pressed by default", () => {
    const dual: DesignCard = { cardType: ["GE", "EE"], alignment: "Good_Evil", brigades: ["Green", "Gray"], icons: ["Territory"] };
    const g = group(render(dual), "Territory class icon");
    expect(tile(g, "good")).toMatch(/aria-pressed="true"/);
    expect(tile(g, "evil")).toMatch(/aria-pressed="false"/);
    expect(tile(g, "both")).toMatch(/aria-pressed="false"/);
    expect(tile(g, "both")).toContain("Both sides");
    // The control is named for what the rules call it, not for the frame kit's asset.
    expect(render(dual)).not.toContain("Territory plate");
    expect(tile(group(render({ ...dual, territorySide: "both" }), "Territory class icon"), "both")).toMatch(/aria-pressed="true"/);
    // #593's name for the field for a day: still read, so the pressed side matches the preview.
    expect(tile(group(render({ ...dual, territoryPlate: "evil" }), "Territory class icon"), "evil")).toMatch(/aria-pressed="true"/);
    // Only a card set to Good/Evil alignment, with the icon, has a choice to make — a GE/EE
    // card filed as Neutral (the catalog's way) still previews as dual but keeps the default.
    expect(render({ ...dual, icons: ["Star"] })).not.toContain('title="both"');
    expect(render({ ...dual, alignment: "Neutral" })).not.toContain('title="both"');
    expect(render({ ...dual, alignment: undefined })).not.toContain('title="both"');
    expect(render({ cardType: ["GE"], brigades: ["Green"], icons: ["Territory"] })).not.toContain('title="both"');
  });

  it("gives each chosen class shield its own side control on a Good/Evil card, both sides by default", () => {
    const dual: DesignCard = { cardType: ["Hero", "EvilCharacter"], alignment: "Good_Evil", brigades: ["Purple", "Brown"], class: ["Warrior"] };
    const html = render(dual);
    expect(tile(group(html, "Warrior class icon"), "both")).toMatch(/aria-pressed="true"/);
    expect(html).not.toContain('aria-label="Weapon class icon side"');
    expect(html).not.toContain('aria-label="Territory class icon side"');
    const both = render({ ...dual, class: ["Warrior", "Weapon"], weaponSide: "evil" });
    expect(tile(group(both, "Warrior class icon"), "both")).toMatch(/aria-pressed="true"/);
    expect(tile(group(both, "Weapon class icon"), "evil")).toMatch(/aria-pressed="true"/);
    expect(tile(group(both, "Weapon class icon"), "both")).toMatch(/aria-pressed="false"/);
    // Not on a single-alignment card, nor before the alignment says Good/Evil.
    expect(render({ ...dual, cardType: ["Hero"], alignment: "Good" })).not.toContain("class icon side");
    expect(render({ ...dual, alignment: "Neutral" })).not.toContain("class icon side");
  });

  it("never leaves selection to color alone, and defers the art until opened", () => {
    const html = render({ cardType: ["Hero"], brigades: ["Blue"] });
    // 12 types + 16 brigades + 2 Multi + 2 classes + 3 icons.
    expect(html.match(/aria-pressed=/g)!.length).toBe(35);
    expect(html.match(/loading="lazy"/g)!.length).toBe(35);
    expect(tile(html, "Blue")).toMatch(/aria-pressed="true"/);
  });
});
