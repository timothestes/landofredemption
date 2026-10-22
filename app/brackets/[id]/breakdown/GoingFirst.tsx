import type { BestOf } from '@/lib/bracket/types';
import { GOING_FIRST_MIN_GAMES, type FirstSplit } from '@/lib/bracket/standings';

export function GoingFirst({ split, bestOf }: { split: FirstSplit; bestOf: BestOf }) {
  // In a best of one every game is a game 1, so there is no second question to keep apart.
  const single = bestOf === 1;
  const lines = [
    { label: single ? 'Games won by the deck going first' : 'Game 1 of a series, the deck going first won', ...split.game1 },
    ...(split.later.total >= GOING_FIRST_MIN_GAMES
      ? [{ label: 'Later games, the deck going first won', ...split.later }]
      : []),
  ];
  return (
    <section>
      <h2 className="text-lg font-semibold">Going first</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        {single
          ? 'Who goes first is a coin flip. Hand-recorded games are left out.'
          : 'Game 1 is a coin flip. After that the loser of the last game goes first, which is a different question, so the two are kept apart. Hand-recorded games are left out.'}
      </p>
      <dl className="mt-4 divide-y divide-border/60 border-y border-border/60 text-sm">
        {lines.map(line => (
          <div key={line.label} className="flex items-baseline justify-between gap-4 py-2.5">
            <dt>{line.label}</dt>
            <dd className="shrink-0 font-semibold tabular-nums">{line.firstWon} of {line.total}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
