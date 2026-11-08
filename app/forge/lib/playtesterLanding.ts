// Where a link meant for designers takes a playtester. Pure, because this is a secrecy rule: a
// card link opens only a card the player can already see, and every other case gets one address
// and one sentence, so the landing can't confirm that a card or set exists.

// The statuses a granted playtester may read. Keep in sync with the 091 RLS policy.
export const PLAYTEST_CARD_STATUSES = ["playtesting", "approved", "promoted"];

const FROM_DESIGNER_PAGE = "designers";

export const DESIGNER_PAGE_LANDING = `/forge/play/sets?from=${FROM_DESIGNER_PAGE}`;

export function designerPageNote(from: string | string[] | undefined): string | null {
  return from === FROM_DESIGNER_PAGE ? "That page is for designers, so you landed here instead." : null;
}

export type PlaytesterCardFacts = {
  id: string;
  setId: string | null;
  status: string;
  releasedVersionId: string | null;
  setGranted: boolean;
};

export function playtesterCardLanding(card: PlaytesterCardFacts | null): string {
  if (!card || !card.setId || !card.setGranted || !card.releasedVersionId) return DESIGNER_PAGE_LANDING;
  if (!PLAYTEST_CARD_STATUSES.includes(card.status)) return DESIGNER_PAGE_LANDING;
  return `/forge/play/${card.setId}?card=${card.id}`;
}
