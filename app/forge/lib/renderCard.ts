// SERVER-ONLY. Renders a released Forge card version to the JPEG that play surfaces show when
// the version has no uploaded finished image: CardSvg as a standalone document (washes, art,
// frame, text) through resvg, then sharp. Spec: docs/superpowers/specs/2026-09-13-forge-
// rendered-play-cards-design.md, Unit 3. Blob access is injected (RenderIO), so this module
// never imports @vercel/blob and its tests run on the committed OFL fonts.
//
// resvg-js 2.6.2 facts this relies on (probed 2026-09-13):
//  * fonts load only from FILE PATHS (`fontFiles`); the Node build ignores `fontBuffers`, so a
//    licensed face read from Blob is written to the OS temp dir first
//  * a family matches the font's name-ID-16 name (fontName.ts); an unmatched family silently
//    falls back to `defaultFontFamily`, so every licensed face is checked once per instance
//  * WebP <image>s are silently dropped, so frame assets are re-encoded to JPEG / PNG
//  * text holding an XML-invalid character fails to parse, so card strings are cleaned first
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import sharp from "sharp";
import { renderAsync, type ResvgRenderOptions } from "@resvg/resvg-js";
import CardSvg, { type CardSvgFonts } from "@/app/forge/components/CardSvg";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { framePaths } from "@/app/forge/lib/frameAssets";
import { CANVAS, RECTS } from "@/app/forge/lib/frameGeometry";
import { fontFamilyName } from "@/app/forge/lib/fontName";

export type PrivateFace = "title" | "stat";
export type RenderIO = {
  /** The licensed face's bytes from the private Blob store, or null when unavailable. */
  readPrivateFont: (face: PrivateFace) => Promise<Buffer | null>;
  /** The art's bytes; null when the blob is missing. May throw on a transient error. */
  readArt: (key: string) => Promise<Buffer | null>;
};
export type RenderInput = { data: DesignCard; artKey: string | null; year: number };
export type RenderOutput = { jpeg: Buffer; degraded: boolean };

/** An input could not be read (art blob missing or unreachable). Transient: never cached. */
export class RenderInputError extends Error {}

const PUBLIC_DIR = path.join(process.cwd(), "public");
const FONT_DIR = path.join(PUBLIC_DIR, "forge", "fonts");
const BODY_FILES = ["Arimo-Regular.ttf", "Arimo-Bold.ttf", "Arimo-Italic.ttf"];
// The browser's fallback for each licensed face (forge-fonts.css lists the same files second).
const OFL_FILES: Record<PrivateFace, string> = { title: "Mukta-ExtraBold.ttf", stat: "PTSerif-Bold.ttf" };

type Face = { file: string; family: string };

let bodyCache: Promise<Face[]> | null = null;
const oflCache = new Map<PrivateFace, Promise<Face>>();
const licensedCache = new Map<PrivateFace, Face>(); // successes only: a failed read is retried
const assetCache = new Map<string, Promise<string>>();

/** Test hook: forget every per-instance cache. */
export function _resetRenderCardCaches(): void {
  bodyCache = null;
  oflCache.clear();
  licensedCache.clear();
  assetCache.clear();
}

/** Remove characters XML 1.0 forbids: C0 controls other than tab, LF and CR; U+FFFE; U+FFFF;
 *  and unpaired surrogates. Browsers draw these; resvg's parser rejects the whole document. */
export function stripXmlInvalid(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) continue;
    out += s[i];
  }
  return out;
}

export function sanitizeDesignCard(card: DesignCard): DesignCard {
  const clean = (v: unknown): unknown =>
    typeof v === "string" ? stripXmlInvalid(v) : Array.isArray(v) ? v.map(clean) : v;
  return Object.fromEntries(Object.entries(card ?? {}).map(([k, v]) => [k, clean(v)])) as DesignCard;
}

async function diskFace(file: string): Promise<Face> {
  const full = path.join(FONT_DIR, file);
  const family = fontFamilyName(await readFile(full));
  if (!family) throw new Error(`no family name in ${file}`);
  return { file: full, family };
}

function bodyFaces(): Promise<Face[]> {
  if (!bodyCache) {
    bodyCache = Promise.all(BODY_FILES.map(diskFace));
    bodyCache.catch(() => { bodyCache = null; });
  }
  return bodyCache;
}

function oflFace(face: PrivateFace): Promise<Face> {
  let p = oflCache.get(face);
  if (!p) {
    p = diskFace(OFL_FILES[face]);
    p.catch(() => oflCache.delete(face));
    oflCache.set(face, p);
  }
  return p;
}

const probeSvg = (family: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60"><rect width="240" height="60" fill="#fff"/>` +
  `<text x="4" y="46" font-family="'${family.replace(/['"<>&]/g, "")}'" font-size="40">Rg 9/6</text></svg>`;

/** Whether `family` really selects a font in `fontFiles`, rather than falling back. */
async function familyMatches(family: string, fontFiles: string[], defaultFamily: string): Promise<boolean> {
  const opts: ResvgRenderOptions = { font: { loadSystemFonts: false, fontFiles, defaultFontFamily: defaultFamily } };
  const [named, missing] = await Promise.all([
    renderAsync(probeSvg(family), opts),
    renderAsync(probeSvg("zz no such family"), opts),
  ]);
  return !named.asPng().equals(missing.asPng());
}

async function licensedFace(face: PrivateFace, io: RenderIO, body: Face[]): Promise<{ face: Face; degraded: boolean }> {
  const known = licensedCache.get(face);
  if (known) return { face: known, degraded: false };
  const bytes = await io.readPrivateFont(face).catch(() => null);
  const family = bytes ? fontFamilyName(bytes) : null;
  if (bytes && family) {
    const dir = path.join(os.tmpdir(), "forge-render-fonts");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${face}-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.ttf`);
    await writeFile(file, bytes);
    if (await familyMatches(family, [...body.map((b) => b.file), file], body[0].family)) {
      const found = { file, family };
      licensedCache.set(face, found);
      return { face: found, degraded: false };
    }
  }
  return { face: await oflFace(face), degraded: true };
}

function assetDataUri(publicPath: string): Promise<string> {
  let p = assetCache.get(publicPath);
  if (!p) {
    p = (async () => {
      if (!publicPath.startsWith("/forge/frames/")) throw new Error(`not a frame asset: ${publicPath}`);
      const file = await readFile(path.join(PUBLIC_DIR, publicPath));
      // Washes are opaque textures, far smaller as JPEG; icons and badges carry alpha.
      if (publicPath.startsWith("/forge/frames/washes/")) {
        return `data:image/jpeg;base64,${(await sharp(file).jpeg({ quality: 92 }).toBuffer()).toString("base64")}`;
      }
      return `data:image/png;base64,${(await sharp(file).png().toBuffer()).toString("base64")}`;
    })();
    p.catch(() => assetCache.delete(publicPath));
    assetCache.set(publicPath, p);
  }
  return p;
}

async function artDataUri(key: string, io: RenderIO): Promise<string> {
  let bytes: Buffer | null;
  try {
    bytes = await io.readArt(key);
  } catch (err) {
    throw new RenderInputError(`art read failed: ${String(err)}`);
  }
  if (!bytes) throw new RenderInputError("art blob missing");
  const jpeg = await sharp(bytes)
    .rotate()
    .resize(Math.round(RECTS.art.w), Math.round(RECTS.art.h), { fit: "cover" })
    .jpeg({ quality: 90 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

export async function renderCardImage(input: RenderInput, io: RenderIO): Promise<RenderOutput> {
  const card = sanitizeDesignCard(input.data);
  const body = await bodyFaces();
  const [title, stat] = await Promise.all([licensedFace("title", io, body), licensedFace("stat", io, body)]);
  const art = input.artKey ? await artDataUri(input.artKey, io) : null;
  const hrefs = new Map(await Promise.all(framePaths(card).map(async (p) => [p, await assetDataUri(p)] as const)));
  const fonts: CardSvgFonts = {
    title: `'${title.face.family}'`,
    stat: `'${stat.face.family}'`,
    body: `'${body[0].family}'`,
  };
  const { renderToStaticMarkup } = await import("react-dom/server");
  const svg = renderToStaticMarkup(createElement(CardSvg, {
    card,
    idPrefix: "r",
    fonts,
    assetHref: (publicPath: string) => {
      const href = hrefs.get(publicPath);
      if (!href) throw new Error(`frame asset not preloaded: ${publicPath}`);
      return href;
    },
    noArt: art === null,
    annotations: false,
    year: input.year,
    rasters: { art },
  }));
  const rendered = await renderAsync(svg, {
    fitTo: { mode: "width", value: CANVAS.w },
    font: {
      loadSystemFonts: false,
      fontFiles: [...body.map((b) => b.file), title.face.file, stat.face.file],
      defaultFontFamily: body[0].family,
    },
  });
  const jpeg = await sharp(rendered.asPng()).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
  return { jpeg, degraded: title.degraded || stat.degraded };
}
