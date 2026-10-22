import type { Moment } from '@/lib/bracket/standings';

export function Moments({ moments }: { moments: Moment[] }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">Moments</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        The games worth retelling. A line appears only once it has happened.
      </p>
      <ul className="mt-4 divide-y divide-border/60 border-y border-border/60">
        {moments.map((moment, i) => (
          <li key={i} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
            <span className="w-36 shrink-0 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {moment.title}
            </span>
            <span className="text-sm tabular-nums">{moment.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
