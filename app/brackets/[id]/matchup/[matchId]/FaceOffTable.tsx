import { brigadeSwatch } from '@/lib/tournament/brigadeColors';
import { cn } from '@/lib/utils';
import { faceOffRows, type BrigadeCount, type DeckBreakdown } from '../../../lib/matchup';

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const ROW = 'grid grid-cols-[1fr_auto_1fr] items-center gap-x-2 py-2 sm:gap-x-3';
/** Deck totals read as plain numbers; only the type rows get a bar. */
const TOTALS = new Set(['Main deck', 'Reserve']);

const swatchVars = (name: string) => {
  const swatch = brigadeSwatch(name);
  return { '--sw-light': swatch.light, '--sw-dark': swatch.dark } as React.CSSProperties;
};

/**
 * A | stat | B. Each type row grows a bar outward from the label, scaled to
 * the larger side of that row; the larger side is bold with a solid bar, the
 * smaller recedes, and a tie shows both plainly. Brigades sit below as one
 * segmented bar per deck with the counts printed under it.
 */
export function FaceOffTable({ a, b, nameA, nameB }: {
  a: DeckBreakdown | null;
  b: DeckBreakdown | null;
  nameA: string;
  nameB: string;
}) {
  const rows = faceOffRows(a, b);
  if (rows.length === 0) return null;

  const cell = (mine: number | null, other: number | null, side: 'a' | 'b', bar: boolean) => {
    const leads = mine !== null && other !== null && mine > other;
    const trails = mine !== null && other !== null && mine < other;
    const top = Math.max(mine ?? 0, other ?? 0);
    const number = (
      <span
        className={cn(
          'w-7 shrink-0 text-sm font-medium tabular-nums',
          side === 'a' ? 'text-right' : 'text-left',
          trails && 'text-muted-foreground',
        )}
      >
        {mine === null ? '—' : mine}
      </span>
    );
    const track = bar && mine !== null && top > 0 && (
      <span aria-hidden className={cn('flex h-1.5 min-w-0 flex-1', side === 'a' ? 'justify-end' : 'justify-start')}>
        <span
          className={cn('h-full rounded-full', leads ? 'bg-foreground/70' : trails ? 'bg-foreground/20' : 'bg-foreground/40')}
          style={{ width: `${(mine / top) * 100}%`, minWidth: mine > 0 ? 3 : 0 }}
        />
      </span>
    );
    return (
      <div className={cn('flex items-center gap-2', side === 'a' ? 'flex-row-reverse' : 'flex-row')}>
        {number}
        {track || (bar && <span className="flex-1" />)}
      </div>
    );
  };

  const brigadeColumn = (list: BrigadeCount[] | undefined, side: 'a' | 'b') => {
    const total = (list ?? []).reduce((n, c) => n + c.count, 0);
    const align = side === 'a' ? 'justify-end' : 'justify-start';
    if (list === undefined) return <p className={cn('flex text-sm text-muted-foreground', align)}>—</p>;
    if (list.length === 0) return <p className={cn('flex text-sm text-muted-foreground', align)}>None</p>;
    return (
      <div>
        <span aria-hidden className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-foreground/[0.06]">
          {list.map(({ name, count }) => (
            <span
              key={name}
              title={`${name} · ${count} of ${total}`}
              className="block h-full min-w-[3px] bg-[var(--sw-light)] dark:bg-[var(--sw-dark)]"
              style={{ flex: `${count} 1 0%`, ...swatchVars(name) }}
            />
          ))}
        </span>
        <div className={cn('mt-2 flex flex-wrap gap-1', align)}>
          {list.map(({ name, count }) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
              style={swatchVars(name)}
            >
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--sw-light)] dark:bg-[var(--sw-dark)]" />
              {name}
              <span className="tabular-nums text-muted-foreground">{count}</span>
            </span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section aria-label="Face-off" className="divide-y divide-border/60 border-y border-border/60">
      <h2 className="sr-only">{nameA} versus {nameB}</h2>
      {rows.map(row => (
        <div key={row.label} className={ROW}>
          {cell(row.a, row.b, 'a', !TOTALS.has(row.label))}
          <span className={cn(LABEL, 'w-28 text-balance text-center leading-snug sm:w-56')}>{row.label}</span>
          {cell(row.b, row.a, 'b', !TOTALS.has(row.label))}
        </div>
      ))}
      {(['good', 'evil'] as const).map(side => {
        const listA = a?.brigades[side];
        const listB = b?.brigades[side];
        if ((listA?.length ?? 0) === 0 && (listB?.length ?? 0) === 0) return null;
        return (
          <div key={side} className="py-3">
            <p className={cn(LABEL, 'mb-2 text-center')}>{side === 'good' ? 'Good brigades' : 'Evil brigades'}</p>
            <div className="grid grid-cols-2 gap-x-6 sm:gap-x-10">
              {brigadeColumn(listA, 'a')}
              {brigadeColumn(listB, 'b')}
            </div>
          </div>
        );
      })}
    </section>
  );
}
