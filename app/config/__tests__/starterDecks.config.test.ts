import { describe, it, expect } from "vitest";
import {
  STARTER_DECKS,
  hasStarterDecks,
  orderStarterDecks,
  type StarterDeckRow,
} from "../starterDecks";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("STARTER_DECKS config", () => {
  it("every deckId is a UUID", () => {
    for (const entry of STARTER_DECKS) {
      expect(entry.deckId, `deckId ${entry.deckId}`).toMatch(UUID_RE);
    }
  });

  it("deckIds are unique", () => {
    const ids = STARTER_DECKS.map((d) => d.deckId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("hasStarterDecks mirrors the list", () => {
    expect(hasStarterDecks()).toBe(STARTER_DECKS.length > 0);
  });
});

describe("orderStarterDecks", () => {
  const row = (id: string, name = `Deck ${id}`): StarterDeckRow => ({
    id,
    name,
    format: "Limited",
    card_count: 50,
    username: "owner",
    preview_card_1: null,
    preview_card_2: null,
    paragon: null,
  });

  it("returns rows in config order, not query order", () => {
    const config = [{ deckId: "a" }, { deckId: "b" }, { deckId: "c" }];
    const out = orderStarterDecks([row("c"), row("a"), row("b")], config);
    expect(out.map((d) => d.id)).toEqual(["a", "b", "c"]);
  });

  it("drops configured ids the query did not return and rows not in config", () => {
    const config = [{ deckId: "a" }, { deckId: "missing" }, { deckId: "b" }];
    const out = orderStarterDecks([row("b"), row("stray"), row("a")], config);
    expect(out.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("applies the optional label as the display name and passes the blurb through", () => {
    const config = [
      { deckId: "a", label: "Angels & Heroes", blurb: "Good-aligned starter." },
      { deckId: "b" },
    ];
    const out = orderStarterDecks([row("a", "Starter Deck (I)"), row("b", "Starter Deck (J)")], config);
    expect(out[0].name).toBe("Angels & Heroes");
    expect(out[0].blurb).toBe("Good-aligned starter.");
    expect(out[1].name).toBe("Starter Deck (J)");
    expect(out[1].blurb).toBeUndefined();
  });

  it("returns an empty list for an empty config", () => {
    expect(orderStarterDecks([row("a")], [])).toEqual([]);
  });
});
