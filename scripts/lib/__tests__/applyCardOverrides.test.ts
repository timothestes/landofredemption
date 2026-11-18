import { describe, it, expect } from "vitest";
import { applyCardOverrides, EDITABLE_FIELDS, IDENTITY_FIELDS } from "../applyCardOverrides";

const card = (over: Record<string, string> = {}) => ({
  name: "Angel of God", set: "I", imgFile: "Angel_of_God_(I)", officialSet: "Prophets",
  type: "Hero", brigade: "Silver", strength: "10", toughness: "10", class: "",
  identifier: "", specialAbility: "Protect.", rarity: "Rare", reference: "Gen 1:1",
  alignment: "Good", legality: "Rotation", ...over,
});

describe("applyCardOverrides", () => {
  it("patches only the listed fields, in place", () => {
    const c = card();
    const r = applyCardOverrides([c], {
      overrides: [{ name: "Angel of God", set: "I", fields: { legality: "Banned" }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors).toEqual([]);
    expect(c.legality).toBe("Banned");
    expect(c.specialAbility).toBe("Protect."); // untouched fields flow through
  });

  it("patches the artist credit", () => {
    const c = { ...card(), artist: "From the sheet" };
    const r = applyCardOverrides([c], {
      overrides: [{ name: "Angel of God", set: "I", fields: { artist: "Doug Gray" }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors).toEqual([]);
    expect(c.artist).toBe("Doug Gray");
  });

  it("errors on an orphan override (no catalog match) and names the recovery path", () => {
    const r = applyCardOverrides([card()], {
      overrides: [{ name: "Nope", set: "I", fields: { type: "Hero" }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("Nope|I");
    expect(r.errors[0]).toContain("/admin/catalog");
  });

  it("errors when the name|set key matches more than one row (shadowed rows patch as silent no-ops otherwise)", () => {
    const r = applyCardOverrides([card(), card()], {
      overrides: [{ name: "Angel of God", set: "I", fields: { type: "Hero" }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors.some((e) => e.includes("more than one"))).toBe(true);
  });

  it("errors on identity fields, unknown fields, and non-string values", () => {
    const r = applyCardOverrides([card()], {
      overrides: [{ name: "Angel of God", set: "I", fields: { imgFile: "x", bogus: "y", strength: 5 as unknown as string }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors).toHaveLength(3);
  });

  it("warns (does not error) when the base already equals the override — the retire signal", () => {
    const c = card();
    const r = applyCardOverrides([c], {
      overrides: [{ name: "Angel of God", set: "I", fields: { legality: "Rotation" }, note: "n" }],
      imageVersions: {},
    });
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.includes("retiring"))).toBe(true);
    expect(c.legality).toBe("Rotation");
  });

  it("errors on a stranded image version (no card uses the imgFile) — spec F5", () => {
    const r = applyCardOverrides([card()], {
      overrides: [],
      imageVersions: { Ghost_Image: 2 },
    });
    expect(r.errors.some((e) => e.includes("Ghost_Image"))).toBe(true);
  });

  it("errors on a non-positive-integer image version; passes a valid one", () => {
    const bad = applyCardOverrides([card()], { overrides: [], imageVersions: { "Angel_of_God_(I)": 0 } });
    expect(bad.errors).toHaveLength(1);
    const good = applyCardOverrides([card()], { overrides: [], imageVersions: { "Angel_of_God_(I)": 3 } });
    expect(good.errors).toEqual([]);
  });

  it("tolerates an empty/absent overlay", () => {
    expect(applyCardOverrides([card()], { overrides: [], imageVersions: {} }).errors).toEqual([]);
    expect(applyCardOverrides([card()], {}).errors).toEqual([]);
  });

  it("field constants: 13 editable + 3 identity, disjoint", () => {
    expect(EDITABLE_FIELDS).toHaveLength(13);
    expect(IDENTITY_FIELDS).toEqual(["name", "set", "imgFile"]);
    expect(EDITABLE_FIELDS.some((f: string) => IDENTITY_FIELDS.includes(f))).toBe(false);
  });
});
