import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";

vi.mock("next/link", () => ({ default: (p: { children: React.ReactNode }) => React.createElement("a", null, p.children) }));

const card: ForgeCardFull = {
  id: "c1",
  title: "Invented Card",
  snapshot: { name: "Invented Card", cardType: ["Hero"] },
  hasArt: true,
  hasFinished: false,
  isPlaceholder: true,
  status: "draft",
  updatedAt: "2026-11-08T00:00:00Z",
  setId: "s1",
  publishedVersionId: null,
  approvedVersionId: null,
  ownerId: "u1",
  creatorId: "u1",
  createdAt: "2026-11-08T00:00:00Z",
};

const render = (over: Partial<ForgeCardFull>) =>
  renderToStaticMarkup(React.createElement(ForgeCardGrid, { cards: [{ ...card, ...over }] }));

describe("ForgeCardGrid placeholder chip", () => {
  it("marks a tile whose art is a placeholder", () => {
    expect(render({})).toContain(">Placeholder<");
  });

  it("stays off final art, a card with no art, and a finished image", () => {
    expect(render({ isPlaceholder: false })).not.toContain(">Placeholder<");
    expect(render({ hasArt: false })).not.toContain(">Placeholder<");
    expect(render({ hasFinished: true })).not.toContain(">Placeholder<");
  });
});
