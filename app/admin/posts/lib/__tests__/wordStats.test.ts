import { describe, it, expect } from "vitest";
import { wordStats } from "../wordStats";

describe("wordStats", () => {
  it("is zero for an empty or whitespace-only body", () => {
    expect(wordStats("")).toEqual({ words: 0, minutes: 0 });
    expect(wordStats("  \n\n ")).toEqual({ words: 0, minutes: 0 });
  });
  it("rounds a short body up to one minute", () => {
    expect(wordStats("one two three")).toEqual({ words: 3, minutes: 1 });
  });
  it("reads at 230 words per minute, rounding up", () => {
    expect(wordStats(Array(230).fill("w").join(" ")).minutes).toBe(1);
    expect(wordStats(Array(231).fill("w").join(" ")).minutes).toBe(2);
    expect(wordStats(Array(1200).fill("w").join(" "))).toEqual({ words: 1200, minutes: 6 });
  });
  it("does not count markdown syntax, URLs or media as words", () => {
    const md = "## Heading\n\n- item [[Son of God]]\n\n![alt](https://x/a.png)\n\n[link](https://x) https://youtu.be/dQw4w9WgXcQ\n\n```\ncode here\n```";
    expect(wordStats(md).words).toBe(6); // Heading item Son of God link
  });
  it("is not truncated like the card excerpt", () => {
    expect(wordStats(Array(400).fill("word").join(" ")).words).toBe(400);
  });
});
