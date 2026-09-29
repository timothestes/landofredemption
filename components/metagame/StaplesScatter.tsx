"use client";

import { useMemo, useState } from "react";
import type { DerivedCard } from "@/lib/tournament/derive";
import TopCutControl from "./TopCutControl";

/**
 * Field play rate against top-cut play rate.
 *
 * The diagonal is "played at the same rate everywhere". Distance from it is a
 * signed quantity with a meaningful zero, so it takes a diverging scale: one
 * warm pole, one cool pole, neutral grey at the line. Position already encodes
 * the value twice over, which is what lets the colour stay a reading aid.
 *
 * Deliberately one plot with one pair of axes — the two rates share a scale
 * (share of decks, 0–100%), so they belong on the same square.
 */

const MIN_DECK_OPTIONS = [2, 4, 8];

interface Point extends DerivedCard {
  x: number;
  y: number;
}

export default function StaplesScatter({
  cards,
  deckCount,
  cutSize,
  topCut,
  onTopCutChange,
  rankedDeckCount,
  cutOptions,
  perEventCut = false,
}: {
  cards: DerivedCard[];
  deckCount: number;
  cutSize: number;
  topCut: number;
  onTopCutChange: (value: number) => void;
  rankedDeckCount: number;
  cutOptions?: { value: number; label: string }[];
  perEventCut?: boolean;
}) {
  const [minDecks, setMinDecks] = useState(4);
  const [hovered, setHovered] = useState<string | null>(null);

  const points: Point[] = useMemo(
    () =>
      cards
        .filter((card) => card.decks >= minDecks)
        .map((card) => ({ ...card, x: card.fieldRate, y: card.topCutRate })),
    [cards, minDecks],
  );

  // Plot geometry in viewBox units.
  const W = 480;
  const H = 380;
  const PAD = { top: 18, right: 18, bottom: 44, left: 46 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const sx = (v: number) => PAD.left + v * plotW;
  const sy = (v: number) => PAD.top + (1 - v) * plotH;

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  /**
   * Direct labels for the strongest movers, placed greedily.
   *
   * Top-cut share is quantised — with 8 decks in the cut a point can only sit
   * on one of nine rows — so candidates pile up at identical coordinates and
   * naive placement overprints them into mush. Each candidate is tried above
   * its point and then below; if both boxes overlap a label already placed, it
   * is dropped. Fewer labels beats unreadable ones, and every point still
   * carries its name on hover and in its <title>.
   */
  const labels = useMemo(() => {
    const CHAR_W = 4.5;
    const LINE_H = 11;
    const candidates = [...points].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 14);

    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    const out: { key: string; text: string; x: number; y: number }[] = [];

    for (const point of candidates) {
      const text =
        point.name.length > 18 ? `${point.name.slice(0, 17).trimEnd()}…` : point.name;
      const halfWidth = (text.length * CHAR_W) / 2;
      const cx = sx(point.x);
      const cy = sy(point.y);

      for (const dy of [-10, 14]) {
        const box = {
          x1: cx - halfWidth,
          y1: cy + dy - LINE_H / 2,
          x2: cx + halfWidth,
          y2: cy + dy + LINE_H / 2,
        };
        // Keep labels inside the plot rather than clipping at the edges.
        if (box.x1 < 2 || box.x2 > W - 2 || box.y1 < 2 || box.y2 > H - PAD.bottom) continue;
        const collides = placed.some(
          (other) =>
            box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1,
        );
        if (collides) continue;
        placed.push(box);
        out.push({ key: point.key, text, x: cx, y: cy + dy + 3 });
        break;
      }
    }
    return out;
  }, [points, plotW, plotH]);

  const active = hovered ? points.find((p) => p.key === hovered) ?? null : null;

  return (
    <section className="scatter-root space-y-4">
      <header className="space-y-2">
        <h2 className="text-lg font-semibold text-foreground">Staples &amp; tech</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Every card, placed by how much of the whole field played it against how
          much of the top cut did. Cards above the line were played more by the
          decks that finished well; cards below it, less.
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <TopCutControl
            topCut={topCut}
            onChange={onTopCutChange}
            cutSize={cutSize}
            rankedDeckCount={rankedDeckCount}
            options={cutOptions}
            perEvent={perEventCut}
          />
          <div className="flex items-center gap-2">
            <span className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Min decks
            </span>
            <div className="inline-flex gap-1 rounded-lg bg-muted/50 p-0.5">
              {MIN_DECK_OPTIONS.map((option) => {
                const isActive = option === minDecks;
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMinDecks(option)}
                    aria-pressed={isActive}
                    className={`rounded-md px-2.5 py-1 text-xs tabular-nums transition-colors ${
                      isActive
                        ? "bg-card font-semibold text-foreground shadow-sm"
                        : "font-medium text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option}+
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Capped rather than full-bleed: the viewBox is 480 units wide, so a
          1100px container scales every label and tick up by 2.3× and the plot
          swamps the page. */}
      <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-xl bg-card p-2 sm:p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Scatter plot of ${points.length} cards comparing field play rate with top-cut play rate.`}
        >
          {/* Recessive grid — hairline, never dashed. */}
          {ticks.map((tick) => (
            <g key={`grid-${tick}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + plotW}
                y1={sy(tick)}
                y2={sy(tick)}
                className="stroke-foreground/10"
                strokeWidth={1}
              />
              <line
                y1={PAD.top}
                y2={PAD.top + plotH}
                x1={sx(tick)}
                x2={sx(tick)}
                className="stroke-foreground/10"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={sy(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {Math.round(tick * 100)}%
              </text>
              <text
                x={sx(tick)}
                y={PAD.top + plotH + 16}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px] tabular-nums"
              >
                {Math.round(tick * 100)}%
              </text>
            </g>
          ))}

          {/* Parity line. */}
          <line
            x1={sx(0)}
            y1={sy(0)}
            x2={sx(1)}
            y2={sy(1)}
            className="stroke-foreground/25"
            strokeWidth={1.5}
          />

          <text
            x={PAD.left + plotW / 2}
            y={H - 6}
            textAnchor="middle"
            className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-[0.1em]"
          >
            Share of field
          </text>
          <text
            x={12}
            y={PAD.top + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}
            className="fill-muted-foreground text-[10px] font-semibold uppercase tracking-[0.1em]"
          >
            Share of top cut
          </text>

          {points.map((point) => {
            const isActive = point.key === hovered;
            // Diverging: warm above the line, cool below, neutral at it.
            const tone =
              point.delta > 0.05
                ? "var(--scatter-warm)"
                : point.delta < -0.05
                  ? "var(--scatter-cool)"
                  : "var(--scatter-mid)";
            return (
              <circle
                key={point.key}
                cx={sx(point.x)}
                cy={sy(point.y)}
                r={isActive ? 7 : 4.5}
                fill={tone}
                fillOpacity={isActive ? 1 : 0.75}
                // A 2px surface ring keeps overlapping marks legible.
                stroke="var(--scatter-surface)"
                strokeWidth={2}
                className="cursor-pointer transition-all"
                onMouseEnter={() => setHovered(point.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{`${point.name}: ${Math.round(point.x * 100)}% of field, ${Math.round(point.y * 100)}% of cut`}</title>
              </circle>
            );
          })}

          {labels
            .filter((label) => label.key !== hovered)
            .map((label) => (
              <text
                key={`label-${label.key}`}
                x={label.x}
                y={label.y}
                textAnchor="middle"
                className="pointer-events-none fill-foreground/70 text-[9px] font-medium"
                // A surface-coloured halo keeps a label legible where it has to
                // sit over the dense band of points near the axis.
                style={{
                  paintOrder: "stroke",
                  stroke: "var(--scatter-surface)",
                  strokeWidth: 3,
                  strokeLinejoin: "round",
                }}
              >
                {label.text}
              </text>
            ))}
        </svg>

        {active && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-[15rem] rounded-lg bg-background/90 px-3 py-2 shadow-lg backdrop-blur-md">
            <p className="text-sm font-semibold text-foreground">{active.name}</p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {active.decks}/{deckCount} of field ({Math.round(active.x * 100)}%)
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {active.topCutDecks}/{cutSize} of cut ({Math.round(active.y * 100)}%)
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <LegendKey tone="var(--scatter-warm)" label="Over-played by the cut" />
        <LegendKey tone="var(--scatter-mid)" label="Played at parity" />
        <LegendKey tone="var(--scatter-cool)" label="Under-played by the cut" />
      </div>
      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground/80">
        With {cutSize} decks in the cut, a single player&rsquo;s choices move a
        card several points. Treat the extremes as questions worth asking, not
        answers. The Cards tab lists the same figures as a sortable table.
      </p>

      <style jsx>{`
        .scatter-root {
          --scatter-warm: #d1590a;
          --scatter-cool: #2a6fd6;
          --scatter-mid: #8a8f98;
          --scatter-surface: hsl(var(--card));
        }
        :global(.dark) .scatter-root {
          --scatter-warm: #f38a3c;
          --scatter-cool: #5b9bef;
          --scatter-mid: #79808c;
        }
      `}</style>
    </section>
  );
}

function LegendKey({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: tone }}
      />
      {label}
    </span>
  );
}
