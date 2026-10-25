import type { FirstRecord } from '@/lib/bracket/standings';

export function GoingFirst({ record }: { record: FirstRecord }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">Going first</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Who goes first is a coin flip every game. Hand-recorded games are left out.
      </p>
      <dl className="mt-4 divide-y divide-border/60 border-y border-border/60 text-sm">
        <div className="flex items-baseline justify-between gap-4 py-2.5">
          <dt>Games won by the deck going first</dt>
          <dd className="shrink-0 font-semibold tabular-nums">{record.firstWon} of {record.total}</dd>
        </div>
      </dl>
    </section>
  );
}
