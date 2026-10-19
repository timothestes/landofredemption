import { describe, it, expect } from "vitest";
import { excerpt, clampHandles, moveHandle, snapHandle, wholeRange, trimToFit, words } from "@/app/forge/lib/verseExcerpt";
import { textFit } from "@/app/forge/lib/textFit";
import type { DesignCard } from "@/app/forge/lib/designCard";

const gen6 = [
  { n: 1, text: "Now it came about, when mankind began to multiply on the face of the land, and daughters were born to them," },
  { n: 2, text: "that the sons of God saw that the daughters of mankind were beautiful; and they took wives for themselves, whomever they chose." },
  { n: 3, text: "Then the Lord said, “My Spirit will not remain with man forever, because he is also flesh; nevertheless his days shall be 120 years.”" },
];
const rev12 = [
  { n: 7, text: "And there was war in heaven, Michael and his angels waging war with the dragon. The dragon and his angels waged war," },
  { n: 8, text: "and they did not prevail, and there was no longer a place found for them in heaven." },
];
describe("verseExcerpt", () => {
it("a whole verse that is a whole sentence gets no ellipsis", () =>
  expect(excerpt(gen6, wholeRange(gen6, 3, 3))).toEqual({ text: gen6[2].text, from: 3, to: 3 }));
it("a whole verse that opens mid-sentence (lowercase) gets a leading …", () =>
  expect(excerpt(gen6, wholeRange(gen6, 2, 2))).toEqual({ text: "…" + gen6[1].text, from: 2, to: 2 }));
it("a whole verse that closes mid-sentence (trailing comma) gets a trailing … in place of the comma", () =>
  expect(excerpt(rev12, wholeRange(rev12, 7, 7)).text)
    .toBe("And there was war in heaven, Michael and his angels waging war with the dragon. The dragon and his angels waged war…"));
it("leading cut adds … with no space and keeps the sentence end", () =>
  expect(excerpt(gen6, { start: { verse: 2, word: 1 }, end: { verse: 2, word: words(gen6[1].text).length } }).text)
    .toBe("…the sons of God saw that the daughters of mankind were beautiful; and they took wives for themselves, whomever they chose."));
it("a mid-verse trailing cut adds …", () =>
  expect(excerpt(rev12, { start: { verse: 7, word: 0 }, end: { verse: 7, word: 20 } }).text)
    .toBe("And there was war in heaven, Michael and his angels waging war with the dragon. The dragon and his angels…"));
it("mid-6:1 to end-6:2 spans 1..2 with a leading …", () => {
  const r = excerpt(gen6, { start: { verse: 1, word: 10 }, end: { verse: 2, word: words(gen6[1].text).length } });
  expect(r).toMatchObject({ from: 1, to: 2 }); expect(r.text.startsWith("…the face of the land,")).toBe(true);
});
it("all of verse 8 after a 7-8 lookup is 8..8 (leading … because it opens lowercase, no trailing)", () =>
  expect(excerpt(rev12, wholeRange(rev12, 8, 8))).toEqual({ text: "…" + rev12[1].text, from: 8, to: 8 }));
it("a cut after a sentence end adds no ellipsis", () =>
  expect(excerpt(rev12, { start: { verse: 7, word: 0 }, end: { verse: 7, word: 15 } }).text.endsWith("dragon.")).toBe(true));
it("drops an opening quote at the cut start and keeps a closing quote after a sentence end", () => {
  const v = [{ n: 1, text: "Then the Lord said to Noah, “Enter the ark, you and all your household.”" }];
  expect(excerpt(v, { start: { verse: 1, word: 6 }, end: { verse: 1, word: 14 } }).text).toBe("…Enter the ark, you and all your household.”");
});
it("a comma under a closing quote becomes an ellipsis before the quote", () => {
  const v = [{ n: 1, text: "“The kings of the earth waged war,” and then the end came." }];
  expect(excerpt(v, { start: { verse: 1, word: 0 }, end: { verse: 1, word: 7 } }).text).toBe("“The kings of the earth waged war…”");
});
it("start never passes end; at least one word stays selected", () => {
  const h = clampHandles(gen6, { start: { verse: 2, word: 5 }, end: { verse: 2, word: 5 } });
  expect(excerpt(gen6, h).text.length).toBeGreaterThan(0);
  expect(moveHandle(gen6, { start: { verse: 2, word: 4 }, end: { verse: 2, word: 5 } }, "start", 1).start).toEqual({ verse: 2, word: 4 });
});
it("moveHandle crosses verse boundaries; snapHandle goes to the verse edge", () => {
  expect(moveHandle(gen6, wholeRange(gen6, 2, 2), "start", -1).start).toEqual({ verse: 1, word: words(gen6[0].text).length - 1 });
  expect(snapHandle(gen6, { start: { verse: 2, word: 5 }, end: { verse: 2, word: 9 } }, "end", "end").end).toEqual({ verse: 2, word: words(gen6[1].text).length });
});
it("trimToFit: unchanged when it fits, shorter with over === 0 when it can, null at the three-word floor", () => {
  const h = wholeRange(gen6, 1, 2);
  expect(trimToFit(gen6, h, { rawText: "Negate an Enhancement." } as DesignCard)).toEqual(h);
  // Pick a sentence count that overflows against both verses but fits against a shorter excerpt
  // (measured against textFit: 3-4 sentences of this length land in that window; 5+ overflow even at the three-word floor).
  const medium = { rawText: Array(4).fill("Negate and discard an evil character in battle.").join(" ") } as DesignCard;
  expect(textFit({ ...medium, scripture: excerpt(gen6, h).text }).over).toBeGreaterThan(0);
  const trimmed = trimToFit(gen6, h, medium)!;
  expect(trimmed).not.toBeNull();
  expect(textFit({ ...medium, scripture: excerpt(gen6, trimmed).text }).over).toBe(0);
  expect(excerpt(gen6, trimmed).text.length).toBeLessThan(excerpt(gen6, h).text.length);
  const hopeless = { rawText: Array(12).fill("Negate and discard an evil character in battle.").join(" ") } as DesignCard;
  expect(trimToFit(gen6, h, hopeless)).toBeNull();
});
});
