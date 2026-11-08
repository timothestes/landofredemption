import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/forge/lib/comments", () => ({
  addComment: vi.fn(), deleteComment: vi.fn(), listCardComments: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/app/forge/lib/sets", () => ({ getSet: vi.fn(async () => ({ id: "s1", name: "Invented Set" })) }));
vi.mock("@/app/forge/lib/play", () => ({
  listSetApprovedCards: vi.fn(async () => [{
    cardId: "c1", data: { name: "Invented Tyrant" }, hasApprovedArt: true, hasApprovedFinished: false,
    versionId: "version-row-id", versionNumber: 3,
  }]),
}));

import RevealGrid, { type RevealItem } from "../RevealGrid";
import ForgePlaySetPage from "../page";

const tyrant: RevealItem = {
  cardId: "c1",
  data: {
    name: "Invented Tyrant", cardType: ["EvilCharacter"], alignment: "Evil",
    brigades: ["Crimson"], strength: 7, toughness: 5, rawText: "Discard a card.",
  },
  artUrl: null, finishedUrl: null, versionNumber: 3,
};

const render = (items: RevealItem[]) =>
  renderToStaticMarkup(React.createElement(RevealGrid, { items, currentUserId: "u1" }));

describe("RevealGrid tile", () => {
  it("draws a card with no art as the rendered face, stats included", () => {
    const html = render([tyrant]);
    expect(html).toContain('aria-label="Card preview: Invented Tyrant"');
    expect(html).toContain(">7/5</text>");
  });

  it("keeps the uploaded finished image over the rendered face", () => {
    const html = render([{ ...tyrant, finishedUrl: "/forge/api/art/c1?v=approved&kind=finished" }]);
    expect(html).toContain('src="/forge/api/art/c1?v=approved&amp;kind=finished"');
    expect(html).not.toContain("Card preview:");
  });

  it("names the released version on the tile", () => {
    expect(render([tyrant])).toMatch(/>v3</);
  });
});

// The page is the boundary: whatever it hands RevealGrid is serialized into a playtester's HTML.
describe("playtest page payload", () => {
  const revealGridProps = (node: any): any => {
    if (!node || typeof node !== "object") return null;
    if (node.type === RevealGrid) return node.props;
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = revealGridProps(child);
      if (found) return found;
    }
    return null;
  };

  it("leaves the <main> landmark to the root layout", async () => {
    const page = await ForgePlaySetPage({ params: Promise.resolve({ setId: "s1" }) });
    expect(renderToStaticMarkup(page)).not.toContain("<main");
  });

  it("carries exactly the released card, its image urls and its version number", async () => {
    const page = await ForgePlaySetPage({ params: Promise.resolve({ setId: "s1" }) });
    const { items } = revealGridProps(page);
    expect(items).toEqual([{
      cardId: "c1", data: { name: "Invented Tyrant" },
      artUrl: "/forge/api/art/c1?v=approved", finishedUrl: null, versionNumber: 3,
    }]);
  });
});
