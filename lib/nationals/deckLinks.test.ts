import { describe, it, expect } from "vitest";
import seed from "../../public/data/nationals-history.json";
import type { NationalsData } from "./types";
import { playerProfile } from "./selectors";

const data = seed as unknown as NationalsData;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// 2026 is the first year whose standings and decklists were published through
// the tracker, so its history rows carry links into the app.
describe("Nationals 2026 decklist links", () => {
  it("every deckId and resultsIds entry is a tracker/deck uuid", () => {
    for (const rows of Object.values(data.results)) {
      for (const r of rows) {
        if (r.deckId !== undefined) expect(r.deckId).toMatch(UUID);
      }
    }
    for (const t of data.tournaments) {
      for (const id of Object.values(t.resultsIds ?? {})) expect(id).toMatch(UUID);
    }
  });

  it("the 2026 T1 and T2 standings point at their results pages", () => {
    const t26 = data.tournaments.find((t) => t.year === 2026)!;
    expect(Object.keys(t26.resultsIds ?? {}).sort()).toEqual(["T1 2-Player", "T2 2-Player"]);
  });

  it("the 2026 T1 podium links to published decklists", () => {
    const rows = data.results["2026_T1 2-Player"];
    for (const place of [1, 2, 3]) {
      expect(rows.find((r) => r.placement === place)?.deckId).toMatch(UUID);
    }
  });

  it("deck links flow through to a player's career history", () => {
    const row = playerProfile(data, "Tim Estes").placements.find(
      (h) => h.year === 2026 && h.format === "T1 2-Player"
    );
    expect(row?.deckId).toMatch(UUID);
  });
});
