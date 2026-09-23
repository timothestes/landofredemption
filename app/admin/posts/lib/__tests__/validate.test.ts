import { describe, it, expect } from "vitest";
import { normalizeTags, validatePatch, validateForPublish, canEditPost, MAX_TAGS, type PostPatch } from "../validate";

const ok: PostPatch = {
  title: "A fine title",
  slug: "a-fine-title",
  excerpt: null,
  body_md: "Body",
  cover_image_url: null,
  tags: ["Strategy"],
  published_at: null,
};

describe("normalizeTags", () => {
  it("trims, collapses whitespace, keeps first spelling, dedupes case-insensitively", () => {
    expect(normalizeTags([" Deck  Tech ", "deck tech", "News", "", "news"])).toEqual(["Deck Tech", "News"]);
  });
  it("drops overlong tags and caps the count", () => {
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
    expect(normalizeTags(["x".repeat(41), ...many])).toHaveLength(MAX_TAGS);
  });
});

describe("validatePatch", () => {
  it("accepts a good patch", () => expect(validatePatch(ok)).toBeNull());
  it("rejects an empty title", () => expect(validatePatch({ ...ok, title: "  " })).toMatch(/title/i));
  it("rejects a 201-char title", () => expect(validatePatch({ ...ok, title: "x".repeat(201) })).toMatch(/200/));
  it.each(["Has Caps", "double--hyphen", "-leading", "trailing-", "sp ace", ""])("rejects slug %j", (slug) =>
    expect(validatePatch({ ...ok, slug })).toMatch(/slug/i),
  );
  it("rejects a long excerpt", () => expect(validatePatch({ ...ok, excerpt: "e".repeat(501) })).toMatch(/500/));
  it("rejects a non-https cover", () => expect(validatePatch({ ...ok, cover_image_url: "http://x/y.png" })).toMatch(/https/));
  it("accepts a valid published_at", () =>
    expect(validatePatch({ ...ok, published_at: "2026-01-01T00:00:00.000Z" })).toBeNull());
  it("rejects an invalid published_at", () => expect(validatePatch({ ...ok, published_at: "not a date" })).toMatch(/date/i));
});

describe("validateForPublish", () => {
  it("passes a titled post with a body", () => expect(validateForPublish({ title: "T", body_md: "b" })).toBeNull());
  it("blocks the default title", () => expect(validateForPublish({ title: "Untitled", body_md: "b" })).toMatch(/title/i));
  it("blocks an empty body", () => expect(validateForPublish({ title: "T", body_md: " \n" })).toMatch(/write/i));
});

describe("canEditPost", () => {
  it("lets the owner edit their own post", () => {
    expect(canEditPost({ userId: "u1", isSuperuser: false }, { author_id: "u1" })).toBe(true);
  });
  it("lets the superuser edit anyone's post", () => {
    expect(canEditPost({ userId: "u1", isSuperuser: true }, { author_id: "u2" })).toBe(true);
  });
  it("blocks another poster from editing", () => {
    expect(canEditPost({ userId: "u1", isSuperuser: false }, { author_id: "u2" })).toBe(false);
  });
});
