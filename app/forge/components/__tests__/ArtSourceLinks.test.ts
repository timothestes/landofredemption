import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/forge/components/SourceLinkDialog", () => ({ default: () => null }));
vi.mock("@/app/forge/components/ArtCandidatesPanel", () => ({
  candidateUrl: (cardId: string, id: string) => `/art/${cardId}/${id}`,
}));

import ArtSourceLinks from "@/app/forge/components/ArtSourceLinks";

const candidate = (id: string, sourceUrl: string | null) => ({ id, createdAt: "2026-11-08", isActiveSource: false, sourceUrl });
const render = (candidates: ReturnType<typeof candidate>[]) =>
  renderToStaticMarkup(React.createElement(ArtSourceLinks, { cardId: "c1", candidates }));

describe("ArtSourceLinks", () => {
  it("offers one link control per image, saying whether it has a link yet", () => {
    const html = render([candidate("a", null), candidate("b", "https://example.invalid/x")]);
    expect(html).toContain('aria-label="Add source link"');
    expect(html).toContain('aria-label="Edit source link"');
    expect(html).toContain("/art/c1/a");
    expect(html).toContain("/art/c1/b");
  });

  it("offers nothing that would change the art", () => {
    const html = render([candidate("a", null)]);
    for (const word of ["Use this", "Delete", "Crop", "Add images"]) expect(html).not.toContain(word);
  });

  it("says why the rest of the form is locked", () => {
    expect(render([candidate("a", null)])).toContain("can’t change");
  });

  it("shows nothing for a card with no images", () => {
    expect(render([])).toBe("");
  });
});
