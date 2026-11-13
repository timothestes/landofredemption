import { describe, it, expect } from "vitest";
import {
  categoryDefaults,
  otherCategories,
  STANDARD_CATEGORIES,
} from "../categoryDefaults";

describe("categoryDefaults", () => {
  it.each([
    ["Type 1 Limited", "Limited"],
    ["Type 1 Unlimited", "Unlimited"],
    ["Type 2", "T2"],
    ["Teams", "Teams"],
    ["Type 1 - Teams", "Teams"],
    ["Paragon", "Paragon"],
    ["Booster Draft (GoC x3)", "Other"],
    ["Type A 2-Player", "Limited"],
  ])("%s → %s", (cat, fmt) => {
    expect(categoryDefaults(cat).deck_format).toBe(fmt);
  });

  it("lists both T1 categories", () => {
    expect(STANDARD_CATEGORIES).toContain("Type 1 Unlimited");
  });

  describe("otherCategories", () => {
    it("offers every standard category when nothing is offered", () => {
      expect(otherCategories([])).toEqual([...STANDARD_CATEGORIES]);
    });

    it("drops a category the listing already offers, whatever its wording", () => {
      const rest = otherCategories(["Booster Draft - 2 Player"]);
      expect(rest).not.toContain("Booster Draft");
      expect(rest).toContain("Type 2");
    });

    it("treats a listing's Type 1 as Type 1 Limited, not Unlimited", () => {
      const rest = otherCategories(["Type 1 - 2 Player"]);
      expect(rest).not.toContain("Type 1 Limited");
      expect(rest).toContain("Type 1 Unlimited");
    });

    it("keeps Unlimited out of reach of the Limited rule", () => {
      expect(otherCategories(["Type 1 Unlimited"])).toContain("Type 1 Limited");
    });
  });
});
