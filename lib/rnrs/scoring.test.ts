import { describe, it, expect } from "vitest";
import {
  countLevel,
  buildLeaderboard,
  buildPlayerProfile,
  placeLabel,
  getState,
  getRegion,
} from "./scoring";
import { parseSheetCsv } from "./parse";
import type { Level, NormalizedData, PlayerFormatResult } from "./types";

/** Helper to build a PlayerFormatResult from a partial win map. */
function player(
  name: string,
  wins: Partial<Record<Level, number[]>>,
  sheetTotal: number,
): PlayerFormatResult {
  return {
    name,
    wins: {
      local: wins.local ?? [],
      district: wins.district ?? [],
      seasonal: wins.seasonal ?? [],
      state: wins.state ?? [],
      regional: wins.regional ?? [],
      national: wins.national ?? [],
    },
    sheetTotal,
  };
}

/** Tim Estes's real 2026 results (fetched live from the worker). These are the
 *  fixtures that pinned down the cap math. */
const data: NormalizedData = {
  "2026": {
    type1: [player("Tim Estes (CA)", { local: [1, 2, 2, 2], district: [10, 10, 10], state: [25] }, 52)],
    teams: [],
    type2: [player("Tim Estes (CA)", { state: [25] }, 25)],
    closed: [player("Tim Estes (CA)", { district: [10, 10, 5] }, 20)],
    draft: [player("Tim Estes (CA)", { local: [2, 2, 1, 2], district: [5, 5, 5], state: [12] }, 29)],
  },
};

describe("countLevel — per-format caps", () => {
  it("caps district at the best 2 wins", () => {
    const c = countLevel([10, 10, 10], "district");
    expect(c.raw).toBe(30);
    expect(c.counted).toBe(20);
    expect(c.capped).toBe(true);
  });

  it("does not cap local when under 5 wins", () => {
    const c = countLevel([1, 2, 2, 2], "local");
    expect(c.raw).toBe(7);
    expect(c.counted).toBe(7);
    expect(c.capped).toBe(false);
  });

  it("keeps the highest wins when capping (sorts desc)", () => {
    const c = countLevel([10, 10, 5], "district");
    expect(c.counted).toBe(20); // top 2 of {10,10,5}
  });
});

describe("buildLeaderboard — single format totals match the sheet", () => {
  const cases: [keyof NonNullable<NormalizedData["2026"]>, number][] = [
    ["type1", 52],
    ["type2", 25],
    ["closed", 20],
    ["draft", 29],
  ];
  for (const [format, expected] of cases) {
    it(`${format} → ${expected}`, () => {
      const rows = buildLeaderboard(data, "2026", format as any);
      const tim = rows.find((r) => r.name === "Tim Estes (CA)")!;
      expect(tim.total).toBe(expected);
      expect(tim.total).toBe(tim.sheetTotal); // checksum vs sheet
    });
  }

  it("type1: district shows counted 20 / raw 30 / capped", () => {
    const rows = buildLeaderboard(data, "2026", "type1");
    const tim = rows.find((r) => r.name === "Tim Estes (CA)")!;
    expect(tim.levels.district.counted).toBe(20);
    expect(tim.levels.district.raw).toBe(30);
    expect(tim.levels.district.capped).toBe(true);
    expect(tim.levels.local.counted).toBe(7);
    expect(tim.levels.local.capped).toBe(false);
    expect(tim.levels.state.counted).toBe(25);
  });
});

describe("buildLeaderboard — aggregate (All Formats) sums per-format caps", () => {
  it("2026 all formats: district 50, total 126, checksum holds", () => {
    const rows = buildLeaderboard(data, "2026", "all");
    const tim = rows.find((r) => r.name === "Tim Estes (CA)")!;
    // district counted: 20 (t1) + 20 (closed) + 10 (draft) = 50; raw 30+25+15=70
    expect(tim.levels.district.counted).toBe(50);
    expect(tim.levels.district.raw).toBe(70);
    // local 7+7=14, state 25+25+12=62
    expect(tim.levels.local.counted).toBe(14);
    expect(tim.levels.state.counted).toBe(62);
    // total = 14 + 50 + 62 = 126; equals sum of sheet totals (52+25+20+29)
    expect(tim.total).toBe(126);
    expect(tim.sheetTotal).toBe(126);
  });
});

describe("placement labels & geography", () => {
  it("maps point values to placements", () => {
    expect(placeLabel(5, "seasonal")).toBe("1st");
    expect(placeLabel(3, "seasonal")).toBe("2nd");
    expect(placeLabel(1, "seasonal")).toBe("3rd");
    expect(placeLabel(10, "district")).toBe("1st");
    expect(placeLabel(5, "district")).toBe("2nd");
    expect(placeLabel(25, "state")).toBe("1st");
    expect(placeLabel(45, "national")).toBe("1st");
  });
  it("derives state and region from the name tag", () => {
    expect(getState("Tim Estes (CA)")).toBe("CA");
    expect(getRegion("Tim Estes (CA)")).toBe("Southwestern");
  });
});

describe("buildPlayerProfile", () => {
  it("aggregates Tim across 2026 formats with counted totals", () => {
    const profile = buildPlayerProfile(data, "Tim Estes (CA)")!;
    expect(profile).not.toBeNull();
    expect(profile.totalPts).toBe(126);
    expect(profile.seasonCount).toBe(1);
    expect(profile.formatCount).toBe(4); // type1, type2, closed, draft (teams empty)
  });
  it("returns null for unknown players", () => {
    expect(buildPlayerProfile(data, "Nobody Here")).toBeNull();
  });
});

describe("parseSheetCsv", () => {
  const csv = [
    "Some preamble that should be ignored",
    "Player,Local,District,State,Regional,National,Total Score,",
    'Tim Estes (CA),"1,2,2,2","10,10,10",25,-,-,52,',
    "-,-,-,-,-,-,-,",
  ].join("\n");

  it("parses win lists, total, and skips junk rows", () => {
    const rows = parseSheetCsv(csv);
    expect(rows).toHaveLength(1);
    const tim = rows[0];
    expect(tim.name).toBe("Tim Estes (CA)");
    expect(tim.wins.local).toEqual([1, 2, 2, 2]);
    expect(tim.wins.district).toEqual([10, 10, 10]);
    expect(tim.wins.state).toEqual([25]);
    expect(tim.wins.regional).toEqual([]);
    expect(tim.sheetTotal).toBe(52);
  });
});
