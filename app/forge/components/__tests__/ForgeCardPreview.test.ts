import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { CANVAS, RECTS } from "@/app/forge/lib/frameGeometry";
import { textFit, TEXT_METRICS } from "@/app/forge/lib/textFit";
import type { DesignCard } from "@/app/forge/lib/designCard";

const render = (card: Parameters<typeof ForgeCardPreview>[0]["card"]) =>
  renderToStaticMarkup(React.createElement(ForgeCardPreview, { card }));
const statText = (html: string, stat: string) => {
  const m = html.match(new RegExp(`<text([^>]*)>${stat.replace("/", "\\/")}</text>`));
  if (!m) throw new Error(`no stat text ${stat}`);
  return m[1];
};

describe("ForgeCardPreview title", () => {
  const titleTexts = (html: string, name: string) =>
    [...html.matchAll(new RegExp(`<text([^>]*)>${name}</text>`, "g"))].map((m) => m[1]);

  it("draws the name as a dark copy offset to the lower right under a white face", () => {
    const html = render({ name: "Michael, Dragon Slayer", cardType: ["Hero"], brigades: ["Silver"], strength: 12, toughness: 8 });
    const texts = titleTexts(html, "Michael, Dragon Slayer");
    expect(texts).toHaveLength(2);
    const [shadow, face] = texts;
    expect(shadow).toMatch(/fill="#231f20"/);
    expect(shadow).toMatch(/transform="translate\(3 3\)"/);
    expect(face).toMatch(/fill="#fff"/);
    expect(face).not.toMatch(/transform=/);
  });

  // Printed names carry a black contour all the way around the letter as well as the shadow;
  // a hairline is not enough to lift them off a busy wash.
  it("gives the white face a black contour, painted under the fill so the letters keep their weight", () => {
    const html = render({ name: "Michael, Dragon Slayer", cardType: ["Hero"], brigades: ["Silver"], strength: 12, toughness: 8 });
    const [, face] = titleTexts(html, "Michael, Dragon Slayer");
    expect(face).toMatch(/stroke="#231f20"/);
    expect(face).toMatch(/paint-order="stroke"/);
    expect(Number(face.match(/stroke-width="([\d.]+)"/)![1])).toBeGreaterThanOrEqual(3);
  });

  // The contour and the offset shadow both sit outside the glyphs, so the clip that keeps the
  // title off the icon box has to stand off the text or the last letter comes out shaved.
  it("leaves room for the contour and the shadow inside the title clip", () => {
    const html = render({ name: "Michael, Dragon Slayer", cardType: ["Hero"], brigades: ["Silver"], strength: 12, toughness: 8 });
    const clip = html.match(/<clipPath[^>]*><rect x="([-\d.]+)"[^>]*width="([\d.]+)"/)!;
    const [x, w] = [Number(clip[1]), Number(clip[2])];
    const stroke = Number(titleTexts(html, "Michael, Dragon Slayer")[1].match(/stroke-width="([\d.]+)"/)![1]);
    expect(RECTS.title.x - x).toBeGreaterThanOrEqual(stroke / 2);
    expect(x + w - (RECTS.title.x + RECTS.title.w)).toBeGreaterThanOrEqual(stroke / 2);
  });
});

describe("ForgeCardPreview stats", () => {
  it("prints stats without an outline, at one size, with digit tops just under the box top", () => {
    const hero = statText(render({ cardType: ["Hero"], brigades: ["Blue"], strength: 11, toughness: 9 }), "11/9");
    expect(hero).not.toMatch(/stroke/);
    expect(hero).toMatch(/font-size="41"/);
    expect(hero).toMatch(new RegExp(`y="${RECTS.leftBox.y + 34}"`));
    expect(hero).toMatch(/fill="#fff"/);
    // "10/11" prints at the same size as "9/6" — the box has room.
    expect(statText(render({ cardType: ["Hero"], brigades: ["Blue"], strength: 10, toughness: 11 }), "10/11")).toMatch(/font-size="41"/);
  });
  it("uses dark digits on a light box, still without an outline", () => {
    const white = statText(render({ cardType: ["Hero"], brigades: ["White"], strength: 5, toughness: 2 }), "5/2");
    expect(white).toMatch(/fill="#231f20"/);
    expect(white).not.toMatch(/stroke/);
  });
});

describe("ForgeCardPreview brigade bands", () => {
  const box = RECTS.leftBox;
  const bandTops = (html: string) =>
    [...html.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="[\d.]+" fill="#[0-9a-f]{6}" clip-path=/g)].map((m) => Number(m[1]));
  const masks = (html: string) =>
    [...html.matchAll(/(?<!-webkit-)mask-image:linear-gradient\(to bottom, transparent ([\d.]+)%, #000 ([\d.]+)%\)/g)]
      .map((m) => [Number(m[1]), Number(m[2])]);

  // Measured on Army of a Million Men and Mercenary Chariots (Crimson / Gold / Gray): three
  // equal bands, in the listed order. Two brigades keep the 45 / 55 split.
  it("bands the icon box once per brigade: 45 / 55 for two, even thirds for three", () => {
    const two = bandTops(render({ cardType: ["Hero"], brigades: ["Blue", "Green"], strength: 5, toughness: 5 }));
    expect(two).toHaveLength(1);
    expect(two[0]).toBeCloseTo(box.y + box.h * 0.45, 6);
    const three = bandTops(render({ cardType: ["EvilCharacter"], brigades: ["Crimson", "EvilGold", "Gray"], strength: 6, toughness: 10 }));
    expect(three).toHaveLength(2);
    expect(three[0]).toBeCloseTo(box.y + box.h / 3, 6);
    expect(three[1]).toBeCloseTo(box.y + (2 * box.h) / 3, 6);
  });

  it("blends every brigade's wash in, top to bottom; two brigades still fade 40% to 60%", () => {
    expect(masks(render({ brigades: ["Blue", "Green"] }))).toEqual([[40, 60]]);
    const html = render({ brigades: ["Crimson", "EvilGold", "Gray"] });
    expect(html.match(/\/forge\/frames\/washes\//g)).toHaveLength(3);
    // Three brigades: edges at a third and two thirds, each fade 40% / 3 of the height wide.
    const [a, b] = masks(html);
    expect(a[0]).toBeCloseTo(100 / 3 - 20 / 3, 6); expect(a[1]).toBeCloseTo(40, 6);
    expect(b[0]).toBeCloseTo(60, 6); expect(b[1]).toBeCloseTo(200 / 3 + 20 / 3, 6);
  });
});

// A long ability and a verse, neither carrying a character React escapes, so the rendered
// markup can be matched against the strings textFit wrapped.
const WORDY: DesignCard = {
  name: "As Rob Anderson Intended",
  cardType: ["Artifact"],
  brigades: [],
  identifiers: ["Idol"],
  rawText: "All characters, enhancements and lost souls in play lose their abilities. All characters, enhancements, and lost souls played this turn lose their abilities. Limit 2 turns.",
  scripture: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
  reference: "John 3:16",
};
const textAttrs = (html: string, content: string) => {
  const m = html.match(new RegExp(`<text([^>]*)>${content.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</text>`));
  if (!m) throw new Error(`no <text> for ${JSON.stringify(content)}`);
  return m[1];
};
const textY = (html: string, content: string) => Number(textAttrs(html, content).match(/ y="([\d.]+)"/)![1]);

describe("ForgeCardPreview zoom safety", () => {
  // WebKit multiplies container-query units by the page-zoom factor a second time, so a
  // Safari reader with a remembered per-site zoom saw cqw-sized text overrun the text box.
  // Everything scales through the SVG viewBox instead; nothing may go back to cqw.
  it("sizes nothing in container units", () => {
    const html = render(WORDY);
    expect(html).not.toMatch(/\d\s*cq(w|i|h|b|min|max)\b/);
    expect(html).not.toMatch(/container-type|containerType/);
  });

  it("draws each wrapped ability line as its own canvas text, one printed pitch apart", () => {
    const html = render(WORDY);
    const lines = textFit(WORDY).paragraphs.flat();
    expect(lines.length).toBeGreaterThan(3);
    const ys = lines.map((line) => textY(html, line));
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(TEXT_METRICS.ability.pitch, 6);
    expect(textAttrs(html, lines[0])).toMatch(new RegExp(`font-size="${TEXT_METRICS.ability.size}"`));
  });

  it("stretches the word spaces of every verse line but the last, as justified print does", () => {
    const html = render(WORDY);
    const lines = textFit(WORDY).verseLines;
    expect(lines.length).toBeGreaterThan(1);
    const ys = lines.map((line) => textY(html, line));
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(TEXT_METRICS.verse.pitch, 6);
    for (const line of lines.slice(0, -1)) expect(textAttrs(html, line)).toMatch(/word-spacing="[\d.]+"/);
    expect(textAttrs(html, lines[lines.length - 1])).not.toMatch(/word-spacing/);
  });

  it("keeps the last verse line on the printed reference line", () => {
    const html = render(WORDY);
    const lines = textFit(WORDY).verseLines;
    // the last line's box bottom is TEXT_METRICS.verse.bottom below the text box top
    const last = textY(html, lines[lines.length - 1]);
    const boxBottom = RECTS.textBox.y + TEXT_METRICS.verse.bottom;
    expect(boxBottom - last).toBeGreaterThan(0);
    expect(boxBottom - last).toBeLessThan(TEXT_METRICS.verse.pitch);
  });
});

describe("ForgeCardPreview empty art window", () => {
  // The art window's own div is the one element placed at RECTS.art.
  const artWindow = (html: string) => {
    const at = `position:absolute;left:${(RECTS.art.x / CANVAS.w) * 100}%;top:${(RECTS.art.y / CANVAS.h) * 100}%;`;
    const i = html.indexOf(at);
    if (i < 0) throw new Error("no art window");
    return html.slice(i, html.indexOf('"', i));
  };
  const noArtLabel = (html: string) => html.match(/<text([^>]*)>NO ART<\/text>/)?.[1];
  const MOSES: DesignCard = { name: "Redeemer Moses", cardType: ["Hero"], brigades: ["Green"], strength: 8, toughness: 8 };

  // A flat white slot punched a hole in every draft grid. Without art the window lets the
  // frame's wash through under a dark scrim, so the card keeps its brigade color.
  it("dims the frame's wash through an empty window instead of painting it white", () => {
    const html = render(MOSES);
    const win = artWindow(html);
    expect(win).not.toMatch(/background:#fff/);
    const alpha = Number(win.match(/background:rgba\(35,31,32,([\d.]+)\)/)![1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
    expect(noArtLabel(html)).toMatch(/fill="rgba\(255,255,255,/);
  });

  it("keeps the white ground under uploaded art, and drops the label", () => {
    const html = renderToStaticMarkup(React.createElement(ForgeCardPreview, { card: MOSES, artUrl: "/forge/api/art/x" }));
    expect(artWindow(html)).toMatch(/background:#fff/);
    expect(noArtLabel(html)).toBeUndefined();
  });
});
