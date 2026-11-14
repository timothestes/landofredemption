import { describe, expect, it } from "vitest";
import { pageHostedEvents } from "../hostedEvents";

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
