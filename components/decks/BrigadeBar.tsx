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
 * printed numbers are the reading. The maybeboard is not part of the deck;
 * Lost Souls and other brigadeless cards are left out.
 */
export default function BrigadeBar({ cards }: { cards: BrigadeBarCard[] }) {
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

  return (
    <div>
      <span aria-hidden className="flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-foreground/[0.06]">
        {slices.map(({ label, count }) => {
          const swatch = brigadeSwatch(label);
          return (
            <span
              key={label}
              title={`${label} · ${count}`}
              className="block h-full min-w-[3px] bg-[var(--sw-light)] dark:bg-[var(--sw-dark)]"
              style={{ flex: `${count} 1 0%`, "--sw-light": swatch.light, "--sw-dark": swatch.dark } as React.CSSProperties}
            />
          );
        })}
      </span>
      <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
        {slices.map(({ label, count }) => `${label} ${count}`).join(" · ")}
      </p>
    </div>
  );
}
