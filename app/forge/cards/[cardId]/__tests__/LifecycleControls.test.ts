import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import type { DesignCard } from "@/app/forge/lib/designCard";

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

const READY: DesignCard = { name: "Invented Card", cardType: ["Hero"] };

const render = (over: Partial<ForgeCardFull> = {}, draft: DesignCard = READY) =>
  renderToStaticMarkup(React.createElement(LifecycleControls, { card: card(over), draft, sets: [] }));

describe("LifecycleControls", () => {
  it("gives an idea a More actions menu, where Delete lives", () => {
    const html = render();
    expect(html).toContain("Share to a set");
    expect(html).toContain('aria-label="More actions"');
  });

  it("keeps the same menu on a card in a set", () => {
    expect(render({ status: "draft", setId: "s1" })).toContain('aria-label="More actions"');
  });

  const releaseButton = (html: string) => html.match(/<button[^>]*>Release to playtesters<\/button>/)?.[0] ?? "";
  const DISABLED = / disabled=""/; // not the button's `disabled:` Tailwind classes

  it("blocks Release on a blank card and says what to add", () => {
    const html = render({ status: "draft", setId: "s1" }, {});
    expect(html).toContain("Add a name and a type to release.");
    expect(releaseButton(html)).toMatch(DISABLED);
  });

  it("reads the live draft, not the last refresh", () => {
    // The server copy is blank but the editor already has both: no block.
    const html = render({ status: "draft", setId: "s1", snapshot: {} }, READY);
    expect(html).not.toContain("to release.");
    expect(releaseButton(html)).not.toMatch(DISABLED);
  });

  it("offers Restore on a shelved card", () => {
    expect(render({ status: "archived", setId: "s1" })).toContain(">Restore<");
  });

  it("does not block on missing art", () => {
    const html = render({ status: "draft", setId: "s1", hasArt: false }, READY);
    expect(releaseButton(html)).not.toMatch(DISABLED);
  });
});
