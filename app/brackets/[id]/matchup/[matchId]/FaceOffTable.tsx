import { brigadeSwatch } from '@/lib/tournament/brigadeColors';
import { cn } from '@/lib/utils';
import { faceOffRows, type BrigadeCount, type DeckBreakdown } from '../../../lib/matchup';

const LABEL = 'text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground';
const ROW = 'grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 py-2';

/**
 * A | stat | B. Numbers hug the centre label; the larger side reads in the
 * foreground colour, the smaller recedes, and a tie shows both plainly.
 */
export function FaceOffTable({ a, b, nameA, nameB }: {
  a: DeckBreakdown | null;
  b: DeckBreakdown | null;
  nameA: string;
  nameB: string;
}) {
  const rows = faceOffRows(a, b);
  if (rows.length === 0) return null;

  const value = (mine: number | null, other: number | null, side: 'a' | 'b') => (
    <span
      className={cn(
        'text-sm font-medium tabular-nums',
        side === 'a' ? 'text-right' : 'text-left',
        mine !== null && other !== null && mine < other && 'text-muted-foreground',
      )}
    >
      {mine === null ? '—' : mine}
    </span>
  );

  const chips = (list: BrigadeCount[] | undefined, side: 'a' | 'b') => (
    <div className={cn('flex flex-wrap gap-1', side === 'a' ? 'justify-end' : 'justify-start')}>
      {list === undefined ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : list.length === 0 ? (
        <span className="text-sm text-muted-foreground">None</span>
      ) : list.map(({ name, count }) => {
        const swatch = brigadeSwatch(name);
        return (
          <span
            key={name}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
            style={{ '--sw-light': swatch.light, '--sw-dark': swatch.dark } as React.CSSProperties}
          >
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[var(--sw-light)] dark:bg-[var(--sw-dark)]" />
            {name}
            <span className="tabular-nums text-muted-foreground">{count}</span>
          </span>
        );
      })}
    </div>
  );

  return (
    <section aria-label="Face-off" className="divide-y divide-border/60">
      <div className={cn(ROW, 'pb-1.5 pt-0')}>
        <span className="truncate text-right text-sm font-semibold">{nameA}</span>
        <span className={cn(LABEL, 'text-center')}>vs</span>
        <span className="truncate text-sm font-semibold">{nameB}</span>
      </div>
      {rows.map(row => (
        <div key={row.label} className={ROW}>
          {value(row.a, row.b, 'a')}
          <span className={cn(LABEL, 'text-center')}>{row.label}</span>
          {value(row.b, row.a, 'b')}
        </div>
      ))}
      {(['good', 'evil'] as const).map(side => {
        const listA = a?.brigades[side];
        const listB = b?.brigades[side];
        if ((listA?.length ?? 0) === 0 && (listB?.length ?? 0) === 0) return null;
        return (
          <div key={side} className={cn(ROW, 'items-start')}>
            {chips(listA, 'a')}
            <span className={cn(LABEL, 'pt-1 text-center')}>{side === 'good' ? 'Good brigades' : 'Evil brigades'}</span>
            {chips(listB, 'b')}
          </div>
        );
      })}
    </section>
  );
}
