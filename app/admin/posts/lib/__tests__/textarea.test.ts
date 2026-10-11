import { describe, it, expect } from "vitest";
import { wrapSelection, prefixLines, insertBlock, replaceOnce, minimalEdit, continueList, normalizeHref } from "../textarea";

describe("wrapSelection", () => {
  it("wraps the selected text and keeps it selected", () => {
    const r = wrapSelection("hello world", { start: 6, end: 11 }, "**");
    expect(r.value).toBe("hello **world**");
    expect([r.selectionStart, r.selectionEnd]).toEqual([8, 13]);
  });
  it("inserts a placeholder when nothing is selected and selects it", () => {
    const r = wrapSelection("ab", { start: 1, end: 1 }, "_", "_", "text");
    expect(r.value).toBe("a_text_b");
    expect([r.selectionStart, r.selectionEnd]).toEqual([2, 6]);
  });
  it("supports asymmetric wrappers (links)", () => {
    const r = wrapSelection("see docs", { start: 4, end: 8 }, "[", "](https://x)");
    expect(r.value).toBe("see [docs](https://x)");
  });
});

describe("prefixLines", () => {
  it("prefixes every line touched by the selection", () => {
    const r = prefixLines("one\ntwo\nthree", { start: 5, end: 9 }, "- ");
    expect(r.value).toBe("one\n- two\n- three");
  });
  it("does not double a prefix that is already there", () => {
    expect(prefixLines("- a", { start: 0, end: 0 }, "- ").value).toBe("- a");
  });
  it("works on an empty document", () => {
    const r = prefixLines("", { start: 0, end: 0 }, "## ");
    expect(r.value).toBe("## ");
    expect(r.selectionStart).toBe(3);
  });
});

describe("insertBlock", () => {
  it("surrounds the block with blank lines mid-document", () => {
    const r = insertBlock("a\nb", { start: 1, end: 1 }, "https://youtu.be/x");
    expect(r.value).toBe("a\n\nhttps://youtu.be/x\n\nb");
    expect(r.selectionStart).toBe(r.selectionEnd);
  });
  it("does not add leading blank lines at the very start", () => {
    expect(insertBlock("", { start: 0, end: 0 }, "X").value).toBe("X\n");
  });
  it("does not duplicate blank lines that already exist", () => {
    expect(insertBlock("a\n\n\n\nb", { start: 3, end: 3 }, "X").value).toBe("a\n\nX\n\nb");
  });
});

describe("normalizeHref", () => {
  it("prefixes https:// on a bare host", () => expect(normalizeHref("example.com")).toBe("https://example.com"));
  it("keeps site-relative paths and anchors as typed", () => {
    expect(normalizeHref("/articles/x")).toBe("/articles/x");
    expect(normalizeHref("#top")).toBe("#top");
  });
  it("keeps any scheme as typed", () => {
    expect(normalizeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(normalizeHref("http://x.y")).toBe("http://x.y");
  });
  it("trims whitespace", () => expect(normalizeHref(" https://x.y ")).toBe("https://x.y"));
});

describe("replaceOnce", () => {
  it("replaces only the first occurrence", () => {
    expect(replaceOnce("x [p]() y [p]()", "[p]()", "Z")).toBe("x Z y [p]()");
  });
  it("returns the input unchanged when the needle is absent", () => {
    expect(replaceOnce("abc", "zzz", "Q")).toBe("abc");
  });
});

describe("minimalEdit", () => {
  it("returns null when nothing changed", () => {
    expect(minimalEdit("abc", "abc")).toBeNull();
  });
  it("finds the range a bold wrap changed", () => {
    expect(minimalEdit("hello world", "hello **world**")).toEqual({ start: 6, end: 11, text: "**world**" });
  });
  it("handles a prefix inserted at 0", () => {
    expect(minimalEdit("a", "- a")).toEqual({ start: 0, end: 0, text: "- " });
  });
  it("does not let the prefix and suffix overlap", () => {
    expect(minimalEdit("aa", "aaa")).toEqual({ start: 2, end: 2, text: "a" });
  });
  it("reports a pure deletion as an empty replacement", () => {
    expect(minimalEdit("- \nx", "\nx")).toEqual({ start: 0, end: 2, text: "" });
  });
});

describe("continueList", () => {
  it("continues a bulleted list", () => {
    const r = continueList("- item", { start: 6, end: 6 });
    expect(r?.value).toBe("- item\n- ");
    expect(r?.selectionStart).toBe(9);
  });
  it("increments a numbered list", () => {
    expect(continueList("1. one", { start: 6, end: 6 })?.value).toBe("1. one\n2. ");
  });
  it("continues a quote", () => {
    expect(continueList("> q", { start: 3, end: 3 })?.value).toBe("> q\n> ");
  });
  it("preserves nested indentation", () => {
    expect(continueList("- a\n  - b", { start: 9, end: 9 })?.value).toBe("- a\n  - b\n  - ");
  });
  it("ends the list on an empty item", () => {
    const r = continueList("- a\n- ", { start: 6, end: 6 });
    expect(r?.value).toBe("- a\n");
    expect([r?.selectionStart, r?.selectionEnd]).toEqual([4, 4]);
  });
  it("splits an item when the caret is mid-line", () => {
    expect(continueList("- ab", { start: 3, end: 3 })?.value).toBe("- a\n- b");
  });
  it("returns null on a plain line, a bare marker, or a range selection", () => {
    expect(continueList("plain", { start: 5, end: 5 })).toBeNull();
    expect(continueList("-", { start: 1, end: 1 })).toBeNull();
    expect(continueList("- a", { start: 2, end: 3 })).toBeNull();
  });
});
