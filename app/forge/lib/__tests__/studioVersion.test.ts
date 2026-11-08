import { describe, it, expect } from "vitest";
import { imagesMoved, pickStudioVersion, versionPill, type StudioVersion } from "../studioVersion";

const released: StudioVersion = { number: 3, releasedData: { name: "Invented Tyrant", strength: 7 }, imagesMoved: false };

describe("versionPill", () => {
  it("says the status alone when there is no version yet", () => {
    expect(versionPill("draft", null, {}).label).toBe("Draft");
  });

  it("speaks the grid's language for an unreleased iteration, with no claim about playtesters", () => {
    const pill = versionPill("draft", { number: 2, releasedData: null, imagesMoved: false }, { name: "Anything" });
    expect(pill).toEqual({ label: "Draft · v2" });
  });

  it("names the released version while the draft still matches it", () => {
    const pill = versionPill("playtesting", released, { name: "Invented Tyrant", strength: 7 });
    expect(pill.label).toBe("In playtest · v3");
    expect(pill.title).toBe("Playtesters see v3. This draft matches it.");
  });

  it("marks a draft that has moved on from the release", () => {
    const pill = versionPill("playtesting", released, { name: "Invented Tyrant", strength: 8 });
    expect(pill.label).toBe("In playtest · v3 · edited since");
    expect(pill.title).toBe("Playtesters see v3. This draft has changes they don't see yet.");
  });

  it("drops the mark when the edit is typed back to the released text", () => {
    expect(versionPill("playtesting", released, { name: "Invented Tyrant", strength: 7 }).label).toBe("In playtest · v3");
  });

  it("marks a changed image even when the text matches", () => {
    const pill = versionPill("approved", { ...released, imagesMoved: true }, { name: "Invented Tyrant", strength: 7 });
    expect(pill.label).toBe("Final · v3 · edited since");
  });
});

describe("pickStudioVersion", () => {
  const versions = [
    { id: "v4", versionNumber: 4, data: { name: "Newest" } },
    { id: "v3", versionNumber: 3, data: { name: "Published" } },
    { id: "v2", versionNumber: 2, data: { name: "Approved" } },
  ];
  const card = (publishedVersionId: string | null, approvedVersionId: string | null) => ({ publishedVersionId, approvedVersionId });

  it("is null when the card has no versions", () => {
    expect(pickStudioVersion(card(null, null), [], false)).toBeNull();
  });

  it("uses the newest version, unreleased, when nothing is released", () => {
    expect(pickStudioVersion(card(null, null), versions, true)).toEqual({ number: 4, releasedData: null, imagesMoved: false });
  });

  it("uses the published version when there is one", () => {
    expect(pickStudioVersion(card("v3", null), versions, false)).toEqual({ number: 3, releasedData: { name: "Published" }, imagesMoved: false });
  });

  it("lets the approved version win, as the playtester reader does", () => {
    expect(pickStudioVersion(card("v3", "v2"), versions, true)).toEqual({ number: 2, releasedData: { name: "Approved" }, imagesMoved: true });
  });
});

describe("imagesMoved", () => {
  const working = { working_art_key: "a", working_art_is_placeholder: false, working_finished_key: null };
  const version = { art_key: "a", art_is_placeholder: false, finished_key: null };

  it("is false when the release froze the same images", () => {
    expect(imagesMoved(working, version)).toBe(false);
  });
  it("sees swapped art", () => {
    expect(imagesMoved({ ...working, working_art_key: "b" }, version)).toBe(true);
  });
  it("sees a new finished image", () => {
    expect(imagesMoved({ ...working, working_finished_key: "f" }, version)).toBe(true);
  });
  it("sees art taken off placeholder, since playtesters still get no art until a release", () => {
    expect(imagesMoved(working, { ...version, art_is_placeholder: true })).toBe(true);
  });
  it("treats a null placeholder flag as false", () => {
    expect(imagesMoved({ ...working, working_art_is_placeholder: null }, version)).toBe(false);
  });
  it("cannot claim a move without both rows", () => {
    expect(imagesMoved(null, version)).toBe(false);
    expect(imagesMoved(working, null)).toBe(false);
  });
});
