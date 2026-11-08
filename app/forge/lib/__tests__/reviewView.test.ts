import { describe, it, expect } from "vitest";
import { buildReviewQueue, keepHeldProposal, type ReviewCardRow, type ReviewOpenItem } from "../reviewView";

const card = (over: Partial<ReviewCardRow> = {}): ReviewCardRow => ({
  id: "c1", title: "Goliath", status: "draft", ...over,
});
const item = (over: Partial<ReviewOpenItem> = {}): ReviewOpenItem => ({
  cardId: "c1", kind: "proposal", createdAt: "2026-09-01T12:00:00Z", ...over,
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
