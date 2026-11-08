import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ForgeCardFull } from "@/app/forge/lib/cards";
import ForgeCardGrid from "@/app/forge/components/ForgeCardGrid";

vi.mock("next/link", () => ({ useLinkStatus: () => ({ pending: false }), default: (p: { children: React.ReactNode }) => React.createElement("a", null, p.children) }));

const card: ForgeCardFull = {
  id: "c1",
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
  ownerId: "u1",
  creatorId: "u1",
  createdAt: "2026-11-08T00:00:00Z",
};

const render = (count: number) =>
  renderToStaticMarkup(React.createElement(ForgeCardGrid, { cards: [card], proposalCounts: { c1: count } }));

describe("ForgeCardGrid proposal badge", () => {
  it("is solid and the same in every theme, because it sits on the card face", () => {
    const html = render(1);
    expect(html).toContain("bg-amber-400");
    expect(html).toContain("text-amber-950");
    expect(html).not.toContain("bg-amber-500/15");
    expect(html).not.toContain("dark:text-amber");
  });

  it("says what the number is to a screen reader", () => {
    expect(render(1)).toContain("> open proposal<");
    expect(render(2)).toContain(">2<");
    expect(render(2)).toContain("open proposals");
  });

  it("isn't there when nothing is open", () => {
    expect(render(0)).not.toContain("open proposal");
  });
});
