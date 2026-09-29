import { describe, it, expect } from "vitest";
import { resolveDeckDescriptionRefs } from "../descriptionRefs";

describe("resolveDeckDescriptionRefs", () => {
  it("resolves a card mention to its canonical catalog record", () => {
    const refs = resolveDeckDescriptionRefs("Open with [[son of god]] on turn one.");
    expect(refs.cards["son of god"]?.name).toMatch(/^Son of God/);
    expect(refs.cards["son of god"]?.imgFile).toBeTruthy();
  });

  it("resolves glossary shorthand and never embeds decks", () => {
    const refs = resolveDeckDescriptionRefs("Hold your [[EC]] for the rescue.");
    expect(refs.terms["ec"]).toBeDefined();
    expect(refs.cards).toEqual({});
    expect(refs.decks).toEqual({});
  });

  it("leaves an unknown mention unresolved and tolerates empty text", () => {
    expect(resolveDeckDescriptionRefs("[[Definitely Not A Card]]").cards).toEqual({});
    expect(resolveDeckDescriptionRefs("")).toEqual({ cards: {}, decks: {}, terms: {} });
  });
});
