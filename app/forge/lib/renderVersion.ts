// Rendered play cards (docs/superpowers/specs/2026-09-13-forge-rendered-play-cards-design.md).
// A released version's rendered card is cached in private Blob, and in players' browsers,
// under RENDER_VERSION. BUMP IT whenever a render would come out different:
//  * CardSvg.tsx or anything it draws with (frameAssets, frameGeometry, textFit, fontMetrics)
//  * the frame kit images under public/forge/frames
//  * a re-upload of the private title/stat fonts (bump forge-fonts.css ?v= at the same time)
//  * a re-run of scripts/forge-normalize-images.ts (it rewrites card_versions.art_key in place)
export const RENDER_VERSION = 2;

/** The `t` cache-buster a rendered-card URL carries. */
export const renderedToken = (versionId: string): string => `${versionId}.r${RENDER_VERSION}`;

/** Whether a request's `t` names this deploy's renderer. Only then is a render immutable. */
export const isCurrentRenderToken = (t: string | null): boolean =>
  !!t && t.endsWith(`.r${RENDER_VERSION}`);

/** Private Blob key of a version's cached render. */
export const renderedCacheKey = (versionId: string): string =>
  `forge-rendered/r${RENDER_VERSION}/${versionId}.jpg`;
