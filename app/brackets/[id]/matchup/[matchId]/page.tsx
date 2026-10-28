import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import TopNav from '@/components/top-nav';
import { createClient } from '@/utils/supabase/server';
import { labelForMatch, seriesState, shapeOf } from '@/lib/bracket';
import type { BracketEntry, BracketMatch } from '@/lib/bracket/types';
import { CARD_BY_FULL_KEY } from '@/app/decklist/card-search/data/cardIndex';
import { enrichDeckCards } from '@/app/decklist/[deckId]/enrichDeckCards';
import { loadBracketAction } from '../../../actions';
import { loadMatchupDecks, type MatchupDeck } from '../../../lib/loadMatchupDecks';
import { MatchupClient, type MatchupSide } from './MatchupClient';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string; matchId: string }>;

// generateMetadata and the page share one load per request.
const load = cache(loadBracketAction);

/** The match and both seated entries, or null when the matchup cannot be shown. */
function seated(matches: BracketMatch[], entries: BracketEntry[], matchId: string) {
  const match = matches.find(m => m.id === matchId);
  if (!match || match.isBye) return null;
  const byId = new Map(entries.map(e => [e.id, e]));
  const a = match.entryAId ? byId.get(match.entryAId) : undefined;
  const b = match.entryBId ? byId.get(match.entryBId) : undefined;
  if (!a || !b) return null;
  return { match, a, b, byId };
}

export async function generateMetadata({ params }: { params: Params }) {
  const { id, matchId } = await params;
  const res = await load(id);
  if (res.ok === false) return { title: 'Bracket not found' };
  const s = seated(res.data.matches, res.data.entries, matchId);
  if (!s) return { title: res.data.bracket.name };
  return {
    title: `${s.a.deckName} vs ${s.b.deckName} · ${res.data.bracket.name}`,
    description: `Matchup preview: ${s.a.deckName} against ${s.b.deckName} in ${res.data.bracket.name}.`,
  };
}

const toSide = (entry: BracketEntry, deck: MatchupDeck): MatchupSide =>
  deck.status === 'ok'
    ? {
        entry,
        status: 'ok',
        deck: { id: deck.id, name: deck.name, format: deck.format, paragon: deck.paragon, ownerName: deck.ownerName },
        cards: enrichDeckCards(deck.cards, CARD_BY_FULL_KEY),
      }
    : { entry, status: deck.status, deck: null, cards: [] };

export default async function MatchupPage({ params }: { params: Params }) {
  const { id, matchId } = await params;
  const res = await load(id);
  if (res.ok === false) notFound();
  const { isOwner, bracket, entries, matches, games } = res.data;

  // A match that is not seated yet has nothing to preview; the bracket is the right place.
  const s = seated(matches, entries, matchId);
  if (!s) redirect(`/brackets/${id}`);
  const { match, a, b, byId } = s;

  const supabase = await createClient();
  const [deckA, deckB] = await loadMatchupDecks(supabase, [a, b]);

  const series = seriesState(games, match, bracket.bestOf);
  const score = series.winsA + series.winsB > 0 ? `${series.winsA}–${series.winsB}` : null;
  const winnerName = match.winnerEntryId ? byId.get(match.winnerEntryId)?.deckName ?? null : null;

  return (
    <>
      <TopNav />
      <MatchupClient
        bracket={{ id: bracket.id, name: bracket.name, bestOf: bracket.bestOf }}
        label={labelForMatch({ ...shapeOf(matches), size: bracket.size }, match)}
        score={score}
        winnerName={winnerName}
        a={toSide(a, deckA)}
        b={toSide(b, deckB)}
        isOwner={isOwner}
      />
    </>
  );
}
