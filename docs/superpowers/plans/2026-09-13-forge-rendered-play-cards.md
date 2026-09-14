# Forge Rendered Play Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a released Forge card version has no uploaded finished image, every play surface (multiplayer, spectating, goldfish) shows its framed card, rendered on the server.

**Architecture:**
- The Forge preview's SVG is split into a server-safe `CardSvg` component. The browser `ForgeCardPreview` becomes a thin wrapper around it, and its DOM doesn't change.
- A server renderer (resvg + sharp) turns `CardSvg` into a JPEG. The art proxy gets a `kind=rendered` branch that caches that JPEG in private Blob, once per released version.
- `forgeProxyUrl` points cards without a finished image at that branch, and multiplayer clients warm their own deck's renders.

**Tech Stack:** Next.js 15 route handlers, React 19 `renderToStaticMarkup`, `@resvg/resvg-js` 2.6.2, `sharp`, `@vercel/blob` 2.4.1 (private store), Supabase RLS, vitest (node env).

**Spec:** `docs/superpowers/specs/2026-09-13-forge-rendered-play-cards-design.md` (revision 3, signed off by adversarial review). Read it before starting any task.

## Global Constraints

**Working tree and git**
- Work ONLY in the worktree `/Users/timestes/projects/rtt-forge-rendered` (branch `feat/forge-rendered-play-cards`), using absolute paths. Never touch `/Users/timestes/projects/redemption-tournament-tracker` or any other `rtt-*` directory.
- The worktree has its own real `node_modules`. `@resvg/resvg-js@2.6.2` is already installed; `package.json` and `package-lock.json` are modified but not committed, and Task 3 commits them.
- Stage files by name only (`git add <file> ...`). Never `git add -A`, `.` or `-a`.
- Every commit message ends with the trailer line: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

**Tests and builds**
- Run tests with `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run <paths>`. Vitest is node-only (no DOM).
- Don't run `next build` except where Task 7 says to.

**Code rules**
- tsconfig has `strict: false`, so discriminated-union narrowing on `if (r.ok)` does not work. Use `r.ok === false`.
- Under `app/forge/**`, use plain `<img>`, never `next/image` (a guardrail test enforces this).
- **Leak spine:**
  - Blob keys never reach a client.
  - The art route returns the same `notFoundResponse()` for every failure.
  - Nothing new is written to SpacetimeDB rows.
- **Pinned values:**
  - `RENDER_VERSION = 1`
  - Cache key: `forge-rendered/r1/<versionId>.jpg`
  - Rendered URL: `/forge/api/art/<cardId>?v=approved&kind=rendered&t=<versionId>.r1`
- **resvg-js 2.6.2 facts, probed 2026-09-13:**
  - Fonts load only through `fontFiles` (paths); `fontBuffers` is ignored by the Node build.
  - Families match the font's name-ID-16 name.
  - WebP `<image>`s are silently dropped.
  - Kerning is only turned off by `style="font-kerning:none"`.
  - XML-invalid characters in text make parsing throw.
- Source files must not contain literal control characters. Build any control character with `String.fromCharCode(n)`.

## File Map

**Create**
- `app/forge/lib/renderVersion.ts` — `RENDER_VERSION`, `renderedToken`, `isCurrentRenderToken`, `renderedCacheKey`. Client-safe, pure.
- `app/forge/components/CardSvg.tsx` — the card frame and text as one SVG. No hooks and no `"use client"`. It is a full standalone document when `rasters` is given.
- `app/forge/lib/fontName.ts` — `fontFamilyName(buffer)`, which parses a font's name table.
- `app/forge/lib/renderCard.ts` — `renderCardImage(input, io)`: fonts, frame assets, art, then resvg, then sharp. Also `sanitizeDesignCard`, `stripXmlInvalid`, `RenderInputError`.
- `app/forge/lib/renderedCard.ts` — `renderAndStore(...)`: per-instance coalescing, a negative cache, Blob IO wiring and storing the result. Server-only.
- `app/play/utils/warmForgeRenders.ts` — `warmForgeRenders(urls, concurrency)`: fire-and-forget fetches.

**Create (tests)**
- `app/forge/lib/__tests__/renderVersion.test.ts`
- `app/forge/lib/__tests__/frameAssetsRender.test.ts`
- `app/forge/components/__tests__/CardSvg.test.ts`
- `app/forge/lib/__tests__/fontName.test.ts`
- `app/forge/lib/__tests__/renderCard.test.ts`
- `app/forge/lib/__tests__/renderedCard.test.ts`
- `app/forge/lib/__tests__/frameAssetsTrace.test.ts`
- `app/play/utils/__tests__/warmForgeRenders.test.ts`

**Modify**
- `app/forge/lib/frameAssets.ts` — add `washBands`, `framePaths`.
- `app/forge/components/ForgeCardPreview.tsx` — becomes a wrapper around `CardSvg`; same DOM.
- `app/forge/components/__tests__/ForgeCardPreview.test.ts` — add NO ART assertions.
- `app/forge/lib/art.ts` and `app/forge/lib/__tests__/art.test.ts` — add `uploadForgeRendered`.
- `app/forge/api/art/[cardId]/route.ts` and `.../__tests__/route.test.ts` — the `kind=rendered` branch.
- `__tests__/forge-gate-first.test.ts` — `ALT_GATE` becomes a list of patterns that must all match.
- `next.config.js` — `serverExternalPackages` and `outputFileTracingIncludes`.
- `app/play/utils/forgeResolver.ts` — `forgeProxyUrl` switch and new `forgeRenderWarmUrls`.
- `app/forge/lib/playDecks.ts` — drop `hasArt`.
- `app/forge/lib/playSerialize.ts` — comment only.
- `app/play/utils/__tests__/forgeResolver.test.ts`, `app/play/utils/__tests__/cardAdapterForge.test.ts`, `app/forge/lib/__tests__/playSerialize.test.ts` — fixtures and URLs.
- `app/play/[code]/client.tsx` — the warm-up.

---

### Task 1: Pure helpers (render version, wash bands, frame paths)

**Files:**
- Create: `app/forge/lib/renderVersion.ts`
- Modify: `app/forge/lib/frameAssets.ts` (append two exports at the end of the file)
- Test: `app/forge/lib/__tests__/renderVersion.test.ts`, `app/forge/lib/__tests__/frameAssetsRender.test.ts`

**Interfaces:**
- Consumes: `washPaths`, `iconBox`, `classIcons` (already in `frameAssets.ts`); `DesignCard` from `designCard.ts`.
- Produces:
  - `RENDER_VERSION: number` (= 1)
  - `renderedToken(versionId: string): string`
  - `isCurrentRenderToken(t: string | null): boolean`
  - `renderedCacheKey(versionId: string): string`
  - `washBands(n: number): ({ from: number; to: number } | null)[]`
  - `framePaths(card: DesignCard): string[]`

- [ ] **Step 1: Write the failing tests**

`app/forge/lib/__tests__/renderVersion.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RENDER_VERSION, renderedToken, isCurrentRenderToken, renderedCacheKey } from "../renderVersion";

describe("renderVersion", () => {
  it("stamps the version id with the renderer version", () => {
    expect(renderedToken("v-1")).toBe(`v-1.r${RENDER_VERSION}`);
  });
  it("only calls this renderer's token current", () => {
    expect(isCurrentRenderToken(renderedToken("v-1"))).toBe(true);
    expect(isCurrentRenderToken(`v-1.r${RENDER_VERSION + 1}`)).toBe(false);
    expect(isCurrentRenderToken(`v-1.r${RENDER_VERSION}0`)).toBe(false);
    expect(isCurrentRenderToken("v-1")).toBe(false);
    expect(isCurrentRenderToken(null)).toBe(false);
  });
  it("keys the Blob cache by renderer version and version id", () => {
    expect(renderedCacheKey("abc")).toBe(`forge-rendered/r${RENDER_VERSION}/abc.jpg`);
  });
});
```

`app/forge/lib/__tests__/frameAssetsRender.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { washBands, framePaths } from "../frameAssets";

describe("washBands", () => {
  it("has no fade for the top wash", () => {
    expect(washBands(1)).toEqual([null]);
  });
  it("fades a second brigade in from 40% to 60%", () => {
    expect(washBands(2)).toEqual([null, { from: 40, to: 60 }]);
  });
  it("puts three brigades' edges at thirds, each fade 40% / 3 wide", () => {
    const [top, a, b] = washBands(3);
    expect(top).toBeNull();
    expect(a!.from).toBeCloseTo(100 / 3 - 20 / 3, 6);
    expect(a!.to).toBeCloseTo(40, 6);
    expect(b!.from).toBeCloseTo(60, 6);
    expect(b!.to).toBeCloseTo(200 / 3 + 20 / 3, 6);
  });
});

describe("framePaths", () => {
  it("lists a hero's washes, box icon and class icons once each, in draw order", () => {
    expect(framePaths({
      cardType: ["Hero"], brigades: ["Blue", "Green"], strength: 5, toughness: 5,
      class: ["Warrior", "Weapon"], icons: ["Territory"],
    })).toEqual([
      "/forge/frames/washes/blue.webp",
      "/forge/frames/washes/green.webp",
      "/forge/frames/icons/cross.png",
      "/forge/frames/icons/warrior.png",
      "/forge/frames/icons/weapon.png",
      "/forge/frames/icons/territory.png",
    ]);
  });
  it("includes a Covenant's left icon and right chalice badge", () => {
    const paths = framePaths({ cardType: ["Covenant"], alignment: "Good" });
    expect(paths).toContain("/forge/frames/icons/bible.png");
    expect(paths).toContain("/forge/frames/badges/artifact.webp");
  });
  it("has nothing to load for a Lost Soul's box (it has none) beyond its wash", () => {
    expect(framePaths({ cardType: ["LostSoul"] })).toEqual(["/forge/frames/washes/lost-soul.webp"]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/forge/lib/__tests__/renderVersion.test.ts app/forge/lib/__tests__/frameAssetsRender.test.ts`

Expected: FAIL. `renderVersion` can't be resolved, and `washBands` / `framePaths` are not exported.

- [ ] **Step 3: Create `app/forge/lib/renderVersion.ts`**

```ts
// Rendered play cards (docs/superpowers/specs/2026-09-13-forge-rendered-play-cards-design.md).
// A released version's rendered card is cached in private Blob, and in players' browsers,
// under RENDER_VERSION. BUMP IT whenever a render would come out different:
//  * CardSvg.tsx or anything it draws with (frameAssets, frameGeometry, textFit, fontMetrics)
//  * the frame kit images under public/forge/frames
//  * a re-upload of the private title/stat fonts (bump forge-fonts.css ?v= at the same time)
//  * a re-run of scripts/forge-normalize-images.ts (it rewrites card_versions.art_key in place)
export const RENDER_VERSION = 1;

/** The `t` cache-buster a rendered-card URL carries. */
export const renderedToken = (versionId: string): string => `${versionId}.r${RENDER_VERSION}`;

/** Whether a request's `t` names this deploy's renderer. Only then is a render immutable. */
export const isCurrentRenderToken = (t: string | null): boolean =>
  !!t && t.endsWith(`.r${RENDER_VERSION}`);

/** Private Blob key of a version's cached render. */
export const renderedCacheKey = (versionId: string): string =>
  `forge-rendered/r${RENDER_VERSION}/${versionId}.jpg`;
```

- [ ] **Step 4: Append to the end of `app/forge/lib/frameAssets.ts`**

```ts
/** Where each wash blends in, as percentages of the border rect's height: nothing for the top
 *  wash, then a fade from `from` to `to` for each further one. Edges sit at i/n of the height
 *  and each fade is 40% / n wide, so two brigades fade 40% to 60%. The browser preview's CSS
 *  masks and the server renderer's SVG masks both come from here. */
export function washBands(n: number): ({ from: number; to: number } | null)[] {
  return Array.from({ length: n }, (_, i) => {
    if (i === 0) return null;
    const edge = (100 * i) / n, half = 20 / n;
    return { from: edge - half, to: edge + half };
  });
}

/** Every frame-kit image a card's render draws (washes, icon-box badges and icons, class
 *  icons), deduplicated, as public paths. The server renderer inlines exactly these. */
export function framePaths(card: DesignCard): string[] {
  const out = new Set<string>(washPaths(card));
  for (const side of ["left", "right"] as const) {
    const box = iconBox(card, side);
    if (box?.badge) out.add(box.badge);
    if (box?.icon) out.add(box.icon);
  }
  for (const c of classIcons(card)) out.add(c.src);
  return [...out];
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run the command from Step 2. Expected: PASS, 9 tests.

If the Lost Soul expectation fails because `washPaths` returns a different slug, check `specialWash` in `frameAssets.ts`. Correct the **test** only if the code's path points at a real file under `public/forge/frames/washes/`.

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-forge-rendered
git add app/forge/lib/renderVersion.ts app/forge/lib/frameAssets.ts app/forge/lib/__tests__/renderVersion.test.ts app/forge/lib/__tests__/frameAssetsRender.test.ts
git commit -m "feat(forge): render version token and frame asset lists for rendered play cards

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Extract `CardSvg`; `ForgeCardPreview` becomes a wrapper with an unchanged DOM

**Files:**
- Create: `app/forge/components/CardSvg.tsx`
- Modify: `app/forge/components/ForgeCardPreview.tsx` (whole file replaced)
- Test: `app/forge/components/__tests__/CardSvg.test.ts` (new); `app/forge/components/__tests__/ForgeCardPreview.test.ts` (append one describe)
- Temporary, never committed: `app/forge/components/__tests__/zz-parity.test.ts`

**Interfaces:**
- Consumes: `washBands`, `washPaths`, `iconBox`, `classIcons`, `isPreviewApproximate` (`frameAssets.ts`); `RENDER_VERSION` (Task 1).
- Produces, from `app/forge/components/CardSvg.tsx`:
  - `default function CardSvg(props: CardSvgProps)`
  - `export const INK`
  - `export type CardSvgFonts = { title: string; stat: string; body: string }`
  - `export type CardSvgProps = { card: DesignCard; idPrefix: string; fonts: CardSvgFonts; assetHref: (publicPath: string) => string; noArt: boolean; annotations: boolean; year: number; rasters: null | { art: string | null } }`
- Refinement of spec Unit 1: `rasters` carries only `art`. In raster mode `CardSvg` takes the washes from `washPaths(card)` through `assetHref`.

- [ ] **Step 1: Snapshot today's preview markup, before touching the component**

Create `app/forge/components/__tests__/zz-parity.test.ts`:

```ts
// TEMPORARY (Task 2 only, never commit): proves the CardSvg extraction leaves
// ForgeCardPreview's markup byte-identical. First run writes the snapshot; later runs compare.
import { it, expect } from "vitest";
import React from "react";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import ForgeCardPreview from "@/app/forge/components/ForgeCardPreview";
import { GOOD_BRIGADES, type DesignCard } from "@/app/forge/lib/designCard";

const SNAPSHOT = "/private/tmp/claude-501/-Users-timestes-projects-redemption-tournament-tracker/d48743d6-f4e8-4141-a7a5-e556b625990b/scratchpad/preview-parity.json";
const CARDS: DesignCard[] = [
  {},
  { name: "Michael, Dragon Slayer", cardType: ["Hero"], brigades: ["Silver", "Blue"], strength: 12, toughness: 8, class: ["Warrior", "Weapon"], icons: ["Territory"], identifiers: ["Angel"], rawText: "Protect your heroes.", scripture: "And there was war in heaven.", reference: "Revelation 12:7", artistCredit: "Someone" },
  { name: "Wormwood", cardType: ["EvilCharacter"], brigades: ["Crimson", "EvilGold", "Gray"], strength: 7, toughness: 6 },
  { name: "A Really Lost Soul", cardType: ["LostSoul"], rawText: "Each upkeep, give this card to a player." },
  { name: "Covenant with Noah", cardType: ["Covenant"], alignment: "Good", strength: 2, toughness: 2 },
  { name: "Holy Writ", cardType: ["Artifact"], identifiers: ["Idol"], rawText: "During battle, you may discard this card to capture an evil character in battle." },
  { name: "Good Old Days", cardType: ["GE"], brigades: [...GOOD_BRIGADES], legality: "Classic" },
  { name: "A Very Long Card Name That Must Squeeze Its Glyphs Hard", cardType: ["Dominant"], alignment: "Evil", rawText: "word ".repeat(200) },
];

it("ForgeCardPreview markup is unchanged by the CardSvg extraction", () => {
  const html = CARDS.flatMap((card) => [
    renderToStaticMarkup(React.createElement(ForgeCardPreview, { card })),
    renderToStaticMarkup(React.createElement(ForgeCardPreview, { card, artUrl: "/forge/api/art/x?t=1" })),
  ]);
  if (!existsSync(SNAPSHOT)) {
    writeFileSync(SNAPSHOT, JSON.stringify(html));
    return;
  }
  expect(html).toEqual(JSON.parse(readFileSync(SNAPSHOT, "utf8")));
});
```

Run: `cd /Users/timestes/projects/rtt-forge-rendered && rm -f /private/tmp/claude-501/-Users-timestes-projects-redemption-tournament-tracker/d48743d6-f4e8-4141-a7a5-e556b625990b/scratchpad/preview-parity.json && npx vitest run app/forge/components/__tests__/zz-parity.test.ts`

Expected: PASS, and the snapshot JSON file now exists.

- [ ] **Step 2: Write the failing `CardSvg` tests**

Create `app/forge/components/__tests__/CardSvg.test.ts`:

```ts
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
    const without = render(props({ cardType: ["Artifact"] }, { noArt: true, rasters: { art: null } }));
    expect(without).not.toContain('href="data:art"');
    expect(without).toContain("NO ART");
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
    expect({ RENDER_VERSION, hash }).toEqual({ RENDER_VERSION: 1, hash: "RECORD_ON_FIRST_GREEN_RUN" });
  });
});
```


Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/forge/components/__tests__/CardSvg.test.ts`

Expected: FAIL (cannot resolve `@/app/forge/components/CardSvg`).

- [ ] **Step 3: Create `app/forge/components/CardSvg.tsx`**

```tsx
// The Forge card frame as one <svg viewBox="0 0 750 1050">: chrome (text box, window outline,
// frame border, icon boxes, class icons, title) and the card's text, drawn from the live
// DesignCard. No "use client" and no hooks, so the server renderer (app/forge/lib/renderCard.ts)
// can render it: a route handler cannot call a client module's export.
//
// Two uses:
//  * ForgeCardPreview (browser) passes `rasters={null}`. The wash and art layers stay lazy HTML
//    <img>s under this overlay, and CSS font stacks name forge-fonts.css's @font-face families.
//  * renderCard (server) passes `rasters={{ art }}`. The svg becomes a standalone document that
//    also draws the washes and the art as <image>s underneath, for resvg.
//
// Rendered play cards are cached under RENDER_VERSION (app/forge/lib/renderVersion.ts). Bump it
// whenever this file's output changes.
//
// Coordinates: everything is laid out in the 750x1050 canvas from frameGeometry. Text must not be
// sized in container units (cqw): WebKit multiplies those by the page-zoom factor a second time,
// so a Safari reader with a remembered per-site zoom saw the ability run off the text box.

import type { DesignCard, StatValue } from "@/app/forge/lib/designCard";
import {
  washPaths, washBands, iconBox, classIcons, isPreviewApproximate, type IconBox,
} from "@/app/forge/lib/frameAssets";
import { textFit, textWidth, TEXT_WIDTH, TEXT_METRICS as TM } from "@/app/forge/lib/textFit";
import { CANVAS, RECTS, BORDER_STROKE } from "@/app/forge/lib/frameGeometry";

const { w: CW, h: CH } = CANVAS;
export const INK = "#231f20"; // the template's 100% K through its SWOP profile
// ForgeTitle (Symphony Black from the private font route, cap height 0.73em) averages ~0.53em
// per character; TITLE_EM adds a hair for the stroke and is used to size and squeeze titles.
// Sizes are cap heights measured off printed cards (title ~26 px, stats ~22 px on the canvas).
const TITLE_EM = 0.57;
const TITLE_MAX = 36, TITLE_MIN = 25;
// Printed titles: a black contour all the way around the letter, plus a hard shadow offset to
// the lower right (canvas px). The contour is a fixed width in the print template, not a share
// of the type size, so it reads heavier on the smaller type a long name shrinks to — which is
// what the printed cards show. TITLE_PAD keeps the contour and the shadow out of the clip.
const TITLE_SHADOW = { dx: 3, dy: 3, spread: 1.0 };
const TITLE_EDGE = 3;
const TITLE_PAD = 4;
// Arimo's ascent and descent (hhea, per em). A CSS line box puts its baseline half-leading
// plus ascent below its top; the printed text metrics were measured against line boxes laid
// out that way, so the SVG lines use the same arithmetic to land where they always have.
const FONT_ASC = 1854 / 2048, FONT_DESC = 434 / 2048;
const baselineIn = (top: number, lineHeight: number, size: number) =>
  top + (lineHeight - (FONT_ASC + FONT_DESC) * size) / 2 + FONT_ASC * size;
// The fit / approximate annotations, which are ours and not on the printed card.
const PILL = { size: 16, padX: 8, h: 22, gap: 4, r: 6, x: CW * 0.025, bottom: CH * 0.988 };

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r?: number };

export type CardSvgFonts = { title: string; stat: string; body: string };
export type CardSvgProps = {
  card: DesignCard;
  /** Prefix for clip/gradient/mask/filter ids; must be alphanumeric. */
  idPrefix: string;
  fonts: CardSvgFonts;
  /** Maps a frame-kit public path (/forge/frames/...) to the href to draw it from. */
  assetHref: (publicPath: string) => string;
  /** Label the art window NO ART. */
  noArt: boolean;
  /** Draw the Forge's own "doesn't fit" / "preview approximate" pills. */
  annotations: boolean;
  year: number;
  /** null: overlay only (browser). Otherwise a standalone document with washes and art. */
  rasters: null | { art: string | null };
};

function statText(s: StatValue | undefined, t: StatValue | undefined): string {
  const f = (v: StatValue | undefined) => (v === null || v === undefined || v === "" ? "?" : String(v));
  return `${f(s)}/${f(t)}`;
}

/** Trim `text` to `width` with an ellipsis, the way `text-overflow: ellipsis` would. */
function clampText(text: string, size: number, width: number): string {
  if (textWidth(text, "bold", size) <= width) return text;
  let s = text;
  while (s && textWidth(`${s}…`, "bold", size) > width) s = s.slice(0, -1);
  return `${s}…`;
}

// Icon box: a rounded tab in the frame corner, drawn over the border the way printed boxes
// are (they overhang it by a hair). The outer corner follows the card corner; the other
// three are tighter. Fill is the brigade color (banded top to bottom, one band per brigade)
// or a badge; stats sit in the top band, the type icon at the template's slot.
const BOX_R = 22, BOX_OUTER_R = 42;
function tabPath({ x, y, w, h }: Rect, side: "left" | "right"): string {
  const [tl, tr] = side === "left" ? [BOX_OUTER_R, BOX_R] : [BOX_R, BOX_OUTER_R];
  const r = BOX_R;
  return `M${x + tl} ${y}H${x + w - tr}A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
    + `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`;
}

function IconBoxG({ id, box, rect, side, stat, statFont, assetHref }: {
  id: string; box: IconBox; rect: Rect; side: "left" | "right"; stat: string | null;
  statFont: string; assetHref: (publicPath: string) => string;
}) {
  const { x, y, w, h } = rect;
  const d = tabPath(rect, side);
  // Each band below the first runs to the bottom over the one before. Two brigades split the
  // box 45 / 55 (the top band holds the stats); three or more split it evenly, as printed.
  const n = box.bands.length + 1;
  const first = n === 2 ? 0.45 : 1 / n;
  const bandTop = (i: number) => y + h * (first + (i * (1 - first)) / (n - 1));
  // Printed stats: one size whether "9/6" or "10/11" (digits ~27 px tall, tops 6 px below the
  // box top, centred), no outline; only an unusually long value gives ground.
  const statSize = stat && stat.length > 6 ? 30 : 41;
  return (
    <g>
      <clipPath id={id}><path d={d} /></clipPath>
      <path d={d} fill={box.fill} />
      {box.bands.map((fill, i) => (
        <rect key={i} x={x} y={bandTop(i)} width={w} height={y + h - bandTop(i)} fill={fill} clipPath={`url(#${id})`} />
      ))}
      {box.badge && (
        <image href={assetHref(box.badge)} x={x} y={y} width={w} height={h} preserveAspectRatio={`${box.badgeAlign} slice`} clipPath={`url(#${id})`} />
      )}
      {box.icon && box.iconRect && (
        <image href={assetHref(box.icon)} x={box.iconRect.x} y={box.iconRect.y} width={box.iconRect.w} height={box.iconRect.h} preserveAspectRatio="xMidYMid meet" />
      )}
      <path d={d} fill="none" stroke={INK} strokeWidth={4} />
      {stat && (
        <text
          x={x + w / 2 + (side === "left" ? -2 : 2)} y={y + 34} textAnchor="middle"
          fontFamily={statFont} fontSize={statSize}
          fill={box.darkText ? INK : "#fff"}
        >
          {stat}
        </text>
      )}
    </g>
  );
}

// Server-only layers, under the chrome: white card, the washes clipped to the border (each
// brigade after the first fades in through a luminance mask, black to white over washBands —
// the same bands as the browser preview's CSS masks), and the art window (cover-cropped).
function RasterLayers({ card, idPrefix, assetHref, art }: {
  card: DesignCard; idPrefix: string; assetHref: (publicPath: string) => string; art: string | null;
}) {
  const B = RECTS.border, A = RECTS.art;
  const washes = washPaths(card);
  const bands = washBands(washes.length);
  return (
    <>
      <rect x={0} y={0} width={CW} height={CH} fill="#fff" />
      <defs>
        <clipPath id={`${idPrefix}wb`}><rect x={B.x} y={B.y} width={B.w} height={B.h} rx={B.r} /></clipPath>
        <clipPath id={`${idPrefix}wa`}><rect x={A.x} y={A.y} width={A.w} height={A.h} rx={A.r} /></clipPath>
        {bands.map((band, i) => band && (
          <g key={i}>
            <linearGradient id={`${idPrefix}wg${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={band.from / 100} stopColor="#000" />
              <stop offset={band.to / 100} stopColor="#fff" />
            </linearGradient>
            <mask id={`${idPrefix}wm${i}`} maskUnits="userSpaceOnUse" x={B.x} y={B.y} width={B.w} height={B.h}>
              <rect x={B.x} y={B.y} width={B.w} height={B.h} fill={`url(#${idPrefix}wg${i})`} />
            </mask>
          </g>
        ))}
      </defs>
      <g clipPath={`url(#${idPrefix}wb)`}>
        {washes.length === 0 && <rect x={B.x} y={B.y} width={B.w} height={B.h} fill="#b9b3aa" />}
        {washes.map((src, i) => (
          <image
            key={i} href={assetHref(src)} x={B.x} y={B.y} width={B.w} height={B.h} preserveAspectRatio="xMidYMid slice"
            {...(bands[i] ? { mask: `url(#${idPrefix}wm${i})` } : {})}
          />
        ))}
      </g>
      <g clipPath={`url(#${idPrefix}wa)`}>
        <rect x={A.x} y={A.y} width={A.w} height={A.h} fill="#fff" />
        {art && <image href={art} x={A.x} y={A.y} width={A.w} height={A.h} preserveAspectRatio="xMidYMid slice" />}
      </g>
    </>
  );
}

export default function CardSvg({
  card, idPrefix, fonts, assetHref, noArt, annotations, year, rasters,
}: CardSvgProps) {
  const uid = idPrefix;
  const left = iconBox(card, "left");
  const right = iconBox(card, "right");
  const classes = classIcons(card);
  const fit = textFit(card);
  const approximate = isPreviewApproximate(card);

  const A = RECTS.art, B = RECTS.border, T = RECTS.textBox, I = RECTS.textInset;
  const name = card.name?.trim() || "Card Name";
  // Title: right-aligned, or centered between the boxes when there is a right box (as
  // printed Covenants / Curses are). Shrinks for long names, then squeezes the glyphs the
  // way printed cards condense long titles.
  const titleLeft = RECTS.title.x;
  const titleRight = right ? RECTS.rightBox.x - 12 : titleLeft + RECTS.title.w;
  const titleAvail = titleRight - titleLeft;
  const titleWidth = (size: number) => name.length * size * TITLE_EM;
  const titleSize = titleWidth(TITLE_MAX) > titleAvail ? Math.max(TITLE_MIN, (TITLE_MAX * titleAvail) / titleWidth(TITLE_MAX)) : TITLE_MAX;
  const titleSqueeze = titleWidth(titleSize) > titleAvail;
  const ids = card.identifiers ?? [];
  const stat = left?.withStats ? statText(card.strength, card.toughness) : null;

  // Ability: the lines textFit wrapped, at the printed size, top-anchored and never shrunk,
  // so the picture and the fit verdict agree. A long one runs into the verse, and the pill
  // at the bottom says by how much.
  const abilityRows: { text: string; y: number }[] = [];
  let abilityTop = T.y + TM.ability.top;
  fit.paragraphs.forEach((lines, p) => {
    if (p) abilityTop += TM.ability.paragraphGap;
    for (const text of lines) {
      abilityRows.push({ text, y: baselineIn(abilityTop, TM.ability.pitch, TM.ability.size) });
      abilityTop += TM.ability.pitch;
    }
  });

  // Verse: stacked up from the fixed reference line on the dark part of the box, and
  // justified the way print does it — every line but the last stretches its word spaces.
  const verseRows = fit.verseLines.map((text, i) => {
    const top = T.y + fit.verseTop + i * TM.verse.pitch;
    const spaces = text.split(" ").length - 1;
    const slack = TEXT_WIDTH - textWidth(text, "italic", TM.verse.size);
    const last = i === fit.verseLines.length - 1;
    return {
      text,
      y: baselineIn(top, TM.verse.pitch, TM.verse.size),
      wordSpacing: !last && spaces > 0 && slack > 0 ? slack / spaces : 0,
    };
  });

  // Credits: two right-aligned lines resting on the bottom of their slot.
  const C = RECTS.credits;
  const credits = [
    { text: `Illus. ${card.artistCredit?.trim() || "Artist Unknown"}`, size: 15 },
    { text: `© ${year} Cactus Game Design, Inc.`, size: 13 },
  ];
  let creditBottom = C.y + C.h;
  const creditRows = credits
    .slice()
    .reverse()
    .map(({ text, size }) => {
      const lineHeight = size * 1.3;
      creditBottom -= lineHeight;
      return { text: clampText(text, size, C.w), size, y: baselineIn(creditBottom, lineHeight, size) };
    })
    .reverse();

  // Identifier bubble — a pill straddling the art window and the text box.
  const ID = RECTS.idBubble;
  const idSize = 19, idPadX = 16;
  const idText = ids.length ? clampText(ids.join(", "), idSize, ID.w - 2 * idPadX) : "";
  const idW = idText ? Math.min(ID.w, textWidth(idText, "bold", idSize) + 2 * idPadX) : 0;

  const pills = annotations ? [
    ...(fit.over > 0 ? [{ key: "over", text: `Ability doesn't fit · ${fit.over} line${fit.over === 1 ? "" : "s"} over`, fill: "rgba(179,38,30,.92)" }] : []),
    ...(approximate ? [{ key: "approximate", text: "preview approximate", fill: "rgba(0,0,0,.7)" }] : []),
  ] : [];

  return (
    <svg
      viewBox={`0 0 ${CW} ${CH}`} aria-hidden="true"
      {...(rasters
        ? { xmlns: "http://www.w3.org/2000/svg", width: CW, height: CH }
        : { style: { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" } })}
    >
      {rasters && <RasterLayers card={card} idPrefix={uid} assetHref={assetHref} art={rasters.art} />}
      <defs>
        <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.8" />
          <stop offset={fit.gradient.light / T.h} stopColor="#fff" stopOpacity="0.8" />
          <stop offset={fit.gradient.dark / T.h} stopColor={INK} stopOpacity="1" />
          <stop offset="1" stopColor={INK} stopOpacity="1" />
        </linearGradient>
        <filter id={`${uid}s`} x="-20%" y="-40%" width="140%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="1" floodColor="#000" floodOpacity="0.8" />
        </filter>
      </defs>
      <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill={`url(#${uid}g)`} stroke={INK} strokeWidth={2.5} />
      <rect x={A.x} y={A.y} width={A.w} height={A.h} rx={A.r} fill="none" stroke={INK} strokeWidth={4} />
      <rect x={B.x} y={B.y} width={B.w} height={B.h} rx={B.r} fill="none" stroke={INK} strokeWidth={BORDER_STROKE} />
      {left && <IconBoxG id={`${uid}l`} box={left} rect={RECTS.leftBox} side="left" stat={stat} statFont={fonts.stat} assetHref={assetHref} />}
      {right && <IconBoxG id={`${uid}r`} box={right} rect={RECTS.rightBox} side="right" stat={null} statFont={fonts.stat} assetHref={assetHref} />}
      {classes.map((c) => (
        <image key={c.src} href={assetHref(c.src)} x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} preserveAspectRatio="xMidYMid meet" />
      ))}
      <clipPath id={`${uid}t`}><rect x={titleLeft - TITLE_PAD} y={RECTS.title.y - 12} width={titleAvail + 2 * TITLE_PAD} height={RECTS.title.h + 24} /></clipPath>
      {/* Title: a white face carrying a black contour, over a dark copy of itself offset to
            the lower right — the two things that make printed names read on any wash. */}
      {[TITLE_SHADOW, null].map((shadow, i) => (
        <text
          key={i}
          x={right ? (titleLeft + titleRight) / 2 : titleRight} y={RECTS.title.y + 42} textAnchor={right ? "middle" : "end"}
          clipPath={`url(#${uid}t)`} fontFamily={fonts.title} fontSize={titleSize}
          fill={shadow ? INK : "#fff"} stroke={INK} strokeWidth={shadow ? TITLE_SHADOW.spread : TITLE_EDGE} paintOrder="stroke" style={{ paintOrder: "stroke" }}
          transform={shadow ? `translate(${shadow.dx} ${shadow.dy})` : undefined}
          {...(titleSqueeze ? { textLength: titleAvail, lengthAdjust: "spacingAndGlyphs" as const } : {})}
        >
          {name}
        </text>
      ))}

      <g fontFamily={fonts.body} style={{ fontKerning: "none" }}>
        {noArt && (
          <text
            x={A.x + A.w / 2} y={baselineIn(A.y + (A.h - 26 * 1.4) / 2, 26 * 1.4, 26)} textAnchor="middle"
            fontSize={26} letterSpacing={26 * 0.14} fill="#a9adc9"
          >
            NO ART
          </text>
        )}

        {/* identifier bubble */}
        {idText && (
          <g>
            <rect
              x={ID.x + (ID.w - idW) / 2} y={ID.y} width={idW} height={ID.h} rx={ID.h / 2}
              fill="rgba(0,0,0,0.75)" stroke={INK} strokeWidth={1.5}
            />
            <text
              x={ID.x + ID.w / 2} y={baselineIn(ID.y + (ID.h - idSize) / 2, idSize, idSize)} textAnchor="middle"
              fontSize={idSize} fontWeight={700} fill="#fff"
            >
              {idText}
            </text>
          </g>
        )}

        {/* ability */}
        {abilityRows.map((row, i) => (
          <text key={i} x={I.x + I.w / 2} y={row.y} textAnchor="middle" fontSize={TM.ability.size} fontWeight={700} fill={INK}>
            {row.text}
          </text>
        ))}

        {/* verse and its reference */}
        {verseRows.map((row, i) => (
          <text
            key={i} x={I.x} y={row.y} fontSize={TM.verse.size} fontStyle="italic" fill="#f2efe4"
            {...(row.wordSpacing ? { wordSpacing: row.wordSpacing } : {})}
          >
            {row.text}
          </text>
        ))}
        {card.reference && (
          <text
            x={I.x + I.w} y={baselineIn(T.y + TM.reference.top, TM.reference.size, TM.reference.size)} textAnchor="end"
            fontSize={TM.reference.size} fontWeight={700} fill="#f2efe4"
          >
            {card.reference}
          </text>
        )}

        {/* credits */}
        <g filter={`url(#${uid}s)`} fill="#fff" fontWeight={700}>
          {creditRows.map((row, i) => (
            <text key={i} x={C.x + C.w} y={row.y} textAnchor="end" fontSize={row.size}>{row.text}</text>
          ))}
        </g>

        {/* our own annotations, stacked up from the bottom-left corner */}
        {pills.map((pill, i) => {
          const w = textWidth(pill.text, "bold", PILL.size) + 2 * PILL.padX;
          const top = PILL.bottom - (pills.length - i) * PILL.h - (pills.length - 1 - i) * PILL.gap;
          return (
            <g key={pill.key} {...(pill.key === "over" ? { "data-fit": "over" } : {})}>
              <rect x={PILL.x} y={top} width={w} height={PILL.h} rx={PILL.r} fill={pill.fill} />
              <text
                x={PILL.x + PILL.padX} y={baselineIn(top, PILL.h, PILL.size)}
                fontSize={PILL.size} fontWeight={700} fill="#fff"
              >
                {pill.text}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
```

The overlay body above is a verbatim move of `ForgeCardPreview.tsx` as of `origin/main` 886035e0, lines 139-352. The only changes are:
- `uid` now comes from the `idPrefix` prop;
- `STAT_FONT`, `TITLE_FONT` and `BODY_FONT` become `fonts.stat`, `fonts.title` and `fonts.body`;
- `COPYRIGHT_YEAR` becomes `year`;
- `!artUrl` becomes `noArt`;
- the pills are gated on `annotations`;
- the badge, icon and class-icon hrefs go through `assetHref`;
- the `<svg>` attributes switch on `rasters`, and `RasterLayers` is added.

If the current file differs from this snapshot, move the current code and apply the same substitutions.

- [ ] **Step 4: Replace `app/forge/components/ForgeCardPreview.tsx`**

```tsx
"use client";

import { useId, type CSSProperties } from "react";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { washPaths, washBands } from "@/app/forge/lib/frameAssets";
import { CANVAS, RECTS } from "@/app/forge/lib/frameGeometry";
import CardSvg, { INK } from "@/app/forge/components/CardSvg";

// Rough rendered card: the design team's frame (washes / icons / badges from the kit, chrome
// drawn as SVG from the template's geometry) around the live DesignCard. It is a draft for
// designers, not the print graphic — see the 2026-09-09 live-preview spec. The frame and all
// of the text are CardSvg, which the server renderer shares for play cards; this wrapper adds
// the wash and art layers underneath as lazy <img>s, so a big set grid only loads what shows.
// Plain <img> only (never next/image — the forge-no-next-image guardrail; art stays on the
// authed proxy).

const { w: CW, h: CH } = CANVAS;
const COPYRIGHT_YEAR = new Date().getFullYear();
const FONTS = {
  title: "ForgeTitle, 'Trebuchet MS', 'Segoe UI', sans-serif",
  stat: "ForgeStat, Georgia, 'Times New Roman', serif",
  body: "ForgeBody, system-ui, sans-serif",
};

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r?: number };

const pctX = (px: number) => `${(px / CW) * 100}%`;
const pctY = (px: number) => `${(px / CH) * 100}%`;
const place = (r: Rect): CSSProperties => ({
  position: "absolute", left: pctX(r.x), top: pctY(r.y), width: pctX(r.w), height: pctY(r.h),
});
/** A rect's corner radius as percentages of its own box, so it scales with the card. */
const radius = (r: Rect) => `${((r.r ?? 0) / r.w) * 100}% / ${((r.r ?? 0) / r.h) * 100}%`;
const identity = (publicPath: string) => publicPath;

// eslint-disable-next-line @next/next/no-img-element
const Img = (p: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt="" loading="lazy" decoding="async" {...p} />;

export default function ForgeCardPreview({
  card, artUrl, className,
}: { card: DesignCard; artUrl?: string | null; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const washes = washPaths(card);
  const bands = washBands(washes.length);
  const B = RECTS.border, A = RECTS.art;

  return (
    <div
      className={className}
      role="img"
      aria-label={card.name ? `Card preview: ${card.name}` : "Card preview"}
      style={{
        position: "relative", aspectRatio: `${CW} / ${CH}`, width: "100%",
        overflow: "hidden", borderRadius: "3.73% / 2.67%", background: "#fff", color: INK,
        fontFamily: FONTS.body, userSelect: "none",
      }}
    >
      {/* 1. wash(es) inside the border rect: each further brigade blends in below the one
            before, in equal bands, in the order of the icon box's bands. Each fade spans
            40% / N of the height, so two brigades fade 40% to 60%. */}
      {washes.length === 0 && <div style={{ ...place(B), borderRadius: radius(B), background: "#b9b3aa" }} />}
      {washes.map((src, i) => {
        const band = bands[i];
        const mask = band ? `linear-gradient(to bottom, transparent ${band.from}%, #000 ${band.to}%)` : null;
        return (
          <Img key={i} src={src} style={{
            ...place(B), borderRadius: radius(B), objectFit: "cover",
            ...(mask ? { WebkitMaskImage: mask, maskImage: mask } : {}),
          }} />
        );
      })}

      {/* 2. art window: uploaded art clipped to the window, or the template's empty white slot
            (the "NO ART" label is drawn with the rest of the text, in the canvas below) */}
      <div style={{ ...place(A), borderRadius: radius(A), overflow: "hidden", background: "#fff" }}>
        {artUrl && <Img src={artUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>

      {/* 3. everything else, in canvas coordinates: CardSvg */}
      <CardSvg
        card={card} idPrefix={uid} fonts={FONTS} assetHref={identity}
        noArt={!artUrl} annotations year={COPYRIGHT_YEAR} rasters={null}
      />
    </div>
  );
}
```

- [ ] **Step 5: Run parity and `CardSvg` tests; record the hash**

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/forge/components/__tests__/zz-parity.test.ts app/forge/components/__tests__/CardSvg.test.ts app/forge/components/__tests__/ForgeCardPreview.test.ts`

Expected:
- `zz-parity` PASSES (markup byte-identical). If it fails, diff the two JSON arrays and fix `CardSvg` or the wrapper until identical; never regenerate the snapshot.
- Every `CardSvg` test PASSES except "RENDER_VERSION guard", which fails showing the actual hash.

Copy that 64-character hex hash into the test in place of `RECORD_ON_FIRST_GREEN_RUN`, and run again. Expected: all PASS.

- [ ] **Step 6: Add the NO ART test to `ForgeCardPreview.test.ts`**

Append at the end of `app/forge/components/__tests__/ForgeCardPreview.test.ts`:

```ts
describe("ForgeCardPreview art window", () => {
  it("labels the empty art window NO ART only when there is no art", () => {
    const card: DesignCard = { name: "Holy Writ", cardType: ["Artifact"] };
    expect(renderToStaticMarkup(React.createElement(ForgeCardPreview, { card }))).toContain("NO ART");
    const withArt = renderToStaticMarkup(React.createElement(ForgeCardPreview, { card, artUrl: "/forge/api/art/x" }));
    expect(withArt).not.toContain("NO ART");
    expect(withArt).toContain('src="/forge/api/art/x"');
  });
});
```

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/forge/components/__tests__/ app/forge/lib/__tests__/frameAssets.test.ts`

Expected: all PASS.

- [ ] **Step 7: Remove the temporary parity test and commit**

```bash
cd /Users/timestes/projects/rtt-forge-rendered
rm app/forge/components/__tests__/zz-parity.test.ts
git add app/forge/components/CardSvg.tsx app/forge/components/ForgeCardPreview.tsx app/forge/components/__tests__/CardSvg.test.ts app/forge/components/__tests__/ForgeCardPreview.test.ts
git status --short   # zz-parity.test.ts must not appear
git commit -m "refactor(forge): draw the card frame in a server-safe CardSvg

ForgeCardPreview keeps its exact markup (checked byte for byte) and wraps
CardSvg, so the server can render the same frame for play cards.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Server renderer (`fontFamilyName`, `renderCardImage`)

**Files:**
- Create: `app/forge/lib/fontName.ts`, `app/forge/lib/renderCard.ts`
- Test: `app/forge/lib/__tests__/fontName.test.ts`, `app/forge/lib/__tests__/renderCard.test.ts`
- Commit also: `package.json`, `package-lock.json` (the already-installed `@resvg/resvg-js@2.6.2`)

**Interfaces:**
- Consumes:
  - `CardSvg`, `CardSvgFonts` (Task 2)
  - `framePaths` (Task 1)
  - `CANVAS`, `RECTS` from `frameGeometry.ts`
- Produces, from `app/forge/lib/fontName.ts`:
  - `fontFamilyName(font: Buffer): string | null`
- Produces, from `app/forge/lib/renderCard.ts`:
  - `type PrivateFace = "title" | "stat"`
  - `type RenderIO = { readPrivateFont: (face: PrivateFace) => Promise<Buffer | null>; readArt: (key: string) => Promise<Buffer | null> }`
  - `type RenderInput = { data: DesignCard; artKey: string | null; year: number }`
  - `type RenderOutput = { jpeg: Buffer; degraded: boolean }`
  - `class RenderInputError extends Error`
  - `renderCardImage(input: RenderInput, io: RenderIO): Promise<RenderOutput>`
  - `stripXmlInvalid(s: string): string`
  - `sanitizeDesignCard(card: DesignCard): DesignCard`
  - `_resetRenderCardCaches(): void`

- [ ] **Step 1: Write the failing `fontFamilyName` test**

Create `app/forge/lib/__tests__/fontName.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fontFamilyName } from "../fontName";

const font = (file: string) => readFileSync(path.join(process.cwd(), "public/forge/fonts", file));

describe("fontFamilyName", () => {
  it("prefers the typographic family (name ID 16), which is what resvg matches", () => {
    expect(fontFamilyName(font("Mukta-ExtraBold.ttf"))).toBe("Mukta");
  });
  it("falls back to the legacy family (name ID 1)", () => {
    expect(fontFamilyName(font("Arimo-Regular.ttf"))).toBe("Arimo");
    expect(fontFamilyName(font("Arimo-Italic.ttf"))).toBe("Arimo");
    expect(fontFamilyName(font("PTSerif-Bold.ttf"))).toBe("PT Serif");
  });
  it("returns null for bytes that are not a font", () => {
    expect(fontFamilyName(Buffer.from("definitely not a font file"))).toBeNull();
  });
});
```

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/forge/lib/__tests__/fontName.test.ts`

Expected: FAIL (cannot resolve `../fontName`).

- [ ] **Step 2: Create `app/forge/lib/fontName.ts`**

```ts
// The family name a font file registers under in resvg's font database (fontdb): the
// typographic family (name ID 16) when the font has one, else the legacy family (name ID 1).
// Probe 2026-09-13: font-family "Mukta" (ID 16) selected Mukta-ExtraBold.ttf, while
// "Mukta ExtraBold" (ID 1) silently fell back to the default font.
export function fontFamilyName(font: Buffer): string | null {
  if (font.length < 12) return null;
  const numTables = font.readUInt16BE(4);
  let nameTable = -1;
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (record + 16 > font.length) return null;
    if (font.toString("latin1", record, record + 4) === "name") {
      nameTable = font.readUInt32BE(record + 8);
      break;
    }
  }
  if (nameTable < 0 || nameTable + 6 > font.length) return null;
  const count = font.readUInt16BE(nameTable + 2);
  const stringsStart = nameTable + font.readUInt16BE(nameTable + 4);
  const found = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const r = nameTable + 6 + i * 12;
    if (r + 12 > font.length) break;
    const platform = font.readUInt16BE(r);
    const language = font.readUInt16BE(r + 4);
    const nameId = font.readUInt16BE(r + 6);
    const length = font.readUInt16BE(r + 8);
    const offset = font.readUInt16BE(r + 10);
    if (nameId !== 16 && nameId !== 1) continue;
    const start = stringsStart + offset;
    if (start + length > font.length) continue;
    const raw = font.subarray(start, start + length);
    if (platform === 3 && language === 0x409) found.set(`${nameId}:win`, utf16be(raw));
    else if (platform === 1 && language === 0) found.set(`${nameId}:mac`, raw.toString("latin1"));
  }
  const name = found.get("16:win") ?? found.get("16:mac") ?? found.get("1:win") ?? found.get("1:mac");
  return name ? name : null;
}

function utf16be(raw: Buffer): string {
  if (raw.length % 2 === 1) return "";
  return Buffer.from(raw).swap16().toString("utf16le"); // copy first: swap16 is in place
}
```

Run the Step 1 command. Expected: PASS, 3 tests. If Arimo or PT Serif print a different family, check the name table with `fontTools`, or print `found` temporarily. Only change the expectation if resvg itself matches the name the parser returns (see Step 5's family-match test).

- [ ] **Step 3: Write the failing renderer tests**

Create `app/forge/lib/__tests__/renderCard.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
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
```

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/forge/lib/__tests__/renderCard.test.ts`

Expected: FAIL (cannot resolve `../renderCard`).

- [ ] **Step 4: Create `app/forge/lib/renderCard.ts`**

```ts
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
```

- [ ] **Step 5: Run the renderer tests and confirm they pass**

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/forge/lib/__tests__/renderCard.test.ts app/forge/lib/__tests__/fontName.test.ts`

Expected: PASS.

If "draws the title in the licensed face it was given" fails, the family name isn't selecting the font. Print the SVG's `font-family` attributes and `title.face`, fix the name handling, and never loosen the test.

If a region test fails narrowly, write the two JPEGs to the scratchpad and look at them before adjusting a region. The regions come from `RECTS` and must stay inside the element they check.

- [ ] **Step 6: Commit**

```bash
cd /Users/timestes/projects/rtt-forge-rendered
git add package.json package-lock.json app/forge/lib/fontName.ts app/forge/lib/renderCard.ts app/forge/lib/__tests__/fontName.test.ts app/forge/lib/__tests__/renderCard.test.ts
git commit -m "feat(forge): render a card version to a JPEG on the server with resvg

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Store renders in Blob (`uploadForgeRendered`, `renderAndStore`)

**Files:**
- Modify: `app/forge/lib/art.ts` (one constant, one function)
- Create: `app/forge/lib/renderedCard.ts`
- Test: `app/forge/lib/__tests__/art.test.ts` (append), `app/forge/lib/__tests__/renderedCard.test.ts` (new)

**Interfaces:**
- Consumes:
  - `renderCardImage`, `RenderInputError`, `RenderIO`, `RenderOutput` (Task 3)
  - `readForgeArt`, `readForgeFont` (existing `art.ts`)
- Produces, in `art.ts`:
  - `uploadForgeRendered(key: string, jpeg: Buffer): Promise<void>`
- Produces, in `renderedCard.ts`:
  - `type RenderJob = { cacheKey: string; cardId: string; versionId: string; data: DesignCard; artKey: string | null; year: number }`
  - `renderAndStore(job: RenderJob, io?: RenderIO): Promise<RenderOutput | null>`
  - `blobRenderIO: RenderIO`
  - `_resetRenderedCardState(): void`

- [ ] **Step 1: Write the failing tests**

In `app/forge/lib/__tests__/art.test.ts`, add `uploadForgeRendered` to the existing `from "../art"` import list. Then append:

```ts
describe("uploadForgeRendered", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores the JPEG privately under its exact key, overwriting an identical concurrent render", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    await uploadForgeRendered("forge-rendered/r1/v1.jpg", jpeg);
    expect(put).toHaveBeenCalledWith("forge-rendered/r1/v1.jpg", jpeg, expect.objectContaining({
      access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg",
    }));
    // forgeAuth must ride along, or the SDK falls back to the PUBLIC store's default token.
    const opts = (put as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect("token" in opts || "storeId" in opts).toBe(true);
  });

  it("refuses any key outside forge-rendered/", async () => {
    await expect(uploadForgeRendered("forge-art/x", Buffer.from([1]))).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});
```

Create `app/forge/lib/__tests__/renderedCard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@/app/forge/lib/art", () => ({ readForgeArt: vi.fn(), readForgeFont: vi.fn(), uploadForgeRendered: vi.fn() }));
vi.mock("@/app/forge/lib/renderCard", () => {
  class RenderInputError extends Error {}
  return { renderCardImage: vi.fn(), RenderInputError };
});

import { renderAndStore, _resetRenderedCardState } from "../renderedCard";
import { renderCardImage, RenderInputError } from "@/app/forge/lib/renderCard";
import { uploadForgeRendered } from "@/app/forge/lib/art";

const job = { cacheKey: "forge-rendered/r1/v1.jpg", cardId: "c1", versionId: "v1", data: { name: "X" }, artKey: null, year: 2026 };
const io = { readPrivateFont: vi.fn(), readArt: vi.fn() };
const ok = { jpeg: Buffer.from([1, 2, 3]), degraded: false };

describe("renderAndStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRenderedCardState();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it("renders once for concurrent requests and stores the result", async () => {
    let release!: (v: typeof ok) => void;
    (renderCardImage as Mock).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const a = renderAndStore(job, io);
    const b = renderAndStore(job, io);
    release(ok);
    expect(await a).toBe(ok);
    expect(await b).toBe(ok);
    expect(renderCardImage).toHaveBeenCalledTimes(1);
    expect(renderCardImage).toHaveBeenCalledWith({ data: job.data, artKey: null, year: 2026 }, io);
    expect(uploadForgeRendered).toHaveBeenCalledWith(job.cacheKey, ok.jpeg);
  });

  it("serves a degraded render but never stores it", async () => {
    const degraded = { jpeg: Buffer.from([9]), degraded: true };
    (renderCardImage as Mock).mockResolvedValue(degraded);
    expect(await renderAndStore(job, io)).toBe(degraded);
    expect(uploadForgeRendered).not.toHaveBeenCalled();
  });

  it("still serves the render when storing it fails", async () => {
    (renderCardImage as Mock).mockResolvedValue(ok);
    (uploadForgeRendered as Mock).mockRejectedValue(new Error("blob down"));
    expect(await renderAndStore(job, io)).toBe(ok);
  });

  it("does not remember a transient input failure", async () => {
    (renderCardImage as Mock).mockRejectedValueOnce(new RenderInputError("art blob missing")).mockResolvedValueOnce(ok);
    expect(await renderAndStore(job, io)).toBeNull();
    expect(await renderAndStore(job, io)).toBe(ok);
  });

  it("remembers a deterministic failure for five minutes", async () => {
    vi.useFakeTimers();
    (renderCardImage as Mock).mockRejectedValue(new Error("SVG data parsing failed"));
    expect(await renderAndStore(job, io)).toBeNull();
    expect(await renderAndStore(job, io)).toBeNull();
    expect(renderCardImage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    (renderCardImage as Mock).mockResolvedValue(ok);
    expect(await renderAndStore(job, io)).toBe(ok);
  });
});
```

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/forge/lib/__tests__/art.test.ts app/forge/lib/__tests__/renderedCard.test.ts`

Expected: FAIL. `uploadForgeRendered` is not exported, and `../renderedCard` cannot be resolved.

- [ ] **Step 2: Add `uploadForgeRendered` to `app/forge/lib/art.ts`**

Directly under `const FINISHED_PREFIX = "forge-finished/";` add:

```ts
const RENDERED_PREFIX = "forge-rendered/";
```

After the `uploadForgeArtRaw` function add:

```ts
/** Store a rendered play card (renderedCard.ts) under its deterministic cache key. Overwrites
 *  on purpose: two instances can render the same version at once, and both renders are equal. */
export async function uploadForgeRendered(key: string, jpeg: Buffer): Promise<void> {
  if (!key.startsWith(RENDERED_PREFIX)) throw new Error(`not a rendered-card key: ${key}`);
  await put(key, jpeg, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    ...forgeAuth,
    contentType: "image/jpeg",
  });
}
```

- [ ] **Step 3: Create `app/forge/lib/renderedCard.ts`**

```ts
// SERVER-ONLY. The render-on-miss half of the art proxy's kind=rendered branch (spec Unit 5.3-5.4).
// One render per cache key per instance at a time (concurrent requests share it); good renders
// are stored in the private Forge Blob store; deterministic failures are remembered for a few
// minutes so a card that cannot render is not re-rendered on every retry (goldfish re-requests a
// failed image on every zone change). The route owns the gate: call this only after it passed.
import type { GetBlobResult } from "@vercel/blob";
import { readForgeArt, readForgeFont, uploadForgeRendered } from "@/app/forge/lib/art";
import { renderCardImage, RenderInputError, type RenderIO, type RenderOutput } from "@/app/forge/lib/renderCard";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type RenderJob = {
  cacheKey: string; cardId: string; versionId: string;
  data: DesignCard; artKey: string | null; year: number;
};

const NEGATIVE_TTL_MS = 5 * 60_000;
const inflight = new Map<string, Promise<RenderOutput | null>>();
const failedUntil = new Map<string, number>();

/** Test hook. */
export function _resetRenderedCardState(): void {
  inflight.clear();
  failedUntil.clear();
}

async function blobBytes(result: GetBlobResult | null): Promise<Buffer | null> {
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export const blobRenderIO: RenderIO = {
  readPrivateFont: async (face) => blobBytes(await readForgeFont(face)),
  readArt: async (key) => blobBytes(await readForgeArt(key)),
};

/** Render a version's card and store it unless degraded. null means respond 404. */
export function renderAndStore(job: RenderJob, io: RenderIO = blobRenderIO): Promise<RenderOutput | null> {
  if ((failedUntil.get(job.cacheKey) ?? 0) > Date.now()) return Promise.resolve(null);
  let pending = inflight.get(job.cacheKey);
  if (!pending) {
    pending = run(job, io).finally(() => inflight.delete(job.cacheKey));
    inflight.set(job.cacheKey, pending);
  }
  return pending;
}

async function run(job: RenderJob, io: RenderIO): Promise<RenderOutput | null> {
  const where = { cardId: job.cardId, versionId: job.versionId };
  let out: RenderOutput;
  try {
    out = await renderCardImage({ data: job.data, artKey: job.artKey, year: job.year }, io);
  } catch (err) {
    const transient = err instanceof RenderInputError;
    if (!transient) failedUntil.set(job.cacheKey, Date.now() + NEGATIVE_TTL_MS);
    console.error("[forge] card render failed", { ...where, transient, error: String(err).slice(0, 300) });
    return null;
  }
  if (out.degraded) {
    console.error("[forge] card rendered with fallback fonts (licensed face unavailable); not cached", where);
    return out;
  }
  try {
    await uploadForgeRendered(job.cacheKey, out.jpeg);
  } catch (err) {
    console.error("[forge] storing rendered card failed", { ...where, error: String(err).slice(0, 300) });
  }
  return out;
}
```

If `GetBlobResult`'s `stream` isn't nullable in the installed typings, keep the `!result.stream` guard anyway (it's harmless). Check `node_modules/@vercel/blob/dist/*.d.ts` only if TypeScript complains.

- [ ] **Step 4: Run the tests and confirm they pass**

Run the Step 1 command. Expected: PASS (all existing `art.test.ts` tests plus 7 new ones).

- [ ] **Step 5: Commit**

```bash
cd /Users/timestes/projects/rtt-forge-rendered
git add app/forge/lib/art.ts app/forge/lib/renderedCard.ts app/forge/lib/__tests__/art.test.ts app/forge/lib/__tests__/renderedCard.test.ts
git commit -m "feat(forge): cache rendered play cards in the private Forge Blob store

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Art proxy `kind=rendered` branch, gate tests, bundling config

**Files:**
- Modify: `app/forge/api/art/[cardId]/route.ts`
- Modify: `app/forge/api/art/[cardId]/__tests__/route.test.ts`
- Modify: `__tests__/forge-gate-first.test.ts`
- Modify: `next.config.js`
- Create: `app/forge/lib/__tests__/frameAssetsTrace.test.ts`

**Interfaces:**
- Consumes: `renderedCacheKey`, `isCurrentRenderToken`, `RENDER_VERSION` (Task 1); `renderAndStore` (Task 4); `framePaths` (Task 1); `readForgeArt`, `notFoundResponse` (existing).
- Produces: `GET /forge/api/art/<cardId>?v=approved&kind=rendered&t=<versionId>.r<RENDER_VERSION>`. The response is a JPEG, or the uniform 404.

- [ ] **Step 1: Write the failing route tests**

In `app/forge/api/art/[cardId]/__tests__/route.test.ts`:

(a) Change the first import line to:
```ts
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
```

(b) Under the existing `vi.mock("@/app/forge/lib/art", ...)` line, add:
```ts
// The renderer is never loaded in these tests (it would pull in resvg); the route imports it
// dynamically only on a cache miss.
vi.mock("@/app/forge/lib/renderedCard", () => ({ renderAndStore: vi.fn() }));
```

(c) Under the existing `import { readForgeArt } from "@/app/forge/lib/art";` add:
```ts
import { renderAndStore } from "@/app/forge/lib/renderedCard";
import { RENDER_VERSION } from "@/app/forge/lib/renderVersion";
```

(d) Replace the whole `mockSupabase` function with:
```ts
function mockSupabase(opts: {
  user?: boolean; artKey?: string | null; candidateKey?: string | null; rpcError?: boolean;
  role?: string | null; card?: unknown; version?: unknown;
}) {
  const rpc = vi.fn((fn: string) => {
    if (fn === "forge_art_key") {
      return Promise.resolve(
        opts.rpcError
          ? { data: null, error: { message: "boom" } }
          : { data: opts.artKey ?? null, error: null },
      );
    }
    if (fn === "forge_candidate_art_key") {
      return Promise.resolve({ data: opts.candidateKey ?? null, error: null });
    }
    if (fn === "my_forge_role") {
      return Promise.resolve({ data: opts.role === undefined ? "playtester" : opts.role, error: null });
    }
    // forge_log_art_download audit
    return Promise.resolve({ data: null, error: null });
  });
  const from = vi.fn((table: string) => {
    const chain: Record<string, Mock> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: (table === "forge_cards" ? opts.card : opts.version) ?? null, error: null }),
    );
    return chain;
  });
  const getUser = vi.fn().mockResolvedValue(
    opts.user === false
      ? { data: { user: null }, error: { message: "no session" } }
      : { data: { user: { id: "u1" } }, error: null },
  );
  const client = { auth: { getUser }, rpc, from };
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return client;
}
```

(e) Append at the end of the file:
```ts
describe("GET /forge/api/art/[cardId]?kind=rendered", () => {
  beforeEach(() => vi.clearAllMocks());

  const VID = "22222222-3333-4444-5555-666666666666";
  const TOKEN = `${VID}.r${RENDER_VERSION}`;
  const KEY = `forge-rendered/r${RENDER_VERSION}/${VID}.jpg`;
  const released = { approved: null, published: { id: VID } };
  const get = (qs: string) =>
    GET(new Request(`http://localhost/forge/api/art/abc?${qs}`) as never, { params: Promise.resolve({ cardId: "abc" }) });
  const jpegBlob = () => ({ statusCode: 200, stream: new ReadableStream(), blob: { contentType: "image/jpeg" } });

  // The leak adversarial review found: RLS does not check membership, so a removed member
  // (leftover forge_set_grants row, or owner_id) still gets the card row back.
  it("404s a signed-in non-member even when RLS returns the card, before touching Blob or the renderer", async () => {
    mockSupabase({ role: null, card: released });
    const res = await get(`v=approved&kind=rendered&t=${TOKEN}`);
    expect(res.status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
    expect(renderAndStore).not.toHaveBeenCalled();
  });

  it("404s without a session", async () => {
    mockSupabase({ user: false, card: released });
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("404s unless v=approved, and for download=1", async () => {
    mockSupabase({ card: released });
    expect((await get(`kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect((await get(`v=approved&kind=rendered&download=1`)).status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("404s when no released version is visible", async () => {
    mockSupabase({ card: { approved: null, published: null } });
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    mockSupabase({ card: null });
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect(readForgeArt).not.toHaveBeenCalled();
  });

  it("serves a cached render, immutable only for this renderer's token", async () => {
    mockSupabase({ card: released });
    (readForgeArt as Mock).mockResolvedValue(jpegBlob());
    const res = await get(`v=approved&kind=rendered&t=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(readForgeArt).toHaveBeenCalledWith(KEY);
    expect(renderAndStore).not.toHaveBeenCalled();

    (readForgeArt as Mock).mockResolvedValue(jpegBlob());
    const skewed = await get(`v=approved&kind=rendered&t=${VID}.r${RENDER_VERSION + 1}`);
    expect(skewed.headers.get("cache-control")).toBe("private, no-store");
  });

  it("prefers the approved version over the published one", async () => {
    mockSupabase({ card: { approved: { id: "approved-v" }, published: { id: "published-v" } } });
    (readForgeArt as Mock).mockResolvedValue(jpegBlob());
    await get(`v=approved&kind=rendered&t=approved-v.r${RENDER_VERSION}`);
    expect(readForgeArt).toHaveBeenCalledWith(`forge-rendered/r${RENDER_VERSION}/approved-v.jpg`);
  });

  it("404s on a Blob outage without rendering", async () => {
    mockSupabase({ card: released, version: { data: {}, art_key: null, created_at: "2026-01-01T00:00:00Z" } });
    (readForgeArt as Mock).mockRejectedValue(new Error("blob down"));
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect(renderAndStore).not.toHaveBeenCalled();
  });

  it("renders on a miss from the version's data, art key and release year", async () => {
    mockSupabase({ card: released, version: { data: { name: "Holy Writ" }, art_key: "forge-art/k", created_at: "2025-11-02T10:00:00Z" } });
    (readForgeArt as Mock).mockResolvedValue(null);
    (renderAndStore as Mock).mockResolvedValue({ jpeg: Buffer.from([1, 2, 3]), degraded: false });
    const res = await get(`v=approved&kind=rendered&t=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(renderAndStore).toHaveBeenCalledWith({
      cacheKey: KEY, cardId: "abc", versionId: VID, data: { name: "Holy Writ" }, artKey: "forge-art/k", year: 2025,
    });
  });

  it("never lets the browser keep a degraded render", async () => {
    mockSupabase({ card: released, version: { data: {}, art_key: null, created_at: "2026-01-01T00:00:00Z" } });
    (readForgeArt as Mock).mockResolvedValue(null);
    (renderAndStore as Mock).mockResolvedValue({ jpeg: Buffer.from([1]), degraded: true });
    const res = await get(`v=approved&kind=rendered&t=${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("404s when the version row is not visible or the render fails", async () => {
    mockSupabase({ card: released, version: null });
    (readForgeArt as Mock).mockResolvedValue(null);
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
    expect(renderAndStore).not.toHaveBeenCalled();

    mockSupabase({ card: released, version: { data: {}, art_key: null, created_at: "2026-01-01T00:00:00Z" } });
    (readForgeArt as Mock).mockResolvedValue(null);
    (renderAndStore as Mock).mockResolvedValue(null);
    expect((await get(`v=approved&kind=rendered&t=${TOKEN}`)).status).toBe(404);
  });
});
```

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run "app/forge/api/art/[cardId]/__tests__/route.test.ts"`

Expected: the existing 12 tests PASS and the new `kind=rendered` tests FAIL, because the route treats `kind=rendered` as working art.

- [ ] **Step 2: Implement the branch in `app/forge/api/art/[cardId]/route.ts`**

(a) Add to the imports:
```ts
import { isCurrentRenderToken, renderedCacheKey } from "@/app/forge/lib/renderVersion";
```

(b) Below `export const dynamic = "force-dynamic";` add:
```ts
const IMMUTABLE = "private, max-age=31536000, immutable";
const NO_STORE = "private, no-store";
const MEMBER_ROLES = new Set(["superadmin", "elder", "playtester"]);
type Supabase = Awaited<ReturnType<typeof createClient>>;
```

(c) In `GET`, directly after `const url = new URL(req.url);`, add:
```ts
  if (url.searchParams.get("kind") === "rendered") return renderedCard(supabase, cardId, url);
```

(d) Append after `GET`:
```ts
// kind=rendered: the card the server renderer draws for a released version with no uploaded
// finished image (docs/superpowers/specs/2026-09-13-forge-rendered-play-cards-design.md, Unit 5).
// RLS alone is NOT a gate here: it doesn't check membership, so a removed member's live session
// still passes the owner / granted-set policies. my_forge_role() is the member gate
// forge_art_key (066) runs; it runs in parallel with the lookup, so it adds no round trip.
async function renderedCard(supabase: Supabase, cardId: string, url: URL): Promise<Response> {
  if (url.searchParams.get("v") !== "approved" || url.searchParams.get("download") === "1") {
    return notFoundResponse();
  }
  const [{ data: userData, error: userError }, { data: role }, { data: card }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("my_forge_role"),
    supabase
      .from("forge_cards")
      .select("approved:card_versions!fk_approved(id), published:card_versions!fk_published(id)")
      .eq("id", cardId)
      .maybeSingle(),
  ]);
  if (userError || !userData?.user) return notFoundResponse();
  if (typeof role !== "string" || !MEMBER_ROLES.has(role)) return notFoundResponse();
  // The embedded version rows only come back when RLS lets the caller see them.
  const refs = card as { approved?: { id: string } | null; published?: { id: string } | null } | null;
  const versionId = refs?.approved?.id ?? refs?.published?.id;
  if (!versionId) return notFoundResponse();

  const cacheKey = renderedCacheKey(versionId);
  // Immutable only when the URL names this deploy's renderer: a client and server on different
  // RENDER_VERSIONs mid-deploy must not pin the other one's render for a year.
  const immutable = isCurrentRenderToken(url.searchParams.get("t"));

  let cached;
  try {
    cached = await readForgeArt(cacheKey);
  } catch {
    return notFoundResponse(); // Blob outage: transient, nothing remembered
  }
  if (cached && cached.statusCode === 200) {
    return new Response(cached.stream, {
      headers: { "Content-Type": cached.blob.contentType, "Cache-Control": immutable ? IMMUTABLE : NO_STORE },
    });
  }

  const { data: version } = await supabase
    .from("card_versions")
    .select("data, art_key, created_at")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) return notFoundResponse();

  const { renderAndStore } = await import("@/app/forge/lib/renderedCard");
  const out = await renderAndStore({
    cacheKey,
    cardId,
    versionId,
    data: version.data ?? {},
    artKey: version.art_key ?? null,
    year: new Date(version.created_at).getUTCFullYear(),
  });
  if (!out) return notFoundResponse();
  return new Response(new Uint8Array(out.jpeg), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": immutable && !out.degraded ? IMMUTABLE : NO_STORE },
  });
}
```

Leave the rest of `GET` unchanged. Its existing `wantApproved`, `kind` and `candidateId` logic still serves art, finished and candidate images.

- [ ] **Step 3: Tighten `__tests__/forge-gate-first.test.ts`**

Replace the `ALT_GATE` declaration, including its comment, with:
```ts
// Routes whose gate lives elsewhere must match EVERY one of their gate calls.
const ALT_GATE: Record<string, RegExp[]> = {
  // Member role check + RLS run inside the forge_art_key RPC (migration 066); a null key 404s.
  // The kind=rendered branch runs the same role check itself (my_forge_role), because RLS alone
  // lets a removed member's live session through. This is only a substring check; the real
  // guard is route.test.ts "404s a signed-in non-member even when RLS returns the card".
  "app/forge/api/art/[cardId]/route.ts": [/rpc[(] *["']forge_art_key["']/, /rpc[(] *["']my_forge_role["']/],
};
```

Replace the body of the per-file `it(...)` callback with:
```ts
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const gates = ALT_GATE[f] ?? [GATE];
      for (const gate of gates) {
        expect(gate.test(src), `${f} must call its Forge gate (${gate})`).toBe(true);
      }
```

- [ ] **Step 4: Bundle config in `next.config.js`**

Replace `serverExternalPackages: ['@vercel/blob'],` with:
```js
  // @resvg/resvg-js (the Forge rendered-play-card renderer) is a native addon that loads a
  // per-platform .node binary at runtime; bundling it breaks that lookup.
  serverExternalPackages: ['@vercel/blob', '@resvg/resvg-js'],
```

Inside `outputFileTracingIncludes`, after the `'/api/v1/generate-decklist-image'` entry, add:
```js
    // The art route's kind=rendered branch reads the frame kit and the committed fonts from
    // disk (app/forge/lib/renderCard.ts). frameAssetsTrace.test.ts checks this list.
    '/forge/api/art/[cardId]': [
      './public/forge/frames/washes/**',
      './public/forge/frames/icons/**',
      './public/forge/frames/badges/**',
      './public/forge/fonts/*.ttf',
    ],
```

- [ ] **Step 5: Add the frame-asset coverage test**

Create `app/forge/lib/__tests__/frameAssetsTrace.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { framePaths } from "../frameAssets";
import {
  ALIGNMENTS, BRIGADES, CARD_TYPES, CLASSES, ICONS, GOOD_BRIGADES, EVIL_BRIGADES, type DesignCard,
} from "../designCard";

// The server renderer reads frame assets from disk inside the art route's function bundle.
// next.config.js traces only these directories into it; an asset elsewhere would pass locally
// and fail on Vercel with ENOENT.
const TRACED = ["/forge/frames/washes/", "/forge/frames/icons/", "/forge/frames/badges/"];

function everyCard(): DesignCard[] {
  const brigadeSets: DesignCard["brigades"][] = [
    [], ...BRIGADES.map((b) => [b]), ["Blue", "Green"], ["Crimson", "EvilGold", "Gray"], [...GOOD_BRIGADES], [...EVIL_BRIGADES],
  ];
  const cards: DesignCard[] = [];
  for (const cardType of CARD_TYPES) {
    for (const alignment of ALIGNMENTS) {
      for (const brigades of brigadeSets) {
        cards.push({ cardType: [cardType], alignment, brigades, strength: 1, toughness: 1, class: [...CLASSES], icons: [...ICONS] });
      }
    }
  }
  return cards;
}

describe("frame assets the server renderer reads", () => {
  const paths = new Set(everyCard().flatMap(framePaths));

  it("covers a real spread of the kit", () => {
    expect(paths.size).toBeGreaterThan(20);
  });

  it("all sit in directories next.config.js traces into the art route", () => {
    for (const p of paths) expect(TRACED.some((dir) => p.startsWith(dir)), p).toBe(true);
    const config = readFileSync(path.join(process.cwd(), "next.config.js"), "utf8");
    for (const dir of TRACED) expect(config).toContain(`./public${dir}**`);
    expect(config).toContain("./public/forge/fonts/*.ttf");
  });

  it("all exist on disk", () => {
    for (const p of paths) expect(existsSync(path.join(process.cwd(), "public", p)), p).toBe(true);
  });
});
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run "app/forge/api/art/[cardId]/__tests__/route.test.ts" __tests__/forge-gate-first.test.ts app/forge/lib/__tests__/frameAssetsTrace.test.ts`

Expected: PASS. That is 12 existing plus 10 new route tests, every gate-first file, and 3 coverage tests.

Sanity check the guard: temporarily delete the `MEMBER_ROLES` check line in `route.ts` and re-run `route.test.ts`. "404s a signed-in non-member…" must FAIL. Restore the line and re-run: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/timestes/projects/rtt-forge-rendered
git add "app/forge/api/art/[cardId]/route.ts" "app/forge/api/art/[cardId]/__tests__/route.test.ts" __tests__/forge-gate-first.test.ts next.config.js app/forge/lib/__tests__/frameAssetsTrace.test.ts
git commit -m "feat(forge): serve rendered play cards from the art proxy behind the member gate

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 6: Point play at rendered cards, drop `hasArt`, warm renders in multiplayer

**Files:**
- Modify: `app/play/utils/forgeResolver.ts`, `app/forge/lib/playDecks.ts`, `app/forge/lib/playSerialize.ts` (comment only), `app/play/[code]/client.tsx`
- Create: `app/play/utils/warmForgeRenders.ts`
- Test:
  - `app/play/utils/__tests__/forgeResolver.test.ts`, `app/play/utils/__tests__/cardAdapterForge.test.ts`, `app/forge/lib/__tests__/playSerialize.test.ts` (fixtures and URLs)
  - `app/play/utils/__tests__/warmForgeRenders.test.ts` (new)

**Interfaces:**
- Consumes: `renderedToken`, `RENDER_VERSION` (Task 1); the route from Task 5.
- Produces:
  - `forgeProxyUrl(e)`: `?v=approved&kind=finished&t=<versionId>` when `e.hasFinished`, else `?v=approved&kind=rendered&t=<versionId>.r<RENDER_VERSION>`. It never returns `''` for a resolver entry.
  - `forgeRenderWarmUrls(cards: { cardImgFile: string }[], resolver?: ForgeResolverMap | null): string[]`
  - `warmForgeRenders(urls: string[], concurrency?: number): void`
  - `ForgePlayResolverEntry` no longer has `hasArt`.

- [ ] **Step 1: Update the fixtures and write the failing tests**

`app/play/utils/__tests__/forgeResolver.test.ts`:

(a) Change the import from `"../forgeResolver"` to also import `forgeRenderWarmUrls`, and add:
```ts
import { RENDER_VERSION } from "@/app/forge/lib/renderVersion";
```

(b) In the `entry` fixture (line 8), delete `hasArt: true, `. In the `evil` fixture (around line 53), delete `hasArt: false, `.

(c) Replace the whole `it("prefers finished scan, falls back to artwork, else ''", ...)` block with:
```ts
  it("prefers the finished scan, else the rendered card of the released version", () => {
    expect(forgeProxyUrl(entry)).toBe(`/forge/api/art/${ID}?v=approved&kind=finished&t=v-1`);
    expect(forgeProxyUrl({ ...entry, hasFinished: false })).toBe(`/forge/api/art/${ID}?v=approved&kind=rendered&t=v-1.r${RENDER_VERSION}`);
  });
  it("forgeRenderWarmUrls lists each granted card without a finished image once", () => {
    const OTHER = "99999999-2222-3333-4444-555555555555";
    const map = new Map([[ID, { ...entry, hasFinished: false }], [OTHER, { ...entry, cardId: OTHER, hasFinished: true }]]);
    const cards = [
      { cardImgFile: `forge:${ID}` }, { cardImgFile: `forge:${ID}` }, { cardImgFile: `forge:${OTHER}` },
      { cardImgFile: "Public.jpg" }, { cardImgFile: "forge:not-granted" },
    ];
    expect(forgeRenderWarmUrls(cards, map as any)).toEqual([`/forge/api/art/${ID}?v=approved&kind=rendered&t=v-1.r${RENDER_VERSION}`]);
    expect(forgeRenderWarmUrls(cards, null)).toEqual([]);
  });
```

`app/play/utils/__tests__/cardAdapterForge.test.ts`:
- Add `import { RENDER_VERSION } from "@/app/forge/lib/renderVersion";`.
- In `entry`, delete `hasArt: true, `.
- Change `expect(gc.cardImgFile).toBe(\`/forge/api/art/${ID}?v=approved&t=v-9\`);` to:
```ts
    expect(gc.cardImgFile).toBe(`/forge/api/art/${ID}?v=approved&kind=rendered&t=v-9.r${RENDER_VERSION}`);
```

`app/forge/lib/__tests__/playSerialize.test.ts`:
- In `resolverEntry`, delete the line `  hasArt: true,`.
- Replace everything from the comment `// hasFinished + hasArt both true → finished proxy URL` through `expect(none.card_img_file).toBe("");` with:
```ts
    // A finished image wins → the finished proxy URL
    const finished = buildForgeGoldfishCards(entries, () => resolverEntry({ hasFinished: true }))[0];
    expect(finished.card_img_file.startsWith("/forge/api/art/")).toBe(true);
    expect(finished.card_img_file).toContain("kind=finished");
    expect(finished.card_img_file).not.toContain("forge:");

    // No finished image → the server-rendered card: never '' and never a bare forge: uri
    const rendered = buildForgeGoldfishCards(entries, () => resolverEntry({ hasFinished: false }))[0];
    expect(rendered.card_img_file.startsWith("/forge/api/art/")).toBe(true);
    expect(rendered.card_img_file).toContain("kind=rendered");
    expect(rendered.card_img_file).not.toContain("forge:");
```

Create `app/play/utils/__tests__/warmForgeRenders.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { warmForgeRenders } from "../warmForgeRenders";

describe("warmForgeRenders", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches every URL, never more than `concurrency` at once, and swallows failures", async () => {
    let active = 0, peak = 0;
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      active++;
      peak = Math.max(peak, active);
      seen.push(url);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      if (url === "/u3") throw new Error("network");
      return { arrayBuffer: async () => new ArrayBuffer(0) };
    }));
    const urls = Array.from({ length: 10 }, (_, i) => `/u${i}`);
    warmForgeRenders(urls, 4);
    await vi.waitFor(() => expect(seen).toHaveLength(10));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(peak).toBeLessThanOrEqual(4);
    expect(new Set(seen)).toEqual(new Set(urls));
  });

  it("does nothing for an empty list", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warmForgeRenders([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/play/utils/__tests__/ app/forge/lib/__tests__/playSerialize.test.ts`

Expected: FAIL. The new rendered URLs don't match yet, `forgeRenderWarmUrls` isn't exported, and `../warmForgeRenders` can't be resolved.

- [ ] **Step 2: Change `app/play/utils/forgeResolver.ts`**

Add to the imports:
```ts
import { renderedToken } from '@/app/forge/lib/renderVersion';
```

Replace `forgeProxyUrl` with:
```ts
// A granted card's face in play: the uploaded finished image when the released version has one,
// otherwise the card the server renders from that version (art proxy kind=rendered, spec
// docs/superpowers/specs/2026-09-13-forge-rendered-play-cards-design.md). Never '' for a granted
// card; ungranted cards have no resolver entry and stay opaque in resolveCardImageUrl.
export function forgeProxyUrl(e: ForgePlayResolverEntry): string {
  if (e.hasFinished) return `/forge/api/art/${e.cardId}?v=approved&kind=finished&t=${e.versionId}`;
  return `/forge/api/art/${e.cardId}?v=approved&kind=rendered&t=${renderedToken(e.versionId)}`;
}

// The rendered-card URLs worth warming for a deck: each granted forge card without a finished
// image, once. See warmForgeRenders.
export function forgeRenderWarmUrls(cards: { cardImgFile: string }[], resolver?: ForgeResolverMap | null): string[] {
  if (!resolver) return [];
  const urls = new Set<string>();
  for (const c of cards) {
    const id = forgeCardIdFromImgFile(c.cardImgFile);
    const e = id ? resolver.get(id) : undefined;
    if (e && !e.hasFinished) urls.add(forgeProxyUrl(e));
  }
  return [...urls];
}
```

- [ ] **Step 3: Drop `hasArt` from `app/forge/lib/playDecks.ts`; fix the `playSerialize.ts` comment**

In `ForgePlayResolverEntry`, change `hasFinished: boolean; hasArt: boolean; versionId: string; typeDisplay: string;` to `hasFinished: boolean; versionId: string; typeDisplay: string;`. In `toResolverEntry`, delete the line `    hasArt: g.hasApprovedArt,`.

In `app/forge/lib/playSerialize.ts`, change the trailing comment on `card_img_file: forgeProxyUrl(r),` to:
```ts
        card_img_file: forgeProxyUrl(r), // finished image or server-rendered card proxy URL, never ''
```

- [ ] **Step 4: Create `app/play/utils/warmForgeRenders.ts`**

```ts
// Multiplayer only (spec Unit 6). The image preloader gives up on a URL for good after two
// retries, so a new set's first game could leave card backs on the board while the server
// renders cold. Fetching this player's own deck's rendered cards as soon as the deck loads gets
// them rendered, cached in Blob, and cached by this browser (immutable responses) before the
// preloader asks. Fire-and-forget: a failure here only means the preloader does the work.
export function warmForgeRenders(urls: string[], concurrency = 4): void {
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        await res.arrayBuffer(); // read to the end so the browser keeps the response
      } catch {
        // ignored: the preloader retries on its own
      }
    }
  };
  for (let i = 0; i < Math.min(concurrency, urls.length); i++) void worker();
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/play app/goldfish app/forge/lib/__tests__/playSerialize.test.ts app/forge/lib/__tests__/deckPool.test.ts`

Expected: PASS. If a vitest path has no test files, drop that path from the command. Any other failure that mentions `hasArt` or an art URL is a consumer this plan missed: fix that consumer the same way, and list it in the commit message.

- [ ] **Step 6: Wire the warm-up into `app/play/[code]/client.tsx`**

(a) Change `import { mergeForgeDeckData, resolveCardImageUrl, type ForgeResolverMap } from '@/app/play/utils/forgeResolver';` to:
```ts
import { mergeForgeDeckData, resolveCardImageUrl, forgeRenderWarmUrls, type ForgeResolverMap } from '@/app/play/utils/forgeResolver';
import { warmForgeRenders } from '@/app/play/utils/warmForgeRenders';
```

(b) Directly after the effect that calls `getForgePlayResolver()` (it ends with `}, [isForge, forgeResolver]);`), add:
```ts
  // Warm the server's rendered-card cache for this player's own Forge deck once the deck and the
  // resolver are both loaded. The initial load and pregame swaps both land in deckData. The image
  // preloader gives up on a URL after two retries; this way it finds the cards already rendered.
  useEffect(() => {
    if (!isForge || !forgeResolver || !deckData) return;
    try {
      warmForgeRenders(forgeRenderWarmUrls(JSON.parse(deckData), forgeResolver));
    } catch {
      // deckData that does not parse has nothing to warm
    }
  }, [isForge, forgeResolver, deckData]);
```

(c) In `handleForgeReloadSelect` and `handleForgePracticeSelect`, directly after each `if (r.ok === false) { setForgeSwapError(r.error); return; }`, add:
```ts
      warmForgeRenders(forgeRenderWarmUrls(r.deckData, forgeResolver));
```
Then change their dependency arrays:
- `handleForgeReloadSelect`: `[]` becomes `[forgeResolver]`
- `handleForgePracticeSelect`: `[gameParams]` becomes `[gameParams, forgeResolver]`

Type-check the touched files:

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx tsc --noEmit -p . 2>&1 | grep -E "client[.]tsx|forgeResolver|playDecks|playSerialize|warmForgeRenders|renderCard|renderedCard|CardSvg|ForgeCardPreview|art/[[]cardId[]]" ; echo "tsc filter done"`

Expected: only `tsc filter done` is printed. Pre-existing errors in unrelated files are not this task's to fix. `git restore tsconfig.json` if `tsc` rewrote it; it normally doesn't.

- [ ] **Step 7: Commit**

```bash
cd /Users/timestes/projects/rtt-forge-rendered
git add app/play/utils/forgeResolver.ts app/forge/lib/playDecks.ts app/forge/lib/playSerialize.ts app/play/utils/warmForgeRenders.ts "app/play/[code]/client.tsx" app/play/utils/__tests__/forgeResolver.test.ts app/play/utils/__tests__/cardAdapterForge.test.ts app/forge/lib/__tests__/playSerialize.test.ts app/play/utils/__tests__/warmForgeRenders.test.ts
git commit -m "feat(play): show Forge cards without a finished image as their rendered card

Play surfaces now ask the art proxy for the server-rendered card instead of
stretching bare art or drawing a card back, and multiplayer warms a deck's
renders as soon as it loads.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

### Task 7: Verify end to end and update the PR (controller-run)

This task produces evidence, not code. Nothing in it is committed except the PR text. The controller runs it because it needs prod data, member sessions and a Vercel Preview deployment.

**Files:**
- Scratch only, under `/private/tmp/claude-501/-Users-timestes-projects-redemption-tournament-tracker/d48743d6-f4e8-4141-a7a5-e556b625990b/scratchpad/verify/`.
- PR #432 body.

- [ ] **Step 1: Run every affected test suite**

Run: `cd /Users/timestes/projects/rtt-forge-rendered && npx vitest run app/forge app/play app/goldfish __tests__/forge-gate-first.test.ts __tests__/forge-no-next-image.test.ts`

Expected: all PASS. If the no-next-image file has another name, run `ls __tests__ | grep forge`. Record any failure that also fails on `origin/main` (check with `git stash` NOT allowed; use a second detached worktree) as pre-existing in the PR body; fix anything else.

- [ ] **Step 2: Production build with the native module, and bundle-trace check**

First make sure no `next dev` runs from this worktree (`pgrep -fl "next dev"`). Then:

```bash
cd /Users/timestes/projects/rtt-forge-rendered
NEXT_DIST_DIR=.next-build npx next build 2>&1 | tail -30
NFT=".next-build/server/app/forge/api/art/[cardId]/route.js.nft.json"
for needle in public/forge/frames/washes/blue.webp public/forge/fonts/Arimo-Regular.ttf @resvg/resvg-js; do
  grep -q "$needle" "$NFT" && echo "traced: $needle" || echo "MISSING: $needle"
done
git status --short tsconfig.json   # next build may rewrite it: git restore tsconfig.json
rm -rf .next-build
```

Expected: the build succeeds, the route compiles with the dynamic `react-dom/server` import, and all three lines print `traced:`.

If `@resvg/resvg-js` isn't listed in the trace, confirm `serverExternalPackages` took effect and that `node_modules/@resvg/resvg-js-*` shows up under the route's trace. Fix it before going on.

- [ ] **Step 3: Server render vs browser preview pairs, for design review**

Cards:
- Holy Writ (Undude; art-only Artifact)
- one Hero with stats
- one dual-brigade card
- one verse-heavy card with identifiers and a reference
- Tower of Babel (overflowing ability)

Pick them read-only from prod with the Supabase MCP `execute_sql` (`forge_cards` `id, title, working_snapshot, working_art_key`).

1. **Server side.** Write a scratch script `verify/render-pairs.ts` and run it with `npx tsx --tsconfig /Users/timestes/projects/rtt-forge-rendered/tsconfig.json`, from the worktree, after loading `.env.local` into the environment. For each card it calls `renderCardImage({ data: working_snapshot, artKey: working_art_key, year: 2026 }, blobRenderIO)` and writes `verify/<slug>-server.jpg`. It reads Blob only and writes nothing.
2. **Browser side.**
   - Start `NEXT_DIST_DIR=.next-verify npx next dev -p 3107` in the worktree.
   - Mint a member session with the `verify` skill.
   - With Playwright, open `/forge/cards/<id>` for each card. Abort every request carrying a `next-action` header, so no autosave writes happen.
   - Wait for `document.fonts.ready`, then screenshot the preview element at 750 CSS px wide into `verify/<slug>-browser.png`.
3. **Compose.** Use `sharp` to put each pair side by side (browser | server) in `verify/pairs.png`.
4. **Check by eye, at full size.** Title face and contour, stat digits, ability line breaks, verse justification, identifier bubble, washes and art crop. Only anti-aliasing differences are acceptable.
5. **Clean up.** Stop the dev server, `rm -rf .next-verify`, `git restore tsconfig.json` if it changed.
6. **Share.** Send `pairs.png` to Tim (SendUserFile).

- [ ] **Step 4: Preview deployment check**

1. **Get the Preview URL.** `git push`, then find the Preview deployment URL for the branch (`gh pr view 432 --json statusCheckRollup`, or `vercel ls`). If Deployment Protection blocks automated requests, use the `vercel:access-protected-vercel-deployment` skill.
2. **Pick the card.** Find the playtesting image-less card "Random Genesis Hero":
   ```sql
   select c.id, coalesce(c.approved_version_id, c.published_version_id) as version_id
   from forge_cards c where c.title = 'Random Genesis Hero';
   ```
3. **Member session.** Using member session cookies from the verify skill, request `/forge/api/art/<id>?v=approved&kind=rendered&t=<version_id>.r1`. Expect:
   - `200 image/jpeg` and `private, max-age=31536000, immutable`;
   - the time (cold), then a second request that is faster (Blob hit);
   - the JPEG, viewed.
4. **Same URL without cookies.** Expect 404.
5. **Cold concurrency.** Request 8 different released cards' `kind=rendered` URLs at once, using real released version ids from SQL, and record the slowest response time.

   Then delete the cache blobs this created for cards that *have* a finished image. They'll never be requested by play. Use a scratch script: `@vercel/blob` `list({ prefix: "forge-rendered/" })` and `del` with the forge token, keeping only Random Genesis Hero's key.

- [ ] **Step 5: Update PR #432**

Rewrite the PR body's Status checklist:
- tick the done items;
- add a "Verification" section with the test totals, the build/trace result, the Preview timings (cold single, cold ×8 slowest, warm) and a note that the render pairs were sent for design review;
- list any pre-existing failures.

Keep the PR as a draft until Tim has looked at the pairs.

