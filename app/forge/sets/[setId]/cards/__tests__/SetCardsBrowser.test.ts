import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ForgeCardFull } from "@/app/forge/lib/cards";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("@/app/forge/lib/lifecycle", () => ({ bulkLifecycle: vi.fn() }));
vi.mock("@/app/forge/lib/cards", () => ({ createCardInSet: vi.fn() }));

import SetCardsBrowser from "@/app/forge/sets/[setId]/cards/SetCardsBrowser";

const draft = (id: string): ForgeCardFull => ({
  id,
  title: "Invented Card",
  snapshot: { name: "Invented Card", cardType: ["Hero"] },
  hasArt: false,
  hasFinished: false,
  isPlaceholder: false,
  status: "draft",
  updatedAt: "2026-11-08T00:00:00Z",
  setId: "s1",
  publishedVersionId: null,
  approvedVersionId: null,
  ownerId: "u2",
  creatorId: "u2",
  createdAt: "2026-11-08T00:00:00Z",
});

const render = (canCreate: boolean) =>
  renderToStaticMarkup(React.createElement(SetCardsBrowser, { cards: [draft("a"), draft("b")], setId: "s1", canCreate }));

describe("SetCardsBrowser", () => {
  it("offers a designer Release all and Select", () => {
    const html = render(true);
    expect(html).toContain("Release all to playtest (2)");
    expect(html).toContain(">Select<");
  });

  it("doesn't make Release all the loudest thing on the page", () => {
    const button = render(true).match(/<button[^>]*>Release all to playtest \(2\)<\/button>/)?.[0] ?? "";
    expect(button).toContain("border");
    expect(button).not.toContain("bg-primary");
  });

  it("gives someone who can't design the set a reason, and no way to act on its cards", () => {
    const html = render(false);
    expect(html).toContain("only its designers can change it");
    expect(html).not.toContain("Release all");
    expect(html).not.toContain(">Select<");
  });
});
