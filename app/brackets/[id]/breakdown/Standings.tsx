'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import type { BestOf } from '@/lib/bracket/types';
import { describeSeries, type GameLine, type SeriesLine, type StandingRow } from '@/lib/bracket/standings';
import { cn } from '@/lib/utils';
import { DeckThumb } from '../../components/DeckThumb';

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** 'Game 2 · went second · won 5–3 · 31 min', from the deck's side of the table. */
export function describeGame(game: GameLine, bestOf: BestOf): string {
  const result = game.won ? 'won' : 'lost';
  return [
    bestOf > 1 ? `Game ${game.gameNumber}` : null,
    game.byHand ? 'recorded by hand' : game.wentFirst === null ? null : game.wentFirst ? 'went first' : 'went second',
    game.souls ? `${result} ${game.souls.own}–${game.souls.opponent}` : result,
    game.minutes === null ? null : `${game.minutes} min`,
  ].filter(Boolean).join(' · ');
}

function seriesHeading(series: SeriesLine, bestOf: BestOf): string {
  const decided = describeSeries(series, bestOf);
  if (decided) return decided;
  const played = series.wins + series.losses;
  return played > 0 ? `vs ${series.opponentName}, ${series.wins}–${series.losses} so far` : `vs ${series.opponentName}, not started`;
}

export function Standings({ rows, bestOf, defaultOpenEntryId, played, visibleEntryIds }: {
  rows: StandingRow[];
  bestOf: BestOf;
  /** Opened on load: the champion, once there is one. */
  defaultOpenEntryId: string | null;
  played: boolean;
  /** Entries whose deck page this viewer may open. */
  visibleEntryIds: string[];
}) {
  const [open, setOpen] = useState<string | null>(defaultOpenEntryId);
  const visible = new Set(visibleEntryIds);
  // Souls are summed over the games that recorded them, which the row says when that is not every game.
  const anyPartial = rows.some(r => r.souls && r.souls.games < r.games.won + r.games.lost);

  return (
    <section>
      <h2 className="text-lg font-semibold">Standings</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        {played
          ? 'Finish, game record, and souls rescued against souls conceded. Tap a deck for its road, game by game.'
          : 'Nothing has been played yet. Each deck’s record and road fill in as results come in.'}
      </p>

      <ol className="mt-4 border-y border-border/60">
        <li aria-hidden className={cn(LABEL, 'flex items-center gap-3 border-b border-border/60 py-2')}>
          <span className="w-10 shrink-0" />
          <span className="min-w-0 flex-1">Deck</span>
          <span className="w-12 shrink-0 text-right">Games</span>
          <span className="w-16 shrink-0 text-right">Souls</span>
          <span className="w-4 shrink-0" />
        </li>
        {rows.map(row => {
          const isOpen = open === row.entry.id;
          const champion = row.finish.kind === 'champion';
          const summary = row.road.map(s => describeSeries(s, bestOf)).filter(Boolean).join(' · ');
          const souls = row.souls;
          const played = row.games.won + row.games.lost;
          return (
            <li key={row.entry.id} className="border-b border-border/60 last:border-b-0">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : row.entry.id)}
                aria-expanded={isOpen}
                className="flex min-h-11 w-full items-center gap-3 py-2 text-left transition-colors hover:bg-muted/40"
              >
                <DeckThumb entry={row.entry} dimmed={row.finish.kind === 'out'} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm font-medium', champion && 'text-primary')}>
                    {row.entry.deckName}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">
                    {row.finishLabel}
                    {summary ? ` · ${summary}` : ''}
                  </span>
                </span>
                <span className="w-12 shrink-0 text-right text-sm font-semibold tabular-nums">
                  {row.games.won}–{row.games.lost}
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums">
                  <span className="block text-sm font-semibold">{souls ? signed(souls.rescued - souls.conceded) : '—'}</span>
                  {souls && (
                    <span className="block text-[11px] text-muted-foreground">
                      {souls.rescued}–{souls.conceded}{souls.games < played ? ` (${souls.games}/${played})` : ''}
                    </span>
                  )}
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
                />
              </button>

              {isOpen && (
                <div className="bg-muted/30 px-3 pb-3 pt-2 sm:pl-[3.25rem]">
                  {row.road.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No series yet.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {row.road.map(series => (
                        <div key={series.matchId}>
                          <p className="text-xs">
                            <span className={LABEL}>{series.label}</span>
                            <span className="ml-2 font-medium">{seriesHeading(series, bestOf)}</span>
                          </p>
                          {series.games.length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-xs tabular-nums">
                              {series.games.map(game => (
                                <li
                                  key={game.gameNumber}
                                  className={game.won ? 'text-foreground/80' : 'text-muted-foreground'}
                                >
                                  {describeGame(game, bestOf)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {row.entry.deckId && visible.has(row.entry.id) && (
                    <Link
                      href={`/decklist/${row.entry.deckId}`}
                      className="mt-2 inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
                    >
                      Open deck
                    </Link>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {anyPartial && (
        <p className="mt-2 text-xs text-muted-foreground">
          (n/m): souls were recorded in n of the m games played.
        </p>
      )}
    </section>
  );
}
