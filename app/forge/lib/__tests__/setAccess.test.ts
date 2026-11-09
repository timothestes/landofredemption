import { describe, it, expect } from "vitest";
import { grantKey, buildGrantKeySet, NEW_SET_PRIVATE_DEFAULT, canWriteSet, setsTakingCards, canWriteCard, canEditArtSources } from "@/app/forge/lib/setAccess";

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

// Mirrors is_forge_set_elder (migration 071). The database stays the real gate.
describe("canWriteSet", () => {
  it("lets every elder write to a set that isn't private, on the roster or not", () => {
    expect(canWriteSet({ role: "elder", isPrivate: false, onRoster: false })).toBe(true);
  });
  it("keeps a private set to its roster", () => {
    expect(canWriteSet({ role: "elder", isPrivate: true, onRoster: false })).toBe(false);
    expect(canWriteSet({ role: "elder", isPrivate: true, onRoster: true })).toBe(true);
  });
  it("lets a superadmin write anywhere", () => {
    expect(canWriteSet({ role: "superadmin", isPrivate: true, onRoster: false })).toBe(true);
  });
  it("gives a playtester nothing without a roster row", () => {
    expect(canWriteSet({ role: "playtester", isPrivate: false, onRoster: false })).toBe(false);
  });
});

describe("setsTakingCards", () => {
  const open = { id: "open", isPrivate: false, status: "open" };
  const mine = { id: "mine", isPrivate: true, status: "open" };
  const theirs = { id: "theirs", isPrivate: true, status: "open" };
  const released = { id: "released", isPrivate: false, status: "released" };
  const all = [open, mine, theirs, released];
  const ids = (sets: { id: string }[]) => sets.map((s) => s.id);

  it("hides a private set you only hold a grant on", () => {
    expect(ids(setsTakingCards(all, "elder", new Set(["mine"])))).toEqual(["open", "mine"]);
  });
  it("shows a superadmin every set that can still take cards", () => {
    expect(ids(setsTakingCards(all, "superadmin", new Set()))).toEqual(["open", "mine", "theirs"]);
  });
  it("hides a released set from everyone, because the database refuses it for everyone", () => {
    expect(setsTakingCards([released], "elder", new Set(["released"]))).toEqual([]);
    expect(setsTakingCards([released], "superadmin", new Set())).toEqual([]);
  });
});

// Mirrors the guard in forge_save_card_fields and forge_publish_card. The database stays the real gate.
describe("canWriteCard", () => {
  const base = { status: "draft", isOwner: false, role: "elder" as const, canDesign: false };
  it("refuses a reader of a set they can't design", () => {
    expect(canWriteCard(base)).toBe(false);
  });
  it("lets a designer of the set write, roster or not", () => {
    expect(canWriteCard({ ...base, canDesign: true })).toBe(true);
  });
  it("lets the owner and a superadmin write", () => {
    expect(canWriteCard({ ...base, isOwner: true })).toBe(true);
    expect(canWriteCard({ ...base, role: "superadmin" })).toBe(true);
  });
  it("keeps a promoted card read-only for everyone", () => {
    const promoted = { ...base, status: "promoted" };
    expect(canWriteCard({ ...promoted, isOwner: true, canDesign: true })).toBe(false);
    expect(canWriteCard({ ...promoted, role: "superadmin" })).toBe(false);
  });
});

// Mirrors forge_set_art_candidate_source, which has no status check on purpose.
describe("canEditArtSources", () => {
  const base = { isOwner: false, role: "elder" as const, canDesign: false };
  it("follows who can edit the card", () => {
    expect(canEditArtSources(base)).toBe(false);
    expect(canEditArtSources({ ...base, canDesign: true })).toBe(true);
    expect(canEditArtSources({ ...base, isOwner: true })).toBe(true);
    expect(canEditArtSources({ ...base, role: "superadmin" })).toBe(true);
  });
  it("is the one thing a designer keeps on a promoted card", () => {
    const designer = { ...base, canDesign: true };
    expect(canWriteCard({ ...designer, status: "promoted" })).toBe(false);
    expect(canEditArtSources(designer)).toBe(true);
  });
});
