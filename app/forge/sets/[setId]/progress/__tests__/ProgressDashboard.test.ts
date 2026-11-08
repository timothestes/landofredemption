import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ProgressDashboard from "../ProgressDashboard";
import { computeProgress } from "@/app/forge/lib/progress";

const render = (model: ReturnType<typeof computeProgress>) =>
  renderToStaticMarkup(React.createElement(ProgressDashboard, { setId: "s", model, hasApprovedArt: false }))
    .replace(/<[^>]+>/g, "|");

describe("ProgressDashboard", () => {
  it("shows the same count in a type's Total and in What's left", () => {
    const cards = [
      { snapshot: { cardType: ["Hero"], brigades: ["Silver"] }, status: "draft" },
      { snapshot: { cardType: ["Hero"], brigades: ["Blue"] }, status: "draft" },
    ];
    const text = render(computeProgress(cards, { cells: { Hero: { none: 4 } } }));
    expect(text).toContain("2/4");
    expect(text).toContain("2 more Hero");
    expect(text).not.toContain("4 more Hero");
    expect(text).not.toContain("0/4");
  });

  // New sets no longer ask for a total, so this is the normal state of a new set.
  it("reads sensibly with no total, empty or not", () => {
    const empty = render(computeProgress([], {}));
    expect(empty).toContain("|0|");
    expect(empty).toContain("cards in set");
    const one = render(computeProgress([{ snapshot: { cardType: ["Hero"], brigades: ["Blue"] }, status: "draft" }], {}));
    for (const text of [empty, one]) {
      expect(text).not.toContain("/ 0");
      expect(text).not.toContain("%");
      expect(text).not.toContain("NaN");
      expect(text).not.toContain("Infinity");
    }
  });
});
