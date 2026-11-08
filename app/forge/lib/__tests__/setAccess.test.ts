import { describe, it, expect } from "vitest";
import { grantKey, buildGrantKeySet, NEW_SET_PRIVATE_DEFAULT } from "@/app/forge/lib/setAccess";

describe("grantKey", () => {
  it("joins userId and setId with a separator", () => {
    expect(grantKey("u1", "s1")).toBe("u1|s1");
  });

  it("distinguishes swapped ids", () => {
    expect(grantKey("a", "b")).not.toBe(grantKey("b", "a"));
  });
});

describe("buildGrantKeySet", () => {
  it("builds a set of keys from pairs", () => {
    const s = buildGrantKeySet([
      { userId: "u1", setId: "s1" },
      { userId: "u2", setId: "s1" },
    ]);
    expect(s.has(grantKey("u1", "s1"))).toBe(true);
    expect(s.has(grantKey("u2", "s1"))).toBe(true);
    expect(s.has(grantKey("u1", "s2"))).toBe(false);
  });

  it("dedupes duplicate pairs", () => {
    const s = buildGrantKeySet([
      { userId: "u1", setId: "s1" },
      { userId: "u1", setId: "s1" },
    ]);
    expect(s.size).toBe(1);
  });

  it("returns an empty set for no pairs", () => {
    expect(buildGrantKeySet([]).size).toBe(0);
  });
});

describe("NEW_SET_PRIVATE_DEFAULT", () => {
  it("starts a new set private: Forge cards are secret by default", () => {
    expect(NEW_SET_PRIVATE_DEFAULT).toBe(true);
  });
});
