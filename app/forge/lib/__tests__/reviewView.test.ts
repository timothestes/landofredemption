import { describe, it, expect } from "vitest";
import {
  buildReviewQueue, keepHeldProposal, reviewByline, reviewRowHref, reviewJumpLinks,
  proposalReviewItem, suggestionReviewItem, type ReviewCardRow, type ReviewOpenItem,
} from "../reviewView";

const card = (over: Partial<ReviewCardRow> = {}): ReviewCardRow => ({
  id: "c1", title: "Goliath", status: "draft", ...over,
});
const item = (over: Partial<ReviewOpenItem> = {}): ReviewOpenItem => ({
  id: "i1", cardId: "c1", kind: "proposal", createdAt: "2026-09-01T12:00:00Z",
  who: "Rhoda", summary: null, changed: null, baseVersion: null, ...over,
});

describe("buildReviewQueue", () => {
  it("counts open items per card and sorts busiest first", () => {
    const rows = buildReviewQueue(
      [card({ id: "c1", title: "Goliath" }), card({ id: "c2", title: "Fortress" })],
      [
        item({ cardId: "c1" }),
        item({ cardId: "c2" }),
        item({ cardId: "c2", kind: "suggestion" }),
      ]
    );
    expect(rows.map((r) => r.cardId)).toEqual(["c2", "c1"]);
    expect(rows[0]).toMatchObject({ openProposals: 1, openSuggestions: 1 });
    expect(rows[1]).toMatchObject({ openProposals: 1, openSuggestions: 0 });
  });

  it("drops cards with nothing open", () => {
    const rows = buildReviewQueue([card({ id: "c1" }), card({ id: "c2" })], [item({ cardId: "c1" })]);
    expect(rows.map((r) => r.cardId)).toEqual(["c1"]);
  });

  it("reports latestAt as the newest open item on the card", () => {
    const rows = buildReviewQueue(
      [card()],
      [item({ createdAt: "2026-09-01T12:00:00Z" }), item({ createdAt: "2026-09-08T12:00:00Z" })]
    );
    expect(rows[0].latestAt).toBe("2026-09-08T12:00:00Z");
  });

  it("since drops older items and recounts the pills", () => {
    const rows = buildReviewQueue(
      [card()],
      [
        item({ createdAt: "2026-09-01T12:00:00Z" }),
        item({ createdAt: "2026-09-08T12:00:00Z" }),
        item({ kind: "suggestion", createdAt: "2026-09-02T12:00:00Z" }),
      ],
      { since: "2026-09-05" }
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ openProposals: 1, openSuggestions: 0 });
  });

  it("since drops a card whose every open item is older", () => {
    const rows = buildReviewQueue([card()], [item({ createdAt: "2026-09-01T12:00:00Z" })], {
      since: "2026-09-05",
    });
    expect(rows).toEqual([]);
  });

  it("since cuts at LOCAL midnight, so same-day items survive", () => {
    const noon = new Date(2026, 8, 5, 12, 0, 0).toISOString(); // local noon, Sept 5
    const rows = buildReviewQueue([card()], [item({ createdAt: noon })], { since: "2026-09-05" });
    expect(rows).toHaveLength(1);
  });

  it("kind keeps only cards holding that kind, and zeroes the other pill", () => {
    const rows = buildReviewQueue(
      [card({ id: "c1" }), card({ id: "c2", title: "Fortress" })],
      [
        item({ cardId: "c1", kind: "proposal" }),
        item({ cardId: "c1", kind: "suggestion" }),
        item({ cardId: "c2", kind: "suggestion" }),
      ],
      { kind: "proposals" }
    );
    expect(rows.map((r) => r.cardId)).toEqual(["c1"]);
    expect(rows[0]).toMatchObject({ openProposals: 1, openSuggestions: 0 });
  });

  it("newCount counts open items added since the viewer's last visit", () => {
    const rows = buildReviewQueue(
      [card()],
      [item({ createdAt: "2026-09-01T12:00:00Z" }), item({ createdAt: "2026-09-08T12:00:00Z" })],
      { newSince: Date.parse("2026-09-05T00:00:00Z") }
    );
    expect(rows[0].newCount).toBe(1);
  });

  it("newCount is 0 on a first visit (no stored last visit)", () => {
    const rows = buildReviewQueue([card()], [item()]);
    expect(rows[0].newCount).toBe(0);
  });

  it("ignores open items pointing at a card outside the set", () => {
    const rows = buildReviewQueue([card({ id: "c1" })], [item({ cardId: "ghost" })]);
    expect(rows).toEqual([]);
  });
});

describe("keepHeldProposal", () => {
  const diff = (id: string) => ({ proposal: { id } });

  it("lists the open proposals when nothing is held", () => {
    const open = [diff("p1"), diff("p2")];
    expect(keepHeldProposal(open, null)).toBe(open);
  });

  it("does not list a held proposal twice while it is still open", () => {
    const open = [diff("p1"), diff("p2")];
    expect(keepHeldProposal(open, diff("p2"))).toBe(open);
  });

  // The stale accept: the server closes the proposal, the realtime ping refreshes the page,
  // and the row has to outlive that for its dialog to stay up.
  it("keeps a held proposal the refresh dropped", () => {
    const held = diff("p1");
    expect(keepHeldProposal([], held)).toEqual([held]);
    expect(keepHeldProposal([diff("p2")], held).map((d) => d.proposal.id)).toEqual(["p2", "p1"]);
  });
});

describe("reviewByline", () => {
  const now = Date.parse("2026-09-01T12:00:00Z");

  it("says who, when and against which version", () => {
    expect(reviewByline({ who: "Rhoda", at: "2026-09-01T10:00:00Z", baseVersion: 3 }, now)).toBe("Rhoda · 2h ago · against v3");
  });

  it("names no version for a first proposal", () => {
    expect(reviewByline({ who: "Rhoda", at: "2026-09-01T10:00:00Z", baseVersion: null }, now)).toBe("Rhoda · 2h ago");
  });

  it("falls back when the name can't be read", () => {
    expect(reviewByline({ who: null, at: "2026-09-01T10:00:00Z", baseVersion: 1 }, now)).toBe("Forge member · 2h ago · against v1");
  });
});

describe("buildReviewQueue row contents", () => {
  it("lists the surviving items, proposals first, newest first within each", () => {
    const [row] = buildReviewQueue([card()], [
      item({ id: "s1", kind: "suggestion", createdAt: "2026-09-09T12:00:00Z" }),
      item({ id: "p1", createdAt: "2026-09-01T12:00:00Z" }),
      item({ id: "p2", createdAt: "2026-09-05T12:00:00Z" }),
      item({ id: "s2", kind: "suggestion", createdAt: "2026-09-10T12:00:00Z" }),
    ]);
    expect(row.items.map((i) => i.id)).toEqual(["p2", "p1", "s2", "s1"]);
  });

  it("drops what the filters drop, so the row matches its pills", () => {
    const [row] = buildReviewQueue([card()], [
      item({ id: "p1" }),
      item({ id: "s1", kind: "suggestion" }),
    ], { kind: "suggestions" });
    expect(row.items.map((i) => i.id)).toEqual(["s1"]);
    expect(row.openProposals).toBe(0);
  });
});

describe("reviewRowHref", () => {
  it("lands on the proposals when the row shows any", () => {
    expect(reviewRowHref("c1", 1)).toBe("/forge/cards/c1#proposals");
  });

  it("lands on the comments for a row of suggestions only", () => {
    expect(reviewRowHref("c1", 0)).toBe("/forge/cards/c1#comments");
  });
});

describe("reviewJumpLinks", () => {
  it("counts what is waiting and points at each section", () => {
    expect(reviewJumpLinks(1, 2)).toEqual([
      { href: "#proposals", label: "1 open proposal" },
      { href: "#comments", label: "2 unresolved comments" },
    ]);
    expect(reviewJumpLinks(3, 1).map((l) => l.label)).toEqual(["3 open proposals", "1 unresolved comment"]);
  });

  // Always both links, so a comment arriving mid-edit can't push the form under the caret.
  it("still links when nothing is waiting", () => {
    expect(reviewJumpLinks(0, 0)).toEqual([
      { href: "#proposals", label: "No open proposals" },
      { href: "#comments", label: "No unresolved comments" },
    ]);
  });
});

describe("proposalReviewItem", () => {
  const row = { id: "p1", cardId: "c1", createdAt: "2026-09-01T12:00:00Z", who: "Rhoda", summary: "Draw more", baseVersionId: "v3" };

  it("says what changed against the version it was proposed from", () => {
    const i = proposalReviewItem({
      ...row,
      base: { versionNumber: 3, data: { rawText: "Draw 2.", toughness: 1 } },
      proposed: { rawText: "Draw 3.", toughness: 2 },
    });
    expect(i).toMatchObject({ kind: "proposal", who: "Rhoda", summary: "Draw more", baseVersion: 3, changed: "Changed Card text, Toughness." });
  });

  it("calls a first proposal a new card", () => {
    const i = proposalReviewItem({ ...row, baseVersionId: null, base: null, proposed: { name: "Invented" } });
    expect(i).toMatchObject({ baseVersion: null, changed: "New card \u2014 first proposal" });
  });

  it("claims nothing when the base version can't be read", () => {
    const i = proposalReviewItem({ ...row, base: null, proposed: { name: "Invented" } });
    expect(i).toMatchObject({ baseVersion: null, changed: null });
  });
});

describe("suggestionReviewItem", () => {
  const row = { id: "m1", cardId: "c1", createdAt: "2026-09-01T12:00:00Z", who: "Tyler" };

  it("names the field and the value", () => {
    expect(suggestionReviewItem({ ...row, field: "toughness", suggestedValue: 2 })).toMatchObject({
      kind: "suggestion", who: "Tyler", summary: null, baseVersion: null, changed: "Suggested Toughness: 2",
    });
  });

  it("joins a list value", () => {
    expect(suggestionReviewItem({ ...row, field: "brigades", suggestedValue: ["Blue", "Red"] }).changed).toBe("Suggested Brigade: Blue, Red");
  });
});
