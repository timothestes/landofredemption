import { describe, it, expect } from "vitest";
import React from "react";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import CardSvg, { type CardSvgProps } from "@/app/forge/components/CardSvg";
import { RENDER_VERSION } from "@/app/forge/lib/renderVersion";
import type { DesignCard } from "@/app/forge/lib/designCard";

const FONTS = { title: "Title Face", stat: "Stat Face", body: "Body Face" };
const props = (card: DesignCard, over: Partial<CardSvgProps> = {}): CardSvgProps => ({
  card, idPrefix: "r", fonts: FONTS, assetHref: (p) => `inline:${p}`,
  noArt: false, annotations: false, year: 2026, rasters: { art: "data:art" }, ...over,
});
const render = (p: CardSvgProps) => renderToStaticMarkup(React.createElement(CardSvg, p));
const HERO: DesignCard = { name: "Holy Writ Hero", cardType: ["Hero"], brigades: ["Blue"], strength: 5, toughness: 5, class: ["Warrior"] };

describe("CardSvg as a standalone document (server)", () => {
  it("is a 750x1050 svg document with no CSS positioning", () => {
    const html = render(props(HERO));
    expect(html.startsWith("<svg")).toBe(true);
    expect(html).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('width="750"');
    expect(html).toContain('height="1050"');
    expect(html).not.toContain("position:absolute");
  });

  it("draws each wash through the asset resolver, masking every brigade after the first", () => {
    const html = render(props({ cardType: ["EvilCharacter"], brigades: ["Crimson", "EvilGold", "Gray"], strength: 6, toughness: 10 }));
    const washes = [...html.matchAll(/<image href="inline:[/]forge[/]frames[/]washes[/]([a-z-]+)[.]webp"([^>]*)>/g)];
    expect(washes.map((m) => m[1])).toEqual(["crimson", "gold", "gray"]);
    expect(washes[0][2]).not.toContain("mask=");
    expect(washes[1][2]).toContain('mask="url(#rwm1)"');
    expect(washes[2][2]).toContain('mask="url(#rwm2)"');
  });

  it("fades a second brigade in from 40% to 60%, black to white (a luminance mask)", () => {
    const html = render(props({ cardType: ["Hero"], brigades: ["Blue", "Green"], strength: 5, toughness: 5 }));
    const grad = html.match(/<linearGradient id="rwg1"[^>]*>(.*?)<[/]linearGradient>/);
    expect(grad).not.toBeNull();
    expect(grad![1]).toContain('offset="0.4" stop-color="#000"');
    expect(grad![1]).toContain('offset="0.6" stop-color="#fff"');
  });

  it("fills a brigade-less border with the neutral grey", () => {
    expect(render(props({ cardType: ["Covenant"], alignment: "Good" }))).toContain('fill="#b9b3aa"');
  });

  it("draws the art in the art window, and NO ART only when told there is none", () => {
    const withArt = render(props({ cardType: ["Artifact"] }));
    expect(withArt).toContain('<image href="data:art"');
    expect(withArt).not.toContain("NO ART");
    expect(withArt).not.toContain('fill="rgba(35,31,32,.42)"');
    const without = render(props({ cardType: ["Artifact"] }, { noArt: true, rasters: { art: null } }));
    expect(without).not.toContain('href="data:art"');
    expect(without).toContain("NO ART");
    expect(without).toContain('fill="rgba(35,31,32,.42)"');
  });

  it("routes every badge, icon and class icon through the asset resolver", () => {
    const hrefs = [...render(props(HERO)).matchAll(/href="([^"]+)"/g)].map((m) => m[1]).filter((h) => h !== "data:art");
    expect(hrefs.length).toBeGreaterThan(1);
    for (const h of hrefs) expect(h.startsWith("inline:/forge/frames/")).toBe(true);
  });

  it("uses the given font families and copyright year, and keeps kerning off in style form", () => {
    const html = render(props(HERO));
    expect(html).toContain('font-family="Title Face"');
    expect(html).toContain('font-family="Stat Face"');
    expect(html).toContain('font-family="Body Face"');
    expect(html).toContain("2026 Cactus Game Design");
    expect(html).toContain('style="font-kerning:none"');
  });

  it("hides the Forge annotation pills unless asked for them", () => {
    const long: DesignCard = { cardType: ["Artifact"], rawText: "word ".repeat(400), legality: "Classic" };
    expect(render(props(long, { annotations: true }))).toContain("preview approximate");
    const html = render(props(long, { annotations: false }));
    expect(html).not.toContain("preview approximate");
    expect(html).not.toContain("data-fit");
  });
});

describe("CardSvg as the preview overlay (browser)", () => {
  it("draws no raster layers and keeps the overlay positioning", () => {
    const html = render(props(HERO, { rasters: null }));
    expect(html).not.toContain('<image href="inline:/forge/frames/washes/');
    expect(html).not.toContain("xmlns=");
    expect(html).toContain("position:absolute");
  });
});

// ADVISORY (no CI runs vitest). Rendered play cards are cached under RENDER_VERSION, so any
// change to CardSvg's output must bump it. If this fails after an intentional change: bump
// RENDER_VERSION in app/forge/lib/renderVersion.ts, then record the new version and hash here.
describe("RENDER_VERSION guard", () => {
  it("matches the markup hash recorded for this renderer version", () => {
    const fixtures: DesignCard[] = [
      { name: "Michael, Dragon Slayer", cardType: ["Hero"], brigades: ["Silver", "Blue"], strength: 12, toughness: 8, class: ["Warrior"], icons: ["Territory"], identifiers: ["Angel"], rawText: "Protect your heroes from evil characters.", scripture: "And there was war in heaven.", reference: "Revelation 12:7" },
      { name: "Wormwood", cardType: ["EvilCharacter"], brigades: ["Crimson", "EvilGold", "Gray"], strength: 7, toughness: 6 },
      { name: "A Really Lost Soul", cardType: ["LostSoul"] },
      { name: "Covenant with Noah", cardType: ["Covenant"], alignment: "Good" },
      { name: "Holy Writ", cardType: ["Artifact"], rawText: "During battle, you may discard this card to capture an evil character in battle." },
    ];
    const markup = fixtures
      .map((card, i) => render(props(card, { noArt: i % 2 === 1, rasters: { art: i % 2 === 1 ? null : "data:art" } })))
      .join("");
    const hash = createHash("sha256").update(markup).digest("hex");
    expect({ RENDER_VERSION, hash }).toEqual({ RENDER_VERSION: 2, hash: "edc52504efa4d53ad5317d2c9194d61d0e52f5cf5e292b50f8d50a631e3ccfa8" });
  });
});
