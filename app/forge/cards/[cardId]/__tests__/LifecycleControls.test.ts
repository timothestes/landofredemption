import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

// Server actions and the router are only reachable from click handlers, which a
// static render never fires.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/app/forge/lib/lifecycle", () => ({}));

import LifecycleControls from "@/app/forge/cards/[cardId]/LifecycleControls";

const card = (over: Partial<ForgeCardFull> = {}): ForgeCardFull => ({
  id: "c1",
  title: "Invented Card",
  snapshot: { name: "Invented Card", cardType: ["Hero"] },
  hasArt: false,
  hasFinished: false,
  isPlaceholder: false,
  status: "private_idea",
  updatedAt: "2026-11-08T00:00:00Z",
  setId: null,
  publishedVersionId: null,
  approvedVersionId: null,
  ownerId: "u1",
  creatorId: "u1",
  createdAt: "2026-11-08T00:00:00Z",
  ...over,
});

const render = (over: Partial<ForgeCardFull> = {}) =>
  renderToStaticMarkup(React.createElement(LifecycleControls, { card: card(over), sets: [] }));

describe("LifecycleControls", () => {
  it("gives an idea a More actions menu, where Delete lives", () => {
    const html = render();
    expect(html).toContain("Share to a set");
    expect(html).toContain('aria-label="More actions"');
  });

  it("keeps the same menu on a card in a set", () => {
    expect(render({ status: "draft", setId: "s1" })).toContain('aria-label="More actions"');
  });
});
