import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CardDetailsFields from "../CardDetailsFields";
import type { DesignCard } from "@/app/forge/lib/designCard";

const render = (snapshot: DesignCard) =>
  renderToStaticMarkup(React.createElement(CardDetailsFields, { snapshot, update: () => {} }));
const buttonAttrs = (html: string, label: string) => {
  const m = html.match(new RegExp(`<button([^>]*)>${label}</button>`));
  if (!m) throw new Error(`no "${label}" button`);
  return m[1];
};
const ALL_GOOD: DesignCard["brigades"] = ["Blue", "Clay", "GoodGold", "Green", "Purple", "Red", "Silver", "Teal", "White"];

// Clicking is covered by toggleMultiBrigade's tests; vitest here has no DOM.
describe("CardDetailsFields Multi brigade", () => {
  it("offers a Multi button per alignment, pressed only when that whole set is selected", () => {
    const full = render({ cardType: ["GE"], alignment: "Good", brigades: ALL_GOOD });
    expect(buttonAttrs(full, "Good Multi")).toMatch(/aria-pressed="true"/);
    expect(buttonAttrs(full, "Evil Multi")).toMatch(/aria-pressed="false"/);
    const three = render({ cardType: ["EE"], alignment: "Evil", brigades: ["Crimson", "EvilGold", "Gray"] });
    expect(buttonAttrs(three, "Evil Multi")).toMatch(/aria-pressed="false"/);
  });

  it("summarizes a full set as Multi instead of listing every brigade", () => {
    const summary = render({ cardType: ["GE"], alignment: "Good", brigades: ALL_GOOD })
      .match(/<summary[^>]*>[\s\S]*?<\/summary>/)![0];
    expect(summary).toContain("GE · Good Multi");
    expect(summary).not.toContain("Clay");
  });
});
