"use client";

import { useState } from "react";
import { cardBrigades } from "@/lib/tournament/brigades";
import { brigadeRank, brigadeSwatch } from "@/lib/tournament/brigadeColors";

export interface BrigadeBarCard {
  brigade?: string | null;
  alignment?: string | null;
  quantity: number;
  zone?: string;
}

/**
 * A deck's cards by brigade: one segmented bar in each brigade's own swatch,
 * with the counts printed beneath in the same order (good brigades, then
 * neutral, then evil; Gold told apart by side). Colour is a mnemonic, the
 * printed numbers are the reading. Hovering (or tapping) a segment names it
 * in a small label above the bar, and highlights its count below. The maybeboard is not part of the deck;
 * Lost Souls and other brigadeless cards are left out.
 */
export default function BrigadeBar({ cards }: { cards: BrigadeBarCard[] }) {
  const [active, setActive] = useState<string | null>(null);
  const copies = new Map<string, number>();
  for (const card of cards) {
    if (card.zone === "maybeboard") continue;
    for (const brigade of cardBrigades(card.brigade ?? undefined, card.alignment ?? undefined)) {
      copies.set(brigade, (copies.get(brigade) ?? 0) + card.quantity);
    }
  }
  const slices = [...copies.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => brigadeRank(a.label) - brigadeRank(b.label));
  if (slices.length === 0) {
    return <p className="text-sm text-muted-foreground">No brigade cards.</p>;
  }

  const total = slices.reduce((n, slice) => n + slice.count, 0);
  let before = 0;
  const placed = slices.map((slice) => {
    const center = ((before + slice.count / 2) / total) * 100;
    before += slice.count;
    return { ...slice, center };
  });
  const hovered = placed.find((slice) => slice.label === active) ?? null;

  return (
    <div onPointerLeave={() => setActive(null)}>
      <div className="relative">
        {hovered && (
          <span
            role="status"
            className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
            // Clamped so a label over the first or last segment stays inside the bar's width.
            style={{ left: `clamp(2.5rem, ${hovered.center}%, calc(100% - 2.5rem))` }}
          >
            <span className="font-semibold tabular-nums">{hovered.count}</span> {hovered.label}
          </span>
        )}
        <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-foreground/[0.06]">
          {placed.map(({ label, count }) => {
            const swatch = brigadeSwatch(label);
            return (
              <button
                key={label}
                type="button"
                aria-label={`${label}: ${count}`}
                onPointerEnter={() => setActive(label)}
                onFocus={() => setActive(label)}
                onBlur={() => setActive(null)}
                onClick={() => setActive(active === label ? null : label)}
                className="block h-full min-w-[3px] bg-[var(--sw-light)] transition-[filter] hover:brightness-110 dark:bg-[var(--sw-dark)]"
                style={{ flex: `${count} 1 0%`, "--sw-light": swatch.light, "--sw-dark": swatch.dark } as React.CSSProperties}
              />
            );
          })}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
        {placed.map(({ label, count }, i) => (
          <span key={label}>
            {i > 0 ? " · " : ""}
            <span className={label === active ? "font-semibold text-foreground" : undefined}>
              {label} {count}
            </span>
          </span>
        ))}
      </p>
    </div>
  );
}
