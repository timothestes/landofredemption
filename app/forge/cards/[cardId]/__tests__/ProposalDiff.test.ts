import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalRow } from "@/app/forge/lib/proposals";
import type { DesignCard } from "@/app/forge/lib/designCard";

// Server actions and the router are only reachable from the Accept/Deny handlers,
// which a static render never fires.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/forge/lib/proposals", () => ({ acceptProposal: vi.fn(), denyProposal: vi.fn() }));
vi.mock("@/app/forge/lib/comments", () => ({ addComment: vi.fn() }));

import ProposalDiff from "@/app/forge/cards/[cardId]/ProposalDiff";

const PROPOSED: DesignCard = {
  name: "Panic Demon",
  cardType: ["EvilCharacter"],
  brigades: ["Orange"],
  rawText: "If drafted, yell \"Panic Demon!\" and collect all other panic demons.",
};

const proposal = (baseVersionId: string | null): ProposalRow => ({
  id: "p1",
  cardId: "c1",
  baseVersionId,
  resultingVersionId: null,
  closedBy: null,
  summary: "Text obviously wont fit. But the idea is cool",
  status: "open",
  proposedSnapshot: PROPOSED,
  createdBy: "u1",
  createdAt: "2026-09-11T00:00:00Z",
  closedAt: null,
  proposerName: "Undude",
  approverName: null,
});

const render = (baseVersionId: string | null, current: DesignCard, over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(ProposalDiff, {
      proposal: proposal(baseVersionId),
      current,
      artUrl: "/forge/api/art?id=a1",
      finishedUrl: null,
      canReview: true,
      cardStatus: "draft",
      savedDraft: PROPOSED,
      ...over,
    })
  );

describe("ProposalDiff card preview", () => {
  // A first proposal has no base version, so `current` arrives as {}. Pairing that
  // against the proposal put an art tile captioned "Untitled" with no body text in
  // the "Current" slot, which reads as a card that got wiped rather than as one
  // that does not exist yet.
  it("shows a single face for a new card, with no empty Current slot", () => {
    const html = render(null, {});
    expect(html).toContain("New card \u2014 first proposal");
    expect(html).toContain(">Card preview<");
    expect(html).not.toContain(">Current<");
    expect(html).not.toContain("Untitled");
    expect(html).toContain("Panic Demon");
  });

  it("still pairs Current against Proposed once the card has a released version", () => {
    const html = render("v1", { name: "Panic Demon", rawText: "Old text." });
    expect(html).toContain(">Current<");
    expect(html).toContain(">Proposed<");
    expect(html).not.toContain(">Card preview<");
    expect(html).toContain("Old text.");
  });
});

describe("ProposalDiff byline", () => {
  it("says who proposed it, when, and against which version", () => {
    const html = render("v3", { name: "Panic Demon" }, { baseVersionNumber: 3 });
    expect(html).toContain("Undude · ");
    expect(html).toContain(" · against v3");
  });

  it("names no version on a first proposal", () => {
    expect(render(null, {})).not.toContain("against");
  });
});

describe("ProposalDiff when the draft has moved on", () => {
  const NOTE = "The draft has changed since this was proposed. Accepting drops those changes.";

  it("says so when the draft no longer matches the proposal", () => {
    expect(render("v1", {}, { savedDraft: { ...PROPOSED, rawText: "Edited since." } })).toContain(NOTE);
  });

  it("stays quiet while they match", () => {
    expect(render("v1", {})).not.toContain(NOTE);
  });
});

describe("ProposalDiff preview is the card", () => {
  it("draws the frame, so a stat change shows", () => {
    const html = render("v1", { ...PROPOSED, toughness: 1 });
    expect(html).toContain('aria-label="Card preview: Panic Demon"');
    expect(html).toContain("<svg");
  });

  it("explains that a finished image won't pick the change up", () => {
    const note = "Accepting doesn’t change it.";
    expect(render("v1", {}, { finishedUrl: "/forge/api/art/c1?kind=finished" })).toContain(note);
    expect(render("v1", {})).not.toContain(note);
  });
});
