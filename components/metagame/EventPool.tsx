import Link from "next/link";
import type { TournamentBreakdown } from "@/lib/tournament/breakdown";

function formatDate(endedAt: string | null): string {
  if (!endedAt) return "Date not recorded";
  return new Date(endedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Which events this view is actually made of.
 *
 * The single most misleading thing a pooled metagame can do is present one big
 * tournament as though it were a scene. Naming the contributors and sizing them
 * against each other is what stops that: a reader can see at a glance whether
 * they are looking at a broad sample or at Nationals wearing a different hat.
 *
 * Bar length carries the share; the count is printed on every row, so the tint
 * is a reading aid rather than the data.
 */
export default function EventPool({ breakdown }: { breakdown: TournamentBreakdown }) {
  const { events, deckCount } = breakdown;
  if (events.length === 0) return null;

  const largest = Math.max(...events.map((e) => e.deckCount), 1);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          {events.length === 1 ? "From one event" : `From ${events.length} events`}
        </h2>
        <p className="text-xs text-muted-foreground tabular-nums">
          {deckCount.toLocaleString()} decklists pooled
        </p>
      </div>

      <ul className="overflow-hidden rounded-xl bg-card">
        {events.map((event) => {
          const share = deckCount === 0 ? 0 : event.deckCount / deckCount;
          return (
            <li key={event.id}>
              <Link
                href={`/tournaments/results/${event.id}/breakdown`}
                className="relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-foreground/[0.04] sm:px-4"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/[0.14] to-primary/0"
                  style={{ width: `${Math.max((event.deckCount / largest) * 100, 0.5)}%` }}
                />
                <span className="relative min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {event.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {formatDate(event.endedAt)}
                  </span>
                </span>
                <span className="relative shrink-0 text-right">
                  <span className="block text-sm font-semibold text-foreground tabular-nums">
                    {event.deckCount}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                    {Math.round(share * 100)}%
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {events.length === 1 && (
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          Everything below comes from a single tournament, so it describes that
          event rather than the format as a whole. The picture widens as more
          hosts publish their decklists.
        </p>
      )}
    </section>
  );
}
