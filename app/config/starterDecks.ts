// Starter decks: a short, owner-curated list of public decks offered to new
// players (and anyone with no saved decks) in the /play deck picker and on the
// /goldfish entry page. Pure module — imported from client and server code.

import type { DeckOption } from "@/app/play/components/DeckPickerCard";

export interface StarterDeckConfig {
  /** `decks.id` of a deck whose visibility is 'public'. */
  deckId: string;
  /** Optional display name shown instead of the deck's own name. */
  label?: string;
  /** Optional one-line description (shown on /goldfish). */
  blurb?: string;
}

/** Public deck IDs the site owner designates as starter decks, in display order.
 *  Each must be a deck with visibility 'public'. The Starter tab/section is hidden while this list is empty. */
export const STARTER_DECKS: ReadonlyArray<StarterDeckConfig> = [
  {
    // Copy of Starter Deck (K), owned by RedemptionCCG.app
    deckId: "6f77c1de-13c8-4a79-8a3a-9d563482dc2b",
    blurb: "Green, Purple & Pale Green brigades.",
  },
  {
    // Copy of Starter Deck (L), owned by RedemptionCCG.app
    deckId: "ce690da9-b824-412c-994c-b89cbfbdf17a",
    blurb: "Clay, White & Black brigades.",
  },
];

export function hasStarterDecks(): boolean {
  return STARTER_DECKS.length > 0;
}

/** What the loader fetches per deck — the same fields the picker's Community tab renders. */
export type StarterDeckRow = DeckOption & { username: string | null };

export type StarterDeck = StarterDeckRow & { blurb?: string };

/**
 * Put loaded rows in config order, dropping configured ids the query did not
 * return (missing or no longer public) and any row that is not configured.
 * A config `label` replaces the deck's own name.
 */
export function orderStarterDecks(
  rows: ReadonlyArray<StarterDeckRow>,
  config: ReadonlyArray<StarterDeckConfig> = STARTER_DECKS,
): StarterDeck[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: StarterDeck[] = [];
  for (const entry of config) {
    const row = byId.get(entry.deckId);
    if (!row) continue;
    out.push({
      ...row,
      name: entry.label ?? row.name,
      ...(entry.blurb ? { blurb: entry.blurb } : {}),
    });
  }
  return out;
}
