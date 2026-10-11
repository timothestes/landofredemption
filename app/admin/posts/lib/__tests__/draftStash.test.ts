import { beforeEach, describe, expect, it } from "vitest";
import { clearDraftStash, peekDraftStash, putDraftStash, STASH_TTL_MS, type DraftStash } from "../draftStash";

const base: DraftStash = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Probe",
  slug: "probe",
  slugTouched: false,
  tags: ["tag"],
  excerpt: "",
  cover: null,
  body: "Body typed before the first autosave.",
  publishAt: "",
  scheduledAt: null,
  status: "draft",
  dirty: true,
  selection: { start: 5, end: 5 },
};

describe("draftStash", () => {
  beforeEach(() => clearDraftStash());

  it("is empty until something is put", () => {
    expect(peekDraftStash(base.id)).toBeNull();
  });

  it("returns what was put for the same post, and keeps it", () => {
    putDraftStash(base, 1000);
    expect(peekDraftStash(base.id, 1500)).toEqual(base);
    expect(peekDraftStash(base.id, 1600)).toEqual(base);
  });

  it("ignores a stash for a different post", () => {
    putDraftStash(base, 1000);
    expect(peekDraftStash("22222222-2222-4222-8222-222222222222", 1500)).toBeNull();
  });

  it("expires after the TTL so a later revisit loads the server row", () => {
    putDraftStash(base, 1000);
    expect(peekDraftStash(base.id, 1000 + STASH_TTL_MS)).toEqual(base);
    expect(peekDraftStash(base.id, 1000 + STASH_TTL_MS + 1)).toBeNull();
  });

  it("a later put replaces the earlier one", () => {
    putDraftStash(base, 1000);
    putDraftStash({ ...base, body: "newer" }, 1200);
    expect(peekDraftStash(base.id, 1300)?.body).toBe("newer");
  });

  it("clear empties it", () => {
    putDraftStash(base, 1000);
    clearDraftStash();
    expect(peekDraftStash(base.id, 1001)).toBeNull();
  });
});
