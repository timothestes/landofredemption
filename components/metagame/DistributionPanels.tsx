"use client";

import { useMemo } from "react";
import type { TournamentBreakdown } from "@/lib/tournament/breakdown";
import { brigadeSwatch, brigadeRank } from "@/lib/tournament/brigadeColors";
import type { DerivedCard } from "@/lib/tournament/derive";

/**
 * Brigade, card-type, Lost Soul and reserve distributions.
 *
 * All four are labelled horizontal bars on a shared "decks playing it" scale.
 * That form is a deliberate constraint for the brigade panel in particular: its
 * palette is semantic (a Crimson bar reads crimson) and therefore cannot pass
 * the categorical colour-blindness gates, so no reading may depend on telling
 * two hues apart. Length and the adjacent label carry everything.
 */
export default function DistributionPanels({
  breakdown,
  cards,
}: {
  breakdown: TournamentBreakdown;
  cards: DerivedCard[];
}) {
  const brigades = useMemo(
    () =>
      [...breakdown.brigades].sort(
        (a, b) => b.decks - a.decks || brigadeRank(a.label) - brigadeRank(b.label),
      ),
    [breakdown.brigades],
  );

  const lostSouls = useMemo(
    () =>
      cards
        .filter((card) => card.type === "Lost Soul")
        .sort((a, b) => b.decks - a.decks)
        .slice(0, 12),
    [cards],
  );

  // Cards the field mostly kept in the reserve rather than the main deck — the
  // closest thing Redemption has to a sideboard signal.
  const reserveTech = useMemo(
    () =>
      cards
        .filter((card) => card.reserveDecks >= 3 && card.reserveCopies > card.mainCopies)
        .sort((a, b) => b.reserveDecks - a.reserveDecks)
        .slice(0, 10),
    [cards],
  );

  const lostSoulSpread = useMemo(() => {
    const tally = new Map<number, number>();
    for (const deck of breakdown.decks) {
      tally.set(deck.lostSouls, (tally.get(deck.lostSouls) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => a[0] - b[0]);
  }, [breakdown.decks]);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <Panel
        title="Brigades"
        blurb="Decks running at least one card of each brigade. Multi-brigade cards count toward every brigade they name."
      >
        <BarList
          rows={brigades.map((slice) => ({
            key: slice.label,
            label: slice.label,
            value: slice.decks,
            note: `${slice.copies} copies`,
            swatch: brigadeSwatch(slice.label),
          }))}
          max={breakdown.deckCount}
          unit={`of ${breakdown.deckCount} decks`}
        />
      </Panel>

      <Panel title="Card types" blurb="Total copies played across the field.">
        <BarList
          rows={breakdown.types.map((slice) => ({
            key: slice.label,
            label: slice.label,
            value: slice.copies,
            note: `${slice.decks} decks`,
          }))}
          max={Math.max(...breakdown.types.map((t) => t.copies), 1)}
          unit="copies"
        />
      </Panel>

      <Panel
        title="Lost Souls"
        blurb="Which souls the field chose. Type 1 allows one of each, so these are near-enough deck counts."
      >
        <BarList
          rows={lostSouls.map((card) => ({
            key: card.key,
            label: card.name.replace(/^Lost Soul\s*/, ""),
            value: card.decks,
            note: `${Math.round(card.fieldRate * 100)}%`,
          }))}
          max={breakdown.deckCount}
          unit={`of ${breakdown.deckCount} decks`}
        />
        <div className="mt-5">
          <h4 className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Lost Souls per deck
          </h4>
          <BarList
            className="mt-2"
            rows={lostSoulSpread.map(([count, decks]) => ({
              key: String(count),
              label: `${count}`,
              value: decks,
              note: `${decks} deck${decks === 1 ? "" : "s"}`,
            }))}
            max={Math.max(...lostSoulSpread.map(([, decks]) => decks), 1)}
            unit="decks"
            compactLabel
          />
        </div>
      </Panel>

      <Panel
        title="Reserve tech"
        blurb="Cards the field kept mostly in the reserve rather than the main deck."
      >
        {reserveTech.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No card was played predominantly from the reserve.
          </p>
        ) : (
          <BarList
            rows={reserveTech.map((card) => ({
              key: card.key,
              label: card.name,
              value: card.reserveDecks,
              note: `${card.reserveCopies}r / ${card.mainCopies}m`,
            }))}
            max={breakdown.deckCount}
            unit={`of ${breakdown.deckCount} decks`}
          />
        )}
      </Panel>
    </div>
  );
}

function Panel({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mb-4 mt-1 max-w-prose text-sm text-muted-foreground">{blurb}</p>
      <div className="rounded-xl bg-card px-4 py-4">{children}</div>
    </section>
  );
}

interface BarRow {
  key: string;
  label: string;
  value: number;
  note?: string;
  swatch?: { light: string; dark: string };
}

function BarList({
  rows,
  max,
  unit,
  className = "",
  compactLabel = false,
}: {
  rows: BarRow[];
  max: number;
  unit: string;
  className?: string;
  compactLabel?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to show.</p>;
  }

  return (
    // space-y gives the 2px+ surface gap between adjacent fills.
    <ul className={`space-y-2 ${className}`}>
      {rows.map((row) => {
        const width = max === 0 ? 0 : Math.max((row.value / max) * 100, 1);
        return (
          <li key={row.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <span
              className={`flex items-center gap-2 truncate text-xs text-foreground ${
                compactLabel ? "w-6 justify-end tabular-nums" : "w-28 sm:w-36"
              }`}
              title={row.label}
            >
              {row.swatch && (
                <span
                  aria-hidden
                  className="brigade-dot inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={
                    {
                      "--dot-light": row.swatch.light,
                      "--dot-dark": row.swatch.dark,
                    } as React.CSSProperties
                  }
                />
              )}
              <span className="truncate">{row.label}</span>
            </span>

            <span className="h-2.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
              <span
                className="block h-full rounded-full bg-primary/70"
                style={{ width: `${width}%` }}
              />
            </span>

            <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              <span className="font-semibold text-foreground">{row.value}</span>
              {row.note ? <span className="ml-1">· {row.note}</span> : null}
              <span className="sr-only"> {unit}</span>
            </span>
          </li>
        );
      })}

      <style jsx>{`
        .brigade-dot {
          background-color: var(--dot-light);
        }
        :global(.dark) .brigade-dot {
          background-color: var(--dot-dark);
        }
      `}</style>
    </ul>
  );
}
