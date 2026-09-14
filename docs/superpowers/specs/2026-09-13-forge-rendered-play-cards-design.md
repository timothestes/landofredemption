# Forge rendered play cards: design

**Status:** revision 3. The adversarial review signed off after two rounds (see Review
log). · **Date:** 2026-09-13

## Problem

In Forge play (multiplayer, spectating, goldfish) a Forge card's face is whatever
`forgeProxyUrl` (`app/play/utils/forgeResolver.ts`) returns:

- the uploaded **finished card image**, if the released version has one;
- otherwise the version's raw **artwork**, stretched to card shape with no frame, title
  or text;
- otherwise `''`, which every play surface draws as a **card back**.

The live frame renderer, `ForgeCardPreview`, runs only inside the Forge: the studio, set
grid, deckbuilder and deck view. So a card designed with it and released to playtest
shows up in games as bare art or a card back.

In prod on 2026-09-13, Undude has 32 art-only and 7 image-less cards, all drafts. "John's
Test set" has one image-less card that is already in playtesting.

## Goal

A released Forge card with no finished image shows in every play surface as its **framed
card**, drawn from the released version's data the way the Forge preview draws it.

## Non-goals

- **Drafts stay out of play.** The pool filter, `listSetApprovedCards`, is unchanged.
- **The public set release still needs an uploaded finished image.** A rendered image
  doesn't satisfy the `promote.ts` `no_finished_image` blocker.
- **Forge pages don't change.** The studio, set grid, deckbuilder and deck view keep
  drawing the preview in the browser with today's DOM.
- **Working snapshots aren't rendered.** Only released versions are.
- **No cleanup of stale renders.** Renders from earlier renderer versions stay in Blob.
- **Deck view and the deckbuilder don't match the game.** They keep showing the original
  uncropped art and hiding placeholder art (`hasApprovedArt`, the 066 art branch). The
  game shows the framed render with the cropped art, placeholders included (Decision 4).

## Decisions

1. **An uploaded finished image still wins.** Rendering applies only when the released
   version has no `finished_key`.
2. **The rendered card replaces the raw-art fallback.** An art-only card shows its frame
   with the art inside.
3. **In-game renders hide the Forge annotation pills:** "Ability doesn't fit · N lines
   over" and "preview approximate".
4. **Placeholder art is drawn inside the frame,** the way the studio and set grid draw
   it: `hasArt: !!working_art_key` (`cards.ts:141`, `sets.ts:133`) ignores the
   placeholder flag. The render uses `art_key`, the normalized crop the studio shows, not
   `art_original_key`.
5. **The copyright year is the version's release year** (`card_versions.created_at`,
   NOT NULL since 052). A render then comes out the same whenever it runs, and matches a
   card printed that year.
6. **Render on the server the first time a card is requested.** Cache the result in the
   private Forge Blob store, once per released version and renderer version.
   **Multiplayer clients warm the renders for their own deck** when it loads. Rejected
   alternatives:
   - **Render in every player's browser at game load.** Every player and spectator would
     redo it every game, phones included. Goldfish builds its deck on the server, so it
     would need a second path.
   - **Render in the designer's browser at release and upload it.** Every path that mints
     a playable version would have to render first: single release, bulk release,
     Release update, and `forge_accept_proposal`, which copies the old
     `working_finished_key` onto the new version (075). Missing one serves an outdated
     card, and cards already released would get nothing.
   - **Warm renders on the server at deck load, with `after()`** (revision 2):
     - It doesn't work from goldfish's Server Component: `cookies()` is disallowed
       inside `after()` there.
     - It repeats the membership gate for every card, around 200 network calls per deck
       load.
     - It puts resvg and the traced assets into public page bundles.

## Probe findings

Throwaway probes on 2026-09-13, `@resvg/resvg-js` 2.6.2 in Node on macOS.

- **Draws everything the preview uses.** Checked visually: `paint-order` stroke
  contours, `textLength` with `lengthAdjust="spacingAndGlyphs"`, `word-spacing`,
  `letter-spacing`, italic and bold faces, `feDropShadow`, rounded `clipPath`, and a
  luminance `<mask>` blending a second wash in with a black-to-white gradient.
- **Speed:** about 130 ms for a 750×1050 card with two full-size washes.
- **WebP is silently dropped.** resvg ignores WebP `<image>`s, and the washes and some
  icons are WebP, so they must be converted (with `sharp`, already a dependency) before
  inlining.
- **Fonts match on the typographic family name (name ID 16) only.**
  `font-family="Mukta"` (ID 16) picked Mukta. `"Mukta ExtraBold"` (ID 1) silently fell
  back to the default font, with the same ink width as Arimo. A CSS alias such as
  `ForgeTitle` does the same.
- **Kerning is turned off only by the style form.** `style="font-kerning: none"` works
  (386 px of ink against 363 px kerned). The `font-kerning="none"` *attribute* is
  ignored. React emits the style form.
- **XML-invalid characters make it throw.** U+000B (vertical tab) in text fails parsing
  ("non-XML character"). Browsers accept it.
- **`renderAsync` is exported.**
- **Route handlers can render plain JSX.** Under `next dev`, a Next 15 route handler can
  `renderToStaticMarkup` (dynamic `import("react-dom/server")`) a plain JSX component.
  It can't call a `"use client"` module's export, which arrives as a client reference
  and throws. A production build is still unchecked (see Verification).
- **The lockfile covers Linux.** `npm install @resvg/resvg-js@2.6.2` on macOS writes
  `@resvg/resvg-js-linux-x64-gnu` (and every other platform binary) into
  `package-lock.json`.

## Architecture

### Unit 1: `app/forge/components/CardSvg.tsx`

New file, with no `"use client"` and no hooks.

`CardSvg` is today's `<svg viewBox="0 0 750 1050">` overlay from `ForgeCardPreview`, moved
here. It covers the chrome, icon boxes, class icons, title, NO ART label, identifier
bubble, ability, verse, reference, credits and pills. Nothing changes except these props:

- **`idPrefix: string`** replaces `useId()`. It must already be alphanumeric.
- **`fonts: { title: string; stat: string; body: string }`** — font-family strings.
- **`assetHref: (publicPath: string) => string`** — for icon boxes, badges and class
  icons.
- **`noArt: boolean`** — draw the NO ART label. It replaces today's `!artUrl` test
  (`ForgeCardPreview.tsx:278`).
- **`annotations: boolean`** — draw the pills.
- **`year: number`** replaces the module-level `COPYRIGHT_YEAR`.
- **`rasters: null | { washes: string[]; art: string | null }`**
  - `null` (the client): draw no raster layers, as today's overlay does.
  - Object (the server): draw these underneath everything else.
    - **Washes.** Each is an `<image preserveAspectRatio="xMidYMid slice">` clipped to the
      border rect's rounded path. Wash `i > 0` gets a luminance `<mask>`, black to white
      over `washBands(n)[i]`.
    - **No washes.** A `#b9b3aa` rect fills the border rect.
    - **Art window.** A white rect, then the art `<image preserveAspectRatio="xMidYMid slice">`
      clipped to the art rect's rounded path.

Two more constraints:

- **Kerning.** The body `<g>` keeps `style={{ fontKerning: "none" }}`, the style form
  resvg honours.
- **Shared band maths.** `washBands(n)` is a pure helper returning
  `{ from: edge - half, to: edge + half }` per wash, with `edge = 100·i/n` and
  `half = 20/n`. The client wrapper's CSS masks and `CardSvg`'s SVG masks both use it.

### Unit 2: `ForgeCardPreview.tsx`

Stays `"use client"`, with the same DOM. It becomes a thin wrapper that:

- keeps the outer `div` and today's HTML `<img loading="lazy" decoding="async">` wash and
  art layers, with the mask strings now built from `washBands`, so a 200-card set grid
  still lazy-loads;
- renders:

```tsx
<CardSvg
  rasters={null}
  idPrefix={useId().replace(/[^a-zA-Z0-9]/g, "")}
  noArt={!artUrl}
  fonts={/* CSS stacks */}
  assetHref={identity}
  annotations
  year={COPYRIGHT_YEAR}
/>
```

`ForgeCardPreview.test.ts` keeps passing. It gains two assertions: NO ART is present when
`artUrl` is null, and absent when it is set.

### Unit 3: `app/forge/lib/renderCard.ts`

New and server-only. It is loaded with a dynamic `import()` only on the render path, so
the route's other branches never load resvg or `react-dom/server`.

`renderCardImage({ data, artKey, year }) → Promise<{ jpeg: Buffer; degraded: boolean }>`

- **Input sanitizing.** Every string field of `data` has XML-invalid characters removed
  before rendering: U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+FFFE, U+FFFF and lone
  surrogates. This works on the small `DesignCard`, not on the markup, which carries
  megabytes of base64.
- **Fonts: sources.** Arimo Regular, Bold and Italic come from `public/forge/fonts`. The
  title and stat faces come from the private Blob (`readForgeFont`). If that read fails,
  it uses the OFL files (Mukta ExtraBold, PT Serif Bold) as the browser does, and marks
  the result `degraded`.
- **Fonts: file paths only.** resvg-js 2.6.2's Node build ignores `fontBuffers` (probe,
  2026-09-13: in-memory buffers produced 270 px of ink, not Mukta's 242 px), so fonts load
  from paths. Committed faces load from `public/forge/fonts`. Each licensed face read from
  Blob is written once per instance to `os.tmpdir()/forge-render-fonts/<face>-<sha>.ttf`.
- **Fonts: caching.** Font files and names are cached per instance only after a successful
  load. A failed private-font read isn't remembered.
- **Fonts: family names.** `fontFamilyName(buffer)` is a small pure `name`-table parser
  that prefers name ID 16, then ID 1. Its results go in `fonts`. The render is called with
  `font: { loadSystemFonts: false, fontFiles, defaultFontFamily: <Arimo's name> }`.
- **Fonts: fallback check.** Once per instance, for each private face, render a short
  sample under its parsed name and under a family that doesn't exist. If the two come out
  byte-identical, the name didn't match. Treat that face as failed: use the OFL fallback
  and mark `degraded`.
- **Frame assets.** Read from `public/`, cached per instance as data URIs. Washes (no
  alpha channel) are re-encoded to JPEG, icons, badges and class icons to PNG, all with
  `sharp`.
- **Art.**
  - If `artKey` is null, `art` is null and `noArt` is true. That result is deterministic,
    not degraded.
  - Otherwise read the art with `readForgeArt`, resize it to cover the art window at 1×
    canvas size, and inline it as a JPEG.
  - If the read returns null or throws, throw `RenderInputError` (transient).
- **Render.** `renderToStaticMarkup(<CardSvg rasters={…} noArt={…} annotations={false} idPrefix="r" …/>)`,
  then `await renderAsync(svg, opts)` at width 750, then `sharp` to JPEG quality 90 at
  750×1050.
- **Coalescing.** Concurrent calls for the same cache key in one instance share a promise.
  There is no extra semaphore: `renderAsync` and `sharp` run on libuv's pool of 4 threads,
  which filesystem and DNS work also use. A busy instance slows its other I/O a little,
  which is acceptable at this scale.

### Unit 4: `app/forge/lib/renderVersion.ts`

Client-safe. It exports `RENDER_VERSION = 1` and
`renderedToken(versionId) => \`${versionId}.r${RENDER_VERSION}\``.

**Bump the version whenever rendered output would change:**

- the renderer or `CardSvg`, frame assets, or text metrics;
- re-uploaded private fonts, at the same time as `forge-fonts.css`'s `?v=`;
- a re-run of `scripts/forge-normalize-images.ts`, which rewrites `card_versions.art_key`
  in place and is the only thing that mutates a version after insert.

`CardSvg.tsx` and `forge-fonts.css` each carry a comment pointing here.

An advisory test hashes `CardSvg` markup for fixed fixtures (fixed `year`) against a
stored `{ RENDER_VERSION, hash }`. It's advisory because no CI runs vitest, and it can't
see binary asset or font changes.

### Unit 5: art proxy `kind=rendered`

In `app/forge/api/art/[cardId]/route.ts`, and only valid with `v=approved`.

1. **Gate, all three in parallel:**
   - `supabase.auth.getUser()`;
   - `supabase.rpc("my_forge_role")`;
   - one RLS read of `forge_cards` for this card, embedding the version ids through the
     composite FKs:
     `select("approved:card_versions!fk_approved(id), published:card_versions!fk_published(id)")`
     (`052:64-72`).

   Return 404 unless the user is present, the role is `superadmin`, `elder` or
   `playtester`, and a version id comes back (approved first, then published).

   Why each part:
   - **The role check** closes round 1's blocker. RLS doesn't check membership, and a
     removed member's session still passes `owner_id = auth.uid()` or
     `is_forge_set_granted`, because grants don't cascade on removal (`049:125`,
     `052:34-39`).
   - **`my_forge_role()`** is the same gate 066 uses (SECURITY DEFINER, the caller's own
     role, granted to `authenticated`, `048:24-27,55`).
   - **The embedded version ids** only come back if RLS lets the caller see those version
     rows, so the cache-hit path needs no extra round trip.
2. **Cache key** is `forge-rendered/r${RENDER_VERSION}/${versionId}.jpg`.
3. **Read the cache with `readForgeArt(key)`.**
   - **Hit:** stream it.
   - **`get` throws** (a Blob outage, anything other than a 404): 404, **transient**, no
     negative cache.
   - **Miss** (null): read `card_versions` `data, art_key, created_at` by id under RLS
     (404 if the row isn't visible), then render (Unit 3).
     - Unless `degraded`, store with `uploadForgeRendered(key, jpeg)`, a new `art.ts`
       helper setting `...forgeAuth`, `contentType: "image/jpeg"`,
       `addRandomSuffix: false` and `allowOverwrite: true`.
     - If storing fails, log it (card id and version id, never a key) and serve the
       render anyway.
4. **Render errors.**
   - `RenderInputError` (transient): 404, nothing cached.
   - Any other error, such as a parse failure (deterministic): 404, plus a per-instance
     5-minute negative cache keyed by cache key. This stops goldfish's retry on every
     zone change (`GoldfishCanvas.tsx:627-667`) from re-rendering.
   - Log `cardId` and `versionId` either way.
5. **Headers.**
   - `private, max-age=31536000, immutable` only when **all** of: `t` is present, `t`
     ends in `.r${RENDER_VERSION}`, and the response isn't `degraded`.
   - Otherwise `private, no-store`. That covers deploy skew and degraded renders.
   - `download=1` returns 404 for `rendered`.
6. **Gate regression test.** In the route's unit test, a `kind=rendered` request with a
   session where `my_forge_role` returns null and the `forge_cards` read *does* return a
   row must get 404 and never call `readForgeArt` or the renderer. That is the leak case
   from round 1. `forge-gate-first`'s `ALT_GATE` for the route also requires both
   `rpc("forge_art_key"` and `rpc("my_forge_role"`, but it is only a substring check; the
   unit test is the real guard.

### Unit 6: client warm in multiplayer

**Where.** In `app/play/[code]/client.tsx`, once the player's own deck data and the forge
resolver have both loaded (initial load, deck swap, rematch).

**What.** Collect the unique `forge:<id>` cards in that deck whose resolver entry has
`hasFinished === false`. `fetch` each `forgeProxyUrl` URL, 4 at a time, with no timeout,
ignoring the result. The real route does the work, with its own gate, bundling and
negative cache.

**Why.**
- The multiplayer preloader gives up on a URL for good after 2 retries (6 concurrent, 10 s
  timeout; `useMultiplayerImagePreloader.ts:21-34`). Warming keeps a new set's first game
  from showing card backs.
- The response is immutable-cached by the browser, and in any case already rendered on the
  server, when the preloader asks for it.
- Every seated player, host or joiner, warms their own deck.
- Goldfish needs no warm: `GoldfishCanvas` has no timeout and re-requests failed URLs.
- Spectators arrive after the players have warmed.

### Unit 7: `forgeProxyUrl`

```ts
if (e.hasFinished) return `/forge/api/art/${e.cardId}?v=approved&kind=finished&t=${e.versionId}`;
return `/forge/api/art/${e.cardId}?v=approved&kind=rendered&t=${renderedToken(e.versionId)}`;
```

- **Granted vs ungranted.** A granted card always gets a non-empty URL. An ungranted card
  has no resolver entry and stays opaque (`resolveCardImageUrl` returns `''`). Failing
  closed is unchanged.
- **`hasArt` goes.** `ForgePlayResolverEntry.hasArt` loses its only reader. It's removed
  from the type, from `toResolverEntry`, and from the fixtures in `forgeResolver.test.ts`,
  `cardAdapterForge.test.ts` and `playSerialize.test.ts` (`next build` type-checks tests).
  The URL assertions in `forgeResolver.test.ts` are updated.
  `GrantedForgeCard.hasApprovedArt` stays, for the deckbuilder and deck view.
- **Who picks it up.** Goldfish (`buildForgeGoldfishCards`), multiplayer (`cardAdapter`,
  `mergeForgeDeckData`, `resolveCardImageUrl`), spectate, the preloader, loupe, card
  reader and deck search all go through this function.
- **Accepted cosmetic change.** Modals that branch on a truthy `imageUrl`
  (`DeckSearchModal`, `ZoneBrowseModal`, `CardReaderOverlay`) show a broken image instead
  of a name tile if a render 404s. That should be rare, and it's logged. The Konva board
  draws a card back either way (`GameCardNode.tsx:142,529`).

### Unit 8: `next.config.js` and `package.json`

- Add `@resvg/resvg-js@2.6.2` as a dependency, and add it to `serverExternalPackages`
  (it is a native addon).
- Add `outputFileTracingIncludes['/forge/api/art/[cardId]']`:
  `./public/forge/frames/washes/**`, `./public/forge/frames/icons/**`,
  `./public/forge/frames/badges/**`, `./public/forge/fonts/*.ttf`. Round 1 confirmed the
  key format; `/threshingfloor/episodes/[episode]` works the same way.
- A unit test enumerates every path `frameAssets.ts` can return and asserts each file
  exists under those globs. The bundle itself is checked in Verification 4.

## Security

- **No new table, RPC or policy.** The rendered branch uses the same `my_forge_role()`
  membership gate as 066, plus RLS reads as the caller. Any failure returns the route's
  uniform 404. A unit test pins the leak case (Unit 5.6).
- **Visibility rules.** Playtesters see only published and approved rows of granted cards
  (057). Version pointers never name draft or superseded rows: 075 leaves pointers alone,
  and archive and send-back null them. A playtester granted a different set sees nothing.
- **No new exposure.** A render contains only fields of a released version the caller can
  already `SELECT`, and the play resolver already sends them. STDB rows and world-readable
  data are unchanged.
- **Cache keys stay server-side.** They are private-store paths under `forge-rendered/`.
  Version ids already travel in today's `t` param.
- **Bounded render volume.** A member can trigger renders only of versions they can read.
  Each version is stored at most once per `RENDER_VERSION`, and re-rendered only when a
  render was degraded or failed transiently.
- **Licensed fonts.** The title and stat faces appear only as rasterized glyphs in
  members-only images.

## Staleness

- **Stable key.** Released versions are immutable, so a `(RENDER_VERSION, versionId)` key
  never goes stale. The one exception is the maintenance script in Unit 4.
- **New versions.** An accepted proposal or a Release update mints a new version id, which
  gets a new render.
- **Re-release mid-game.** The resolver's `t` still names the old version while the route
  serves the current version's render under that URL. That's the same behavior finished
  images have today, and a reload picks up the new version.

## Performance and cost

- **Hit path.** `getUser`, `my_forge_role`, and the `forge_cards`-with-embedded-versions
  read in parallel, then one Blob `get`. That's the shape finished images use today, plus
  the parallel role RPC.
- **Miss path.**
  - One `card_versions` read, then about 130 ms of rendering on an M-series laptop (slower
    on a Vercel vCPU), plus asset, font and art loads. A cold instance also loads resvg and
    the fonts.
  - The client warm and coalescing keep this off the preloader's clock.
  - Verification measures a cold first load on a Preview deployment.
- **Blob.** About 150 KB per released version per `RENDER_VERSION`. Hits transfer the
  same bytes a finished image does today.
- **Bundle.** The resvg linux-x64-gnu binary (about 2 MB) plus about 4 MB of traced frames
  and fonts, in the art route only.

## Failure modes

| Failure | Result |
|---|---|
| Private font unreachable, or its name doesn't match | OFL fallback served `no-store`, not cached; next render retries; logged |
| Art Blob missing or read throws | 404, nothing cached; preloader retries, then card back (today's behavior); logged |
| Cache `get` throws (Blob outage) | 404, transient, no negative cache |
| Card data resvg can't parse after sanitizing | 404 + 5-minute per-instance negative cache; logged; studio preview unaffected |
| Cache store fails | Render served; next request re-renders; logged |
| Removed member with a live session | `my_forge_role()` returns null, so 404 (unit-tested) |
| Deploy skew (`t` carries a different `rN`) | Served `no-store` |

## Verification

1. **Unit tests (vitest, node):**
   - `forgeProxyUrl` branches and the updated fixtures;
   - `washBands`;
   - `fontFamilyName`, preferring ID 16 (`Mukta-ExtraBold.ttf` gives `"Mukta"`, Arimo and
     PT Serif give their ID 1 names);
   - the fallback check: a parsed name and a nonexistent family render differently;
   - `renderCardImage` on a fixture with OFL fonts and no Blob: a 750×1050 JPEG, with ink
     in the title, stat, ability and credits regions and a wash region that isn't white;
   - a fixture containing U+000B renders;
   - frame-asset coverage;
   - the advisory `RENDER_VERSION` hash;
   - `ForgeCardPreview` NO ART on and off;
   - the route gate regression (Unit 5.6).
2. **Studio parity:** `ForgeCardPreview.test.ts` passes, and a spot-check of the studio and
   a set grid in the browser shows an unchanged DOM.
3. **Server vs browser pairs:** server JPEG next to browser preview for Holy Writ (art-only
   artifact), a hero with stats, a dual-brigade card, a verse-heavy card with identifiers
   and a reference, and Tower of Babel (overflowing ability). Attach them to the PR for
   design review.
4. **Build:** `NEXT_DIST_DIR=.next-build next build` compiles the route with the native
   module and the dynamic `react-dom/server` import. The route's `.nft.json` under
   `.next-build/server/app/forge/api/art/[cardId]/` lists
   `public/forge/frames/washes/blue.webp`, `public/forge/fonts/Arimo-Regular.ttf` and the
   resvg linux binary package.
5. **Preview deployment:**
   - with a minted member session (verify skill), `kind=rendered` for the playtesting
     image-less card returns a 200 JPEG, and the second hit is served from cache;
   - without a session it returns 404;
   - a cold first load of a goldfish deck with composed cards is measured (temporary Forge
     deck under the test account, deleted afterwards).

## Review log

- **Round 1: no sign-off.**
  - **Blocker:** the rendered branch relied on RLS alone, which doesn't check membership.
  - **Important, fixed in revision 2:** the store helper's auth, degraded caching, font
    name matching, sync rendering and cold-load timeouts, losing lazy loading, XML-invalid
    characters, the copyright year baked into the hash, and production runtime checks.
  - **Minor, fixed in revision 2:** N-wash masks, kerning, modal fallbacks, fixtures, how
    surfaces differ, and deploy skew.
- **Round 2: sign-off.** Four importants were fixed in revision 3:
  - the server `after()` warm replaced with a client warm;
  - a real gate regression test;
  - trace-include keys, which went away with the server warm;
  - the NO ART prop.

  Minors fixed in revision 3: Blob error classification, the embedded version-id read, the
  font fallback check, escaping in the spec, JPEG washes, id sanitizing, `washBands`, and a
  wrong statement about opponents.
