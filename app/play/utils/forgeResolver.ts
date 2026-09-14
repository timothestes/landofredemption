// Client-side forge card resolution. STDB rows carry only `forge:<uuid>` in
// cardImgFile; these helpers merge the viewer's RLS-granted card text and
// rewrite image URLs to the cookie-authed forge art proxy. Unresolved cards
// (viewer lacks the grant) stay opaque — fail-closed by design.
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import type { ForgePlayResolverEntry } from '@/app/forge/lib/playDecks';
import type { GameCardData } from '@/app/play/actions';
import { renderedToken } from '@/app/forge/lib/renderVersion';

export type ForgeResolverMap = Map<string, ForgePlayResolverEntry>;

export function forgeCardIdFromImgFile(imgFile: string): string | null {
  return imgFile.startsWith('forge:') ? imgFile.slice('forge:'.length) : null;
}

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

export function resolveCardImageUrl(imgFile: string, resolver?: ForgeResolverMap | null): string {
  const forgeId = forgeCardIdFromImgFile(imgFile);
  if (forgeId) {
    const e = resolver?.get(forgeId);
    return e ? forgeProxyUrl(e) : '';
  }
  return getCardImageUrl(imgFile);
}

// The real name of a forge card, for the viewer who has the grant. Right-click
// abilities are keyed by card name (CARD_ABILITIES), and the world-readable
// STDB row blanks the name on forge cards — so dispatching off the raw row
// always found zero abilities. Ungranted forge rows keep the blank name and
// stay ability-less, fail-closed.
//
// Callers must NOT feed the result into anything world-readable (game log
// payloads, broadcast reveal labels) — those deliberately stay blanked.
export function resolveForgeCardName(
  row: { cardImgFile: string; cardName: string },
  resolver?: ForgeResolverMap | null,
): string {
  const forgeId = forgeCardIdFromImgFile(row.cardImgFile);
  const e = forgeId ? resolver?.get(forgeId) : undefined;
  return e ? e.name : row.cardName;
}

// Re-hydrate the battle-math fields the leak spine blanked on a forge
// CardInstance row (name/brigade/strength/toughness), from the viewer's
// granted resolver. Deliberately NOT specialAbility: the auto-return summary
// must predict the server's routing, and the server only ever sees the
// blanked row (a forge "place" enhancement goes to discard server-side, so
// the client summary has to say the same). Ungranted forge rows come back
// unchanged — blank stats read as "unknown" in the band, fail-closed.
export function resolveBattleRowFields(
  row: { cardImgFile: string; cardName: string; brigade: string; strength: string; toughness: string },
  resolver?: ForgeResolverMap | null,
): { cardName: string; brigade: string; strength: string; toughness: string } {
  const forgeId = forgeCardIdFromImgFile(row.cardImgFile);
  const e = forgeId ? resolver?.get(forgeId) : undefined;
  if (!e) {
    return { cardName: row.cardName, brigade: row.brigade, strength: row.strength, toughness: row.toughness };
  }
  return { cardName: e.name, brigade: e.brigade, strength: e.strength, toughness: e.toughness };
}

export function mergeForgeDeckData(cards: GameCardData[], resolver?: ForgeResolverMap | null): GameCardData[] {
  if (!resolver || resolver.size === 0) return cards;
  return cards.map((c) => {
    const id = forgeCardIdFromImgFile(c.cardImgFile);
    if (!id) return c;
    const e = resolver.get(id);
    if (!e) return c;
    // Restore the searchable fields the leak spine blanked on the STDB row, so
    // the in-game Search Deck modal can filter forge cards by alignment/brigade/
    // identifier/reference (not just name/type/ability).
    return {
      ...c,
      cardName: e.name,
      specialAbility: e.rawText,
      cardImgFile: forgeProxyUrl(e),
      alignment: e.alignment,
      brigade: e.brigade,
      strength: e.strength,
      toughness: e.toughness,
      identifier: e.identifier,
      reference: e.reference,
    };
  });
}
