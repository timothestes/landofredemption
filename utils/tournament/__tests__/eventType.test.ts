import { describe, expect, it } from "vitest";
import { eventDateInputValue, planEventTypeChange, renameForEventType } from "../eventType";
import { normalizeTier, TOURNAMENT_TIERS } from "../tiers";
import { formatLocation } from "../naming";
import { normalizeState } from "../usStates";

// A Type 1 Unlimited event sitting entirely at its category defaults
// (Unlimited / 5 souls / 45 min / decklists required), with no tier.
const UNLIMITED = {
  name: "Jul 28, 2026 Type 1 Unlimited Tournament",
  tier: null,
  category: "Type 1 Unlimited",
  deck_format: "Unlimited",
  city: null,
  state: null,
  max_score: 5,
  round_length: 45,
  require_decklists: true,
  created_at: "2026-07-29T01:15:57.307Z",
};

const UNLOCKED = { maxScoreLocked: false };

describe("normalizeTier", () => {
  it("collapses named regionals and nationals onto their base tier", () => {
    expect(normalizeTier("South Central Regional")).toBe("Regional");
    expect(normalizeTier("Midwest Regional")).toBe("Regional");
    expect(normalizeTier("Redemption National Tournament")).toBe("National");
    expect(normalizeTier("Redemption National")).toBe("National");
  });

  it("maps the levels the 2026 guide retired onto Seasonal", () => {
    expect(normalizeTier("Local (Open)")).toBe("Seasonal");
    expect(normalizeTier("Local (Closed)")).toBe("Seasonal");
    expect(normalizeTier("local")).toBe("Seasonal");
    expect(normalizeTier("District")).toBe("Seasonal");
  });

  it("passes through the plain tiers", () => {
    expect(normalizeTier("State")).toBe("State");
    expect(normalizeTier("Seasonal")).toBe("Seasonal");
  });

  it("returns null rather than guessing on unknown or empty input", () => {
    expect(normalizeTier("Casual Meetup")).toBeNull();
    expect(normalizeTier("")).toBeNull();
    expect(normalizeTier(null)).toBeNull();
  });

  it("round-trips every canonical tier", () => {
    for (const tier of TOURNAMENT_TIERS) expect(normalizeTier(tier)).toBe(tier);
  });
});

describe("renameForEventType", () => {
  it("swaps the category token and keeps the date verbatim", () => {
    expect(
      renameForEventType(UNLIMITED.name, { tier: null, category: "Type 2", city: null, state: null }, UNLIMITED.created_at)
    ).toBe("Jul 28, 2026 Type 2 Tournament");
  });

  it("inserts the tier between date and category", () => {
    expect(
      renameForEventType(
        UNLIMITED.name,
        { tier: "Regional", category: "Type 2", city: null, state: null },
        UNLIMITED.created_at
      )
    ).toBe("Jul 28, 2026 Regional Type 2 Tournament");
  });

  it("drops the tier again when it is cleared", () => {
    expect(
      renameForEventType(
        "Jul 28, 2026 Regional Type 2 Tournament",
        { tier: null, category: "Type 2", city: null, state: null },
        UNLIMITED.created_at
      )
    ).toBe("Jul 28, 2026 Type 2 Tournament");
  });

  it("replaces an existing tier rather than stacking one", () => {
    expect(
      renameForEventType(
        "Jul 28, 2026 Regional Type 2 Tournament",
        { tier: "National", category: "Type 2", city: null, state: null },
        UNLIMITED.created_at
      )
    ).toBe("Jul 28, 2026 National Type 2 Tournament");
  });

  it("builds the location suffix from the columns, not the old name", () => {
    expect(
      renameForEventType(
        "Jul 28, 2026 Type 1 Unlimited Tournament — Dallas",
        { tier: "State", category: "Type 2", city: "Wichita", state: "KS" },
        UNLIMITED.created_at
      )
    ).toBe("Jul 28, 2026 State Type 2 Tournament — Wichita, KS");
  });

  it("drops a stale suffix when the location is cleared", () => {
    expect(
      renameForEventType(
        "Jul 28, 2026 Type 2 Tournament — Dallas, TX",
        { tier: null, category: "Type 2", city: null, state: null },
        UNLIMITED.created_at
      )
    ).toBe("Jul 28, 2026 Type 2 Tournament");
  });

  it("takes whichever half of the location is set", () => {
    const at = UNLIMITED.created_at;
    expect(
      renameForEventType(UNLIMITED.name, { tier: null, category: "Type 2", city: "Wichita", state: null }, at)
    ).toBe("Jul 28, 2026 Type 2 Tournament — Wichita");
    expect(
      renameForEventType(UNLIMITED.name, { tier: null, category: "Type 2", city: null, state: "KS" }, at)
    ).toBe("Jul 28, 2026 Type 2 Tournament — KS");
  });

  it("does not reformat the date from created_at (UTC would shift it a day)", () => {
    // created_at is Jul 29 in UTC; the stored name says Jul 28 because it was
    // generated in the host's timezone. The rename must not "correct" it.
    expect(
      renameForEventType(UNLIMITED.name, { tier: null, category: "Type 2", city: null, state: null }, UNLIMITED.created_at)
    ).toContain("Jul 28, 2026");
  });

  it("rebuilds from created_at when the name is free-form", () => {
    const out = renameForEventType(
      "Friday Night Redemption",
      { tier: "Seasonal", category: "Type 2", city: null, state: null },
      UNLIMITED.created_at
    );
    expect(out).toMatch(/^\w{3} \d{1,2}, \d{4} Seasonal Type 2 Tournament$/);
  });

  it("applies the location when falling back on a free-form name", () => {
    expect(
      renameForEventType(
        "Game Night",
        { tier: null, category: "Type 2", city: "Wichita", state: "KS" },
        UNLIMITED.created_at
      )
    ).toMatch(/ Type 2 Tournament — Wichita, KS$/);
  });

  it("writes the day the host picked over the one in the name", () => {
    expect(
      renameForEventType(
        "Jul 28, 2026 Regional Type 2 Tournament — Wichita, KS",
        { tier: "Regional", category: "Type 2", city: "Wichita", state: "KS", date: new Date(2026, 7, 1, 12) },
        UNLIMITED.created_at
      )
    ).toBe("Aug 1, 2026 Regional Type 2 Tournament — Wichita, KS");
  });

  it("uses the picked day instead of created_at for a free-form name", () => {
    expect(
      renameForEventType(
        "Friday Night Redemption",
        { tier: null, category: "Type 2", city: null, state: null, date: new Date(2026, 7, 1, 12) },
        UNLIMITED.created_at
      )
    ).toBe("Aug 1, 2026 Type 2 Tournament");
  });
});

describe("eventDateInputValue", () => {
  it("reads the day out of a generated name, not out of created_at", () => {
    // created_at is Jul 29 in UTC; the name, written in the host's timezone, says Jul 28.
    expect(eventDateInputValue(UNLIMITED.name, UNLIMITED.created_at)).toBe("2026-07-28");
  });

  it("falls back to the local day of created_at for a free-form name", () => {
    expect(eventDateInputValue("Friday Night Redemption", new Date(2026, 7, 1, 12).toISOString())).toBe("2026-08-01");
  });
});

describe("formatLocation", () => {
  it("joins city and state, or takes whichever half exists", () => {
    expect(formatLocation("Wichita", "KS")).toBe("Wichita, KS");
    expect(formatLocation("Wichita", null)).toBe("Wichita");
    expect(formatLocation(null, "KS")).toBe("KS");
    expect(formatLocation(null, null)).toBe("");
    expect(formatLocation("  ", "  ")).toBe("");
  });
});

describe("normalizeState", () => {
  it("canonicalizes codes and full names, rejects the rest", () => {
    expect(normalizeState("tx")).toBe("TX");
    expect(normalizeState(" KS ")).toBe("KS");
    expect(normalizeState("Texas")).toBe("TX");
    expect(normalizeState("Ontario")).toBeNull();
    expect(normalizeState("")).toBeNull();
    expect(normalizeState(null)).toBeNull();
  });
});

describe("planEventTypeChange", () => {
  it("re-seeds every derived field the host left alone", () => {
    const plan = planEventTypeChange(UNLIMITED, { tier: null, category: "Type 2", city: null, state: null }, UNLOCKED);
    expect(plan).toEqual({
      tier: null,
      category: "Type 2",
      city: null,
      state: null,
      deck_format: "T2",
      name: "Jul 28, 2026 Type 2 Tournament",
      max_score: 7,
      round_length: 75,
    });
    // Type 2 also defaults decklists on, so the flag doesn't change.
    expect(plan.require_decklists).toBeUndefined();
  });

  it("renames on a tier-only change and touches nothing else", () => {
    const plan = planEventTypeChange(
      UNLIMITED,
      { tier: "Regional", category: "Type 1 Unlimited", city: null, state: null },
      UNLOCKED
    );
    expect(plan.name).toBe("Jul 28, 2026 Regional Type 1 Unlimited Tournament");
    expect(plan.max_score).toBeUndefined();
    expect(plan.round_length).toBeUndefined();
    expect(plan.deck_format).toBe("Unlimited");
  });

  it("renames on a date-only change, and the date is not a column to write", () => {
    const plan = planEventTypeChange(
      UNLIMITED,
      { tier: null, category: "Type 1 Unlimited", city: null, state: null, date: new Date(2026, 7, 1, 12) },
      UNLOCKED
    );
    expect(plan).toEqual({
      tier: null,
      category: "Type 1 Unlimited",
      city: null,
      state: null,
      deck_format: "Unlimited",
      name: "Aug 1, 2026 Type 1 Unlimited Tournament",
    });
  });

  it("leaves an Unofficial event's own name alone whatever day is picked", () => {
    const plan = planEventTypeChange(
      { ...UNLIMITED, name: "Friday Night Redemption", category: "Unofficial", deck_format: "Other", require_decklists: false },
      { tier: null, category: "Unofficial", city: null, state: null, date: new Date(2026, 7, 1, 12) },
      UNLOCKED
    );
    expect(plan.name).toBeUndefined();
  });

  it("preserves a setting the host overrode", () => {
    const plan = planEventTypeChange(
      { ...UNLIMITED, round_length: 60 },
      { tier: null, category: "Type 2", city: null, state: null },
      UNLOCKED
    );
    expect(plan.round_length).toBeUndefined();
    expect(plan.max_score).toBe(7);
  });

  it("skips max_score when it is locked by round 1", () => {
    const plan = planEventTypeChange(
      UNLIMITED,
      { tier: null, category: "Type 2", city: null, state: null },
      { maxScoreLocked: true }
    );
    expect(plan.max_score).toBeUndefined();
    expect(plan.round_length).toBe(75);
  });

  it("forces require_decklists off when the format becomes Other", () => {
    const plan = planEventTypeChange(UNLIMITED, { tier: null, category: "Booster Draft", city: null, state: null }, UNLOCKED);
    expect(plan.deck_format).toBe("Other");
    expect(plan.require_decklists).toBe(false);
  });

  it("forces require_decklists off even when the host turned it on by hand", () => {
    // Type A defaults decklists OFF, so `true` here is a host override the
    // re-seed rule would otherwise preserve straight into a format-less event.
    const typeA = {
      ...UNLIMITED,
      name: "Jul 28, 2026 Type A Tournament",
      category: "Type A",
      deck_format: "Limited",
      require_decklists: true,
    };
    const plan = planEventTypeChange(typeA, { tier: null, category: "Sealed Deck", city: null, state: null }, UNLOCKED);
    expect(plan.deck_format).toBe("Other");
    expect(plan.require_decklists).toBe(false);
  });

  it("leaves the name alone when switching to Unofficial, tier or not", () => {
    const plan = planEventTypeChange(
      UNLIMITED,
      { tier: "Regional", category: "Unofficial", city: null, state: null },
      UNLOCKED
    );
    expect(plan.name).toBeUndefined();
    expect(plan.tier).toBe("Regional");
  });

  it("keeps the current format when switching to Unofficial without an explicit one", () => {
    const plan = planEventTypeChange(UNLIMITED, { tier: null, category: "Unofficial", city: null, state: null }, UNLOCKED);
    expect(plan.deck_format).toBe("Unlimited");
  });

  it("takes the host's format when switching to Unofficial with one", () => {
    const plan = planEventTypeChange(
      UNLIMITED,
      { tier: null, category: "Unofficial", city: null, state: null, unofficialFormat: "T2" },
      UNLOCKED
    );
    expect(plan.deck_format).toBe("T2");
  });

  it("re-seeds nothing for a tournament that predates categories", () => {
    const legacy = {
      ...UNLIMITED,
      name: "Some Old Event",
      category: null,
      max_score: 5,
      round_length: 45,
      require_decklists: false,
    };
    const plan = planEventTypeChange(legacy, { tier: null, category: "Type 2", city: null, state: null }, UNLOCKED);
    expect(plan.max_score).toBeUndefined();
    expect(plan.round_length).toBeUndefined();
    expect(plan.require_decklists).toBeUndefined();
    expect(plan.deck_format).toBe("T2");
  });

  it("normalizes a legacy T1 deck_format when moving to Unofficial", () => {
    const legacy = { ...UNLIMITED, category: "Type 1", deck_format: "T1" };
    const plan = planEventTypeChange(legacy, { tier: null, category: "Unofficial", city: null, state: null }, UNLOCKED);
    expect(plan.deck_format).toBe("Limited");
  });
});
