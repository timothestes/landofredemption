import { describe, expect, it } from "vitest";
import { fetchAllRows } from "../fetchAllRows";

/** A fake table: returns the requested slice and records each range asked for. */
function table(total: number) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  const ranges: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    ranges.push([from, to]);
    return { data: all.slice(from, to + 1) };
  };
  return { fetchPage, ranges };
}

describe("fetchAllRows", () => {
  it("stops after one short page", async () => {
    const t = table(3);
    const rows = await fetchAllRows(t.fetchPage, 5);
    expect(rows.map((r) => r.id)).toEqual([0, 1, 2]);
    expect(t.ranges).toEqual([[0, 4]]);
  });

  it("keeps paging while pages come back full", async () => {
    const t = table(7);
    const rows = await fetchAllRows(t.fetchPage, 3);
    expect(rows).toHaveLength(7);
    expect(t.ranges).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });

  it("needs one extra empty page when the total is an exact multiple", async () => {
    const t = table(6);
    const rows = await fetchAllRows(t.fetchPage, 3);
    expect(rows).toHaveLength(6);
    expect(t.ranges).toEqual([
      [0, 2],
      [3, 5],
      [6, 8],
    ]);
  });

  it("returns nothing when the first page has null data (e.g. an RLS-denied read)", async () => {
    const rows = await fetchAllRows(async () => ({ data: null }));
    expect(rows).toEqual([]);
  });
});
