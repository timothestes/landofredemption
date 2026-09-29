import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DeckDescription from "../DeckDescription";
import { EMPTY_REFS, type ArticleRefs } from "@/app/articles/lib/refTypes";

const render = (refs: ArticleRefs) =>
  renderToStaticMarkup(createElement(DeckDescription, { markdown: "Open with [[Zzz Fake Card]].", refs }));

describe("DeckDescription", () => {
  it("renders a mention from the refs it is given instead of resolving it itself", () => {
    const html = render({
      cards: { "zzz fake card": { name: "Zzz Fake Card", imgFile: "Zzz_Fake_Card_(X)" } },
      decks: {},
      terms: {},
    });
    // A resolved mention is the interactive chip (hover preview / tap to enlarge).
    expect(html).toContain('class="card-mention');
    expect(html).toContain("Zzz Fake Card");
  });

  it("leaves a mention that did not resolve as plain text", () => {
    const html = render(EMPTY_REFS);
    expect(html).not.toContain("card-mention");
    expect(html).toContain("Zzz Fake Card");
  });
});
