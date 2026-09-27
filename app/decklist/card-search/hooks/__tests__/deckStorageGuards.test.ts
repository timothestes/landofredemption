import { describe, it, expect } from "vitest";
import { canPersistDeckToStorage, isDisplacedDraft, snapshotDeck } from "../useDeckState";
import type { Deck } from "../../types/deck";
import type { Card } from "../../utils";

function deckWith(overrides: Partial<Deck> & { cardCount?: number }): Deck {
  const { cardCount = 1, ...rest } = overrides;
  const card = { name: "Angel of the Lord", set: "Roots", imgFile: "aotl.jpg", type: "Hero" } as unknown as Card;
  return {
    name: "Untitled Deck",
    description: "",
    cards: cardCount > 0 ? [{ card, quantity: cardCount, zone: "main" }] : [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...rest,
  };
}

describe("canPersistDeckToStorage", () => {
  // The production bug: the persist effect wrote the SSR default deck before the
  // deferred read restored the draft, so a reload came back empty.
  it("refuses to write before the initial read from storage has run", () => {
    expect(canPersistDeckToStorage({ hasLoadedFromStorage: false, localStoragePersist: true })).toBe(false);
  });

  it("writes once the initial read has run", () => {
    expect(canPersistDeckToStorage({ hasLoadedFromStorage: true, localStoragePersist: true })).toBe(true);
  });

  it("never writes when the host disables localStorage (the Forge)", () => {
    expect(canPersistDeckToStorage({ hasLoadedFromStorage: true, localStoragePersist: false })).toBe(false);
  });
});

describe("isDisplacedDraft", () => {
  it("is not displaced when the incoming deck is the same deck", () => {
    const draft = deckWith({ id: "deck-a" });
    expect(isDisplacedDraft(draft, null, "deck-a")).toBe(false);
  });

  it("is not displaced when the draft has no cards", () => {
    const draft = deckWith({ cardCount: 0 });
    expect(isDisplacedDraft(draft, null, "deck-b")).toBe(false);
  });

  it("treats a never-saved draft with cards as displaced work", () => {
    const draft = deckWith({});
    expect(isDisplacedDraft(draft, null, "deck-b")).toBe(true);
  });

  it("does not nag when a clean cloud deck is left in storage", () => {
    const draft = deckWith({ id: "deck-a" });
    expect(isDisplacedDraft(draft, snapshotDeck(draft), "deck-b")).toBe(false);
  });

  it("protects a cloud deck edited since its last sync", () => {
    const saved = deckWith({ id: "deck-a" });
    const edited = deckWith({ id: "deck-a", cardCount: 2 });
    expect(isDisplacedDraft(edited, snapshotDeck(saved), "deck-b")).toBe(true);
  });
});
