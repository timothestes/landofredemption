import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  renderCardImage, stripXmlInvalid, sanitizeDesignCard, RenderInputError, _resetRenderCardCaches, type RenderIO,
} from "../renderCard";
import { RECTS } from "../frameGeometry";
import type { DesignCard } from "../designCard";

const fontFile = (file: string) => readFileSync(path.join(process.cwd(), "public/forge/fonts", file));
// No Blob at all: the licensed faces are unavailable, so the OFL stand-ins are used (degraded).
const noBlob: RenderIO = { readPrivateFont: async () => null, readArt: async () => null };
// The committed OFL faces handed back as if they were the licensed ones read from Blob.
const oflAsPrivate: RenderIO = {
  readPrivateFont: async (face) => fontFile(face === "title" ? "Mukta-ExtraBold.ttf" : "PTSerif-Bold.ttf"),
  readArt: async () => null,
};
const HERO: DesignCard = {
  name: "Holy Writ Hero", cardType: ["Hero"], brigades: ["Blue"], strength: 9, toughness: 6,
  rawText: "During battle, you may discard this card to capture an evil character in battle.",
  scripture: "Thy word is a lamp unto my feet.", reference: "Psalm 119:105", artistCredit: "Someone",
};
type Box = { x: number; y: number; w: number; h: number };
const region = (jpeg: Buffer, r: Box) =>
  sharp(jpeg).extract({ left: Math.round(r.x), top: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) }).raw().toBuffer();
const meanDiff = (a: Buffer, b: Buffer) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / a.length;
};
const mean = (buf: Buffer, channel: 0 | 1 | 2) => {
  let s = 0, n = 0;
  for (let i = channel; i < buf.length; i += 3) { s += buf[i]; n++; }
  return s / n;
};
const render = (data: DesignCard, io: RenderIO = oflAsPrivate, artKey: string | null = null) =>
  renderCardImage({ data, artKey, year: 2026 }, io);

describe("renderCardImage", () => {
  beforeEach(() => _resetRenderCardCaches());

  it("renders a 750x1050 JPEG", async () => {
    const { jpeg } = await render(HERO);
    const meta = await sharp(jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 750, 1050]);
  }, 30000);

  it("is degraded exactly when a licensed face is unavailable or its name never matches", async () => {
    expect((await render(HERO, oflAsPrivate)).degraded).toBe(false);
    _resetRenderCardCaches();
    expect((await render(HERO, noBlob)).degraded).toBe(true);
    _resetRenderCardCaches();
    const garbage: RenderIO = { readPrivateFont: async () => Buffer.from("not a font"), readArt: async () => null };
    expect((await render(HERO, garbage)).degraded).toBe(true);
  }, 30000);

  it("shares one private-font read across concurrent cold-start calls, one per face", async () => {
    const spy = vi.fn(async (face) => (face === "title" ? fontFile("Mukta-ExtraBold.ttf") : fontFile("PTSerif-Bold.ttf")));
    const io: RenderIO = { readPrivateFont: spy, readArt: async () => null };
    const [a, b] = await Promise.all([render(HERO, io), render(HERO, io)]);
    expect(a.degraded).toBe(false);
    expect(b.degraded).toBe(false);
    // Two concurrent renders, one title read + one stat read shared between them, not four.
    expect(spy).toHaveBeenCalledTimes(2);
  }, 30000);

  it("does not remember a degraded private-font read, so the next render retries it", async () => {
    const spy = vi.fn(async () => null);
    const io: RenderIO = { readPrivateFont: spy, readArt: async () => null };
    expect((await render(HERO, io)).degraded).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2); // title + stat
    expect((await render(HERO, io)).degraded).toBe(true);
    expect(spy).toHaveBeenCalledTimes(4); // retried on the next render, not cached
  }, 30000);

  it("draws the title in the licensed face it was given", async () => {
    const titleAsSerif: RenderIO = { readPrivateFont: async () => fontFile("PTSerif-Bold.ttf"), readArt: async () => null };
    const a = await region((await render(HERO, oflAsPrivate)).jpeg, RECTS.title);
    _resetRenderCardCaches();
    const b = await region((await render(HERO, titleAsSerif)).jpeg, RECTS.title);
    expect(meanDiff(a, b)).toBeGreaterThan(2);
  }, 30000);

  it("draws the title, stats, ability and credits from the card", async () => {
    const base = (await render(HERO)).jpeg;
    const changed = (await render({ ...HERO, name: "Zq", strength: 1, toughness: 1, rawText: "Short.", artistCredit: "Another Artist Entirely" })).jpeg;
    const ability = { x: RECTS.textInset.x, y: RECTS.textInset.y, w: RECTS.textInset.w, h: 90 };
    for (const box of [RECTS.title, RECTS.statText, ability, RECTS.credits]) {
      expect(meanDiff(await region(base, box), await region(changed, box))).toBeGreaterThan(2);
    }
  }, 30000);

  it("paints the brigade wash inside the border", async () => {
    const strip = { x: RECTS.border.x + 8, y: RECTS.art.y + 200, w: RECTS.art.x - RECTS.border.x - 16, h: 60 };
    const blue = await region((await render(HERO)).jpeg, strip);
    const crimson = await region((await render({ ...HERO, brigades: ["Crimson"], cardType: ["EvilCharacter"] })).jpeg, strip);
    expect(mean(blue, 0) + mean(blue, 1) + mean(blue, 2)).toBeLessThan(3 * 235);
    expect(meanDiff(blue, crimson)).toBeGreaterThan(10);
  }, 30000);

  it("fills the art window from the art blob, and leaves it empty (NO ART) without one", async () => {
    const red = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 220, g: 20, b: 20 } } }).png().toBuffer();
    const withArt: RenderIO = { ...oflAsPrivate, readArt: async (key) => (key === "forge-art/k" ? red : null) };
    const centre = { x: RECTS.art.x + 250, y: RECTS.art.y + 120, w: 60, h: 60 };
    const art = await region((await render(HERO, withArt, "forge-art/k")).jpeg, centre);
    expect(mean(art, 0)).toBeGreaterThan(180);
    expect(mean(art, 1)).toBeLessThan(70);
    const empty = await region((await render(HERO, oflAsPrivate, null)).jpeg, centre);
    expect(mean(empty, 1)).toBeGreaterThan(200);
  }, 30000);

  it("throws RenderInputError when the art blob is missing or unreadable", async () => {
    await expect(render(HERO, oflAsPrivate, "forge-art/gone")).rejects.toBeInstanceOf(RenderInputError);
    const throwing: RenderIO = { ...oflAsPrivate, readArt: async () => { throw new Error("blob down"); } };
    await expect(render(HERO, throwing, "forge-art/k")).rejects.toBeInstanceOf(RenderInputError);
  }, 30000);

  it("renders text that carries characters XML forbids", async () => {
    const vt = String.fromCharCode(11);
    const { jpeg } = await render({ ...HERO, name: `Holy${vt}Writ`, rawText: `Line one${vt}line two.` });
    expect(jpeg.length).toBeGreaterThan(1000);
  }, 30000);
});

describe("stripXmlInvalid / sanitizeDesignCard", () => {
  const c = String.fromCharCode;
  it("drops C0 controls except tab, LF and CR, plus U+FFFE, U+FFFF and lone surrogates", () => {
    expect(stripXmlInvalid(`a${c(0)}b${c(11)}c${c(12)}d${c(31)}e`)).toBe("abcde");
    expect(stripXmlInvalid(`keep${c(9)}tab${c(10)}lf${c(13)}cr`)).toBe(`keep${c(9)}tab${c(10)}lf${c(13)}cr`);
    expect(stripXmlInvalid(`x${c(0xfffe)}${c(0xffff)}y`)).toBe("xy");
    expect(stripXmlInvalid(`lone${c(0xd800)}high and ${c(0xdc00)}low`)).toBe("lonehigh and low");
    expect(stripXmlInvalid(`pair ${c(0xd83d)}${c(0xde00)} kept`)).toBe(`pair ${c(0xd83d)}${c(0xde00)} kept`);
  });
  it("cleans every string field of a card, including arrays", () => {
    const vt = c(11);
    expect(sanitizeDesignCard({ name: `A${vt}B`, identifiers: [`I${vt}d`], strength: 5 })).toEqual({ name: "AB", identifiers: ["Id"], strength: 5 });
  });
});
