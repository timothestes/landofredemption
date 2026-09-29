"use client";

import { useMemo, useState } from "react";
import type { TournamentBreakdown } from "@/lib/tournament/breakdown";
import { cutIndexesByEvent, rankedDeckCount } from "@/lib/tournament/topCut";
import { deriveCards } from "@/lib/tournament/derive";
import StatStrip from "@/components/metagame/StatStrip";
import CardFrequencyTable from "@/components/metagame/CardFrequencyTable";
import StaplesScatter from "@/components/metagame/StaplesScatter";
import DistributionPanels from "@/components/metagame/DistributionPanels";
import DeckDna from "@/components/metagame/DeckDna";

export type ViewKey = "cards" | "meta" | "decks";

const VIEWS: { key: ViewKey; label: string; blurb: string }[] = [
  { key: "cards", label: "Cards", blurb: "What the field played" },
  { key: "meta", label: "Metagame", blurb: "What separated the top tables" },
  { key: "decks", label: "Decks", blurb: "How the lists relate to each other" },
];

export default function BreakdownClient({
  breakdown,
  fieldSize,
}: {
  breakdown: TournamentBreakdown;
  fieldSize: number;
}) {
  const [view, setView] = useState<ViewKey>("cards");
  const [topCut, setTopCut] = useState<number>(8);

  // One event, so `cutIndexesByEvent` collapses to ranking the whole field —
  // the decks here carry no event tag and fall into a single group.
  const cutSet = useMemo(
    () => cutIndexesByEvent(breakdown.decks, topCut),
    [breakdown.decks, topCut],
  );
  const rankedCount = useMemo(() => rankedDeckCount(breakdown.decks), [breakdown.decks]);

  const cards = useMemo(
    () => deriveCards(breakdown.cards, breakdown.deckCount, cutSet),
    [breakdown.cards, breakdown.deckCount, cutSet],
  );

  return (
    <div className="space-y-8">
      <StatStrip breakdown={breakdown} fieldSize={fieldSize} />

      <div>
        <div
          role="tablist"
          aria-label="Breakdown views"
          className="flex flex-wrap gap-2"
        >
          {VIEWS.map((entry) => {
            const isActive = entry.key === view;
            return (
              <button
                key={entry.key}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => setView(entry.key)}
                className={`flex-1 sm:flex-none inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border px-3 text-sm transition-colors ${
                  isActive
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-foreground/[0.03] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                }`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-muted-foreground">
          {VIEWS.find((v) => v.key === view)?.blurb}
        </p>
      </div>

      {view === "cards" && (
        <CardFrequencyTable
          cards={cards}
          deckCount={breakdown.deckCount}
          decks={breakdown.decks}
          cutSize={cutSet.size}
          topCut={topCut}
          onTopCutChange={setTopCut}
          rankedDeckCount={rankedCount}
        />
      )}

      {view === "meta" && (
        <div className="space-y-8">
          <StaplesScatter
            cards={cards}
            deckCount={breakdown.deckCount}
            cutSize={cutSet.size}
            topCut={topCut}
            onTopCutChange={setTopCut}
            rankedDeckCount={rankedCount}
          />
          <DistributionPanels breakdown={breakdown} cards={cards} />
        </div>
      )}

      {view === "decks" && <DeckDna breakdown={breakdown} />}
    </div>
  );
}
