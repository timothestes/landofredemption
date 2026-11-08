import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { diffCards } from "@/app/forge/lib/cardDiff";
import FieldChanges from "@/app/forge/cards/[cardId]/FieldChanges";

const render = (before: object, after: object, isNewCard = false) =>
  renderToStaticMarkup(React.createElement(FieldChanges, { changes: diffCards(before, after), isNewCard }));

describe("FieldChanges text", () => {
  const LONG = "Protect target Hero from the next opponent enhancement this turn. Draw";

  // The audit's complaint: one word, two whole paragraphs.
  it("shows a one-word change as one paragraph with the word marked", () => {
    const html = render({ rawText: `${LONG} 2.` }, { rawText: `${LONG} 3.` });
    expect(html.match(/<div/g)).toHaveLength(1);
    expect(html).toMatch(/<del[^>]*>2<\/del>/);
    expect(html).toMatch(/<ins[^>]*>3<\/ins>/);
    expect(html.match(/Protect target Hero/g)).toHaveLength(1);
  });

  it("keeps a rewrite as two paragraphs", () => {
    const html = render({ rawText: "Protect target Hero this turn." }, { rawText: "Discard the top card of a deck." });
    expect(html).toContain("border-rose-500");
    expect(html).toContain("border-emerald-500");
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("Protect target Hero this turn.");
    expect(text).toContain("Discard the top card of a deck.");
  });

  it("shows emptied text as the old value only", () => {
    const html = render({ rawText: "Old words." }, {});
    expect(html).toContain("Old words.");
    expect(html).toContain("border-rose-500");
    expect(html).not.toContain("border-emerald-500");
  });

  it("shows a first value plainly, and a new card with no marks", () => {
    expect(render({}, { rawText: "New words." })).not.toContain("<ins");
    expect(render({ rawText: "Old" }, { rawText: "New" }, true)).not.toContain("<ins");
  });

  it("leaves a stat as old and new on one line", () => {
    const html = render({ toughness: 1 }, { toughness: 2 });
    expect(html).toContain("line-through");
    expect(html).not.toContain("<del");
  });
});
