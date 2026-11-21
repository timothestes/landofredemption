import { describe, it, expect } from "vitest";
import { parseTournamentName, sharedEventParts, shortTournamentName } from "../displayName";
import { buildTournamentName } from "../naming";

const EXAMPLE = "Nov 7, 2026 Seasonal Sealed Deck - 2 Player Tournament — Rochester, NY";

describe("parseTournamentName", () => {
  it("splits a generated name into date, title and location", () => {
    expect(parseTournamentName(EXAMPLE)).toEqual({
      date: "Nov 7, 2026",
      title: "Seasonal Sealed Deck 2P",
      location: "Rochester, NY",
    });
  });

  it("reads back whatever buildTournamentName writes", () => {
    const name = buildTournamentName("Type 1 Limited", {
      date: new Date(2026, 7, 2),
      tier: "Regional",
      city: "Wichita",
      state: "KS",
    });
    expect(parseTournamentName(name)).toEqual({
      date: "Aug 2, 2026",
      title: "Regional Type 1 Limited",
      location: "Wichita, KS",
    });
  });

  it("has no location when the name has none", () => {
    expect(parseTournamentName("Aug 2, 2026 Type 2 Tournament")).toEqual({
      date: "Aug 2, 2026",
      title: "Type 2",
      location: null,
    });
  });

  it("keeps a location that is only a city", () => {
    expect(parseTournamentName("Aug 2, 2026 Type 1 Limited Tournament — Wichita").location).toBe("Wichita");
  });

  it("keeps a multi-word tier in the title", () => {
    expect(parseTournamentName("Jul 18, 2026 South Central Regional Booster Draft Tournament — Tulsa, OK")).toEqual({
      date: "Jul 18, 2026",
      title: "South Central Regional Booster Draft",
      location: "Tulsa, OK",
    });
  });

  it("shortens every spelling of 2 Player", () => {
    const title = (category: string) => parseTournamentName(`Aug 2, 2026 ${category} Tournament`).title;
    expect(title("Type 2 - 2 Player")).toBe("Type 2 2P");
    expect(title("Type 2 2 Player")).toBe("Type 2 2P");
    expect(title("Type A 2-Player")).toBe("Type A 2P");
    expect(title("T2 - 2P")).toBe("T2 2P");
    expect(title("Type 1 - 2 Player - Unlimited")).toBe("Type 1 2P Unlimited");
    // Not a player count:
    expect(title("Type 2 Paragon")).toBe("Type 2 Paragon");
    expect(title("Type 1 - Teams")).toBe("Type 1 - Teams");
  });

  it("keeps the word Tournament when Unofficial would stand alone", () => {
    expect(parseTournamentName("Nov 7, 2026 Unofficial Tournament — Lowell, AR")).toEqual({
      date: "Nov 7, 2026",
      title: "Unofficial Tournament",
      location: "Lowell, AR",
    });
  });

  it("returns a free-form name unchanged", () => {
    for (const name of [
      "Jayden's Tournament",
      "CA District 11/8/25 Type 1",
      "Lackey Grand Prix Series 24",
      "Tournament 4",
      "02/05/2026",
      // A date and nothing else that fits:
      "Nov 7, 2026 Friday Night Redemption",
      "Nov 7, 2026 Tournament",
    ]) {
      expect(parseTournamentName(name)).toEqual({ date: null, title: name, location: null });
    }
  });

  it("returns an empty string as an empty title", () => {
    expect(parseTournamentName("")).toEqual({ date: null, title: "", location: null });
  });
});

describe("shortTournamentName", () => {
  it("is the title and the date, without the location", () => {
    expect(shortTournamentName(EXAMPLE)).toBe("Seasonal Sealed Deck 2P · Nov 7, 2026");
  });

  it("drops the year on request", () => {
    expect(shortTournamentName(EXAMPLE, { year: false })).toBe("Seasonal Sealed Deck 2P · Nov 7");
  });

  it("is the name itself when it does not parse", () => {
    expect(shortTournamentName("Jayden's Tournament", { year: false })).toBe("Jayden's Tournament");
    expect(shortTournamentName("")).toBe("");
  });
});

describe("sharedEventParts", () => {
  const ROCHESTER = { date: "Nov 7, 2026", location: "Rochester, NY" };
  const NOTHING = { date: null, location: null };

  it("is the date and location the categories share", () => {
    expect(
      sharedEventParts([EXAMPLE, "Nov 7, 2026 Seasonal Type 1 - 2 Player Tournament — Rochester, NY"]),
    ).toEqual(ROCHESTER);
  });

  it("leaves out a date the categories disagree on", () => {
    expect(
      sharedEventParts(["Nov 8, 2026 Seasonal Booster Draft Tournament — Rochester, NY", EXAMPLE]),
    ).toEqual({ date: null, location: "Rochester, NY" });
  });

  it("skips a free-form name among generated ones", () => {
    expect(sharedEventParts(["Finals table", EXAMPLE])).toEqual(ROCHESTER);
  });

  it("is empty when no name parses or nothing is shared", () => {
    expect(sharedEventParts(["State Sealed", "State Teams"])).toEqual(NOTHING);
    expect(sharedEventParts([])).toEqual(NOTHING);
    expect(
      sharedEventParts(["Nov 7, 2026 Type 2 Tournament — Tulsa, OK", "Nov 8, 2026 Type 2 Tournament — Wichita, KS"]),
    ).toEqual(NOTHING);
  });
});
