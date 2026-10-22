import { cache } from 'react';
import { notFound } from 'next/navigation';
import TopNav from '@/components/top-nav';
import { GOING_FIRST_MIN_GAMES, computeMoments, computeStandings, goingFirst } from '@/lib/bracket/standings';
import { loadBracketAction } from '../../actions';
import { BracketTabs } from '../../components/BracketTabs';
import { bracketMeta } from '../../lib/view';
import { DeckLists } from './DeckLists';
import { GoingFirst } from './GoingFirst';
import { loadDeckLists } from './load';
import { Moments } from './Moments';
import { Standings } from './Standings';

export const dynamic = 'force-dynamic';

// generateMetadata and the page share one load per request.
const load = cache(loadBracketAction);

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const res = await load(id);
  return { title: res.ok ? `${res.data.bracket.name} · Breakdown` : 'Bracket not found' };
}

export default async function BracketBreakdownPage({ params }: { params: Params }) {
  const { id } = await params;
  const res = await load(id);
  if (res.ok === false) notFound();
  const { isOwner, ...data } = res.data;

  const rows = computeStandings(data);
  const moments = computeMoments(data);
  const split = goingFirst(data.games);
  const placeOf = (entryId: string) => {
    const row = rows.find(r => r.entry.id === entryId);
    return row && row.finish.kind !== 'alive' ? row.finish.place : null;
  };
  const deckLists = await loadDeckLists({
    entries: data.entries, ownerId: data.ownerId, isOwner, createdAt: data.createdAt, placeOf,
  });
  const champion = data.bracket.status === 'complete' ? data.bracket.championEntryId : null;

  return (
    <>
      <TopNav />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
        <header className="mb-6 sm:mb-8">
          <h1 className="font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">{data.bracket.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">{bracketMeta(data)}</p>
        </header>

        <BracketTabs bracketId={id} active="breakdown" />

        <div className="space-y-12">
          <Standings
            rows={rows}
            bestOf={data.bracket.bestOf}
            defaultOpenEntryId={champion}
            played={data.games.some(g => g.winnerEntryId !== null)}
            visibleEntryIds={deckLists.visibleEntryIds}
          />
          {moments.length > 0 && <Moments moments={moments} />}
          {split.game1.total >= GOING_FIRST_MIN_GAMES && <GoingFirst split={split} bestOf={data.bracket.bestOf} />}
          <DeckLists data={deckLists} entries={data.entries} rows={rows} isOwner={isOwner} />
        </div>
      </div>
    </>
  );
}
