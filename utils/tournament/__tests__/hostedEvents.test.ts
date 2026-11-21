import { describe, expect, it } from "vitest";
import { hostedStatus, pageHostedEvents } from "../hostedEvents";

const single = (id: string) => ({ id, listing_id: null });
const cat = (id: string, listing: string) => ({ id, listing_id: listing });
const ids = (blocks: ReturnType<typeof pageHostedEvents>["blocks"]) =>
  blocks.map((b) =>
    b.kind === "event"
      ? `event:${b.tournaments.map((t) => t.id).join(",")}`
      : `singles:${b.tournaments.map((t) => t.id).join(",")}`
  );

describe("pageHostedEvents", () => {
  it("returns one empty page for no tournaments", () => {
    expect(pageHostedEvents([], 1)).toEqual({ page: 1, pageCount: 1, blocks: [] });
  });

  it("places an event at its newest category and merges runs of singles", () => {
    const list = [single("a"), cat("x1", "L"), single("b"), single("c"), cat("x2", "L"), single("d")];
    const { pageCount, blocks } = pageHostedEvents(list, 1);
    expect(pageCount).toBe(1);
    expect(ids(blocks)).toEqual(["singles:a", "event:x1,x2", "singles:b,c,d"]);
  });

  it("counts an event as one item and never splits it across pages", () => {
    // 3 singles, a 4-category event, 2 singles = 6 events, 9 tournaments.
    const list = [
      single("s1"), single("s2"), single("s3"),
      cat("e1", "L"), cat("e2", "L"), cat("e3", "L"), cat("e4", "L"),
      single("s4"), single("s5"),
    ];
    const p1 = pageHostedEvents(list, 1, 4);
    expect(p1.pageCount).toBe(2);
    expect(ids(p1.blocks)).toEqual(["singles:s1,s2,s3", "event:e1,e2,e3,e4"]);
    const p2 = pageHostedEvents(list, 2, 4);
    expect(ids(p2.blocks)).toEqual(["singles:s4,s5"]);
  });

  it("pages 69 standalone tournaments into 4 pages of 20", () => {
    const list = Array.from({ length: 69 }, (_, i) => single(`t${i}`));
    const p4 = pageHostedEvents(list, 4);
    expect(p4.pageCount).toBe(4);
    expect(p4.blocks[0].tournaments.map((t) => t.id)).toEqual(
      Array.from({ length: 9 }, (_, i) => `t${60 + i}`)
    );
  });

  it("clamps out-of-range and garbage page numbers", () => {
    const list = Array.from({ length: 25 }, (_, i) => single(`t${i}`));
    expect(pageHostedEvents(list, 0).page).toBe(1);
    expect(pageHostedEvents(list, NaN).page).toBe(1);
    expect(pageHostedEvents(list, -3).page).toBe(1);
    expect(pageHostedEvents(list, 99).page).toBe(2);
  });
});

describe("hostedStatus", () => {
  it("says Not started for a new tournament, whose flags may be null", () => {
    expect(hostedStatus({})).toEqual({ kind: "not_started", label: "Not started" });
    expect(hostedStatus({ has_started: false, has_ended: false, current_round: null, n_rounds: null }))
      .toEqual({ kind: "not_started", label: "Not started" });
  });

  it("names the round while the event is running", () => {
    expect(hostedStatus({ has_started: true, has_ended: false, current_round: 2, n_rounds: 4 }))
      .toEqual({ kind: "in_progress", label: "Round 2 of 4" });
  });

  it("matches the host page when the round numbers are missing", () => {
    expect(hostedStatus({ has_started: true, current_round: null, n_rounds: null }).label).toBe("Round 1 of ?");
  });

  it("keeps an ended event that is not published apart from a published one", () => {
    expect(hostedStatus({ has_started: true, has_ended: true, current_round: 4, n_rounds: 4, results_published: false }))
      .toEqual({ kind: "ended", label: "Ended, not published" });
    expect(hostedStatus({ has_started: true, has_ended: true, current_round: 4, n_rounds: 4, results_published: true }))
      .toEqual({ kind: "published", label: "Published" });
  });

  it("does not call an event published on its decklists alone", () => {
    // The host page reads a half-published event as unpublished too.
    const row = { has_ended: true, results_published: false, decklists_published: true };
    expect(hostedStatus(row).kind).toBe("ended");
  });
});
