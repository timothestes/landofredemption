"use client";

import type { TournamentBreakdown } from "@/lib/tournament/breakdown";

/**
 * The field at a glance.
 *
 * These are five single numbers, so they are stat tiles rather than a chart —
 * a bar chart of five unrelated measures on one axis would be meaningless.
 */
export default function StatStrip({
  breakdown,
  fieldSize,
}: {
  breakdown: TournamentBreakdown;
  fieldSize: number;
}) {
  const coverage = fieldSize === 0 ? 0 : Math.round((breakdown.deckCount / fieldSize) * 100);
  const eventCount = breakdown.events.length;

  const coverageNote =
    fieldSize > breakdown.deckCount ? `${coverage}% of ${fieldSize} players` : "the full field";

  const tiles = [
    {
      value: breakdown.deckCount.toLocaleString(),
      label: "Decklists",
      // Across events the event count is the first thing that qualifies the
      // number — two hundred lists from one tournament is not a metagame.
      note: eventCount > 1 ? `${coverageNote} · ${eventCount} events` : coverageNote,
    },
    {
      value: breakdown.distinctCards.toLocaleString(),
      label: "Distinct cards",
      note: "printings merged",
    },
    {
      value: breakdown.totalCopies.toLocaleString(),
      label: "Total copies",
      note: "main + reserve",
    },
    {
      value: String(breakdown.medianMainSize),
      label: "Median main deck",
      note: "cards",
    },
    {
      value: String(breakdown.medianLostSouls),
      label: "Median Lost Souls",
      note: "per deck",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-muted/40 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-card px-4 py-4">
          <div className="text-2xl font-bold leading-none text-foreground tabular-nums">
            {tile.value}
          </div>
          <div className="mt-2 text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {tile.label}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground/80">{tile.note}</div>
        </div>
      ))}
    </div>
  );
}
