import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SeedData, ResultEntry } from "@/lib/nationals/types";
import { SeedContext } from "../../seed-context";
import { TournamentDetailView } from "../TournamentDetailView";

const RESULTS_ID = "1a2b3c4d-0000-4726-9001-0a0020260120";
const DECK_ID = "437250ac-0828-476c-bcc3-e0fb01f28069";

function seedWith(rows: ResultEntry[], resultsIds?: Record<string, string>): SeedData {
  return {
    tournaments: [
      {
        id: "t26",
        year: 2026,
        location: "Wilmore, KY",
        dates: "July 23–25, 2026",
        venue: "",
        attendance: null,
        formats: ["T1 2-Player"],
        notes: "",
        resultsIds,
      },
    ],
    players: [],
    results: { "2026_T1 2-Player": rows },
    matches: {},
    multiWL: {},
  };
}

const row = (placement: number, playerName: string, deckId?: string): ResultEntry => ({
  id: `r${placement}`,
  playerName,
  placement,
  deck: "",
  record: "",
  notes: "",
  ...(deckId ? { deckId } : {}),
});

const render = (seed: SeedData) =>
  renderToStaticMarkup(
    createElement(
      SeedContext.Provider,
      { value: seed },
      createElement(TournamentDetailView, { tournamentId: "t26", setView: () => {}, back: () => {} })
    )
  );

// The <th> whose text is "Deck", so we can check its responsive classes.
const deckHeader = (html: string) => html.match(/<th class="([^"]*)">\s*Deck\s*<\/th>/)?.[1] ?? null;

describe("TournamentDetailView standings deck links", () => {
  it("links each published decklist and the format's results page", () => {
    const html = render(
      seedWith([row(1, "Justin Alstad", DECK_ID), row(2, "Ryan Greeson")], { "T1 2-Player": RESULTS_ID })
    );
    expect(html).toContain(`href="/decklist/${DECK_ID}"`);
    // Only the row with a published deck gets a link; the other stays a dash.
    expect(html.match(/href="\/decklist\//g)).toHaveLength(1);
    expect(html).toContain(`href="/tournaments/results/${RESULTS_ID}"`);
    // A column that carries links is worth its space on a phone.
    expect(deckHeader(html)).not.toBeNull();
    expect(deckHeader(html)).not.toContain("hidden");
  });

  it("keeps the deck column desktop-only and omits the results link when nothing is linked", () => {
    const html = render(seedWith([row(1, "Someone"), row(2, "Else")]));
    expect(html).not.toContain('href="/decklist/');
    expect(html).not.toContain('href="/tournaments/results/');
    expect(deckHeader(html)).toContain("hidden sm:table-cell");
  });
});
