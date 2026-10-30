import { describe, it, expect, vi } from "vitest";
import { makeForgeBuilderConfig } from "../forgeBuilderConfig";
import { generateDeckText, parseDeckText } from "@/app/decklist/card-search/utils/deckImportExport";
import type { Card } from "@/app/decklist/card-search/utils";
import type { GrantedForgeCard } from "@/app/forge/lib/deckPool";
import type { DesignCard } from "@/app/forge/lib/designCard";

// The config only *references* the server actions; none of these tests hit a
// server, so mock the whole module (listDecks mapping is asserted below).
vi.mock("@/app/forge/lib/forgeDecks", () => ({
  saveForgeDeck: vi.fn(),
  getForgeDeck: vi.fn(),
  listForgeDecks: vi.fn(async () => [
    { id: "d1", name: "Alpha", format: "Type 1", cardCount: 50, updatedAt: "2026-07-01T00:00:00.000Z" },
  ]),
}));

const card = (imgFile: string): Card => ({ imgFile, dataLine: "", name: "x", set: "x" } as unknown as Card);

const grantedCard = (cardId: string, name: string): GrantedForgeCard => ({
  cardId,
  setId: "set-1",
  setName: "Test Set",
  hasApprovedArt: false,
  hasApprovedFinished: false,
  versionId: "version-1",
  data: {
    name,
    cardType: ["LostSoul"],
    brigades: [],
    testament: [],
    identifiers: [],
    specialAbility: "",
    strength: null,
    toughness: null,
    reference: "",
    scripture: "",
    legality: "",
    rarity: "",
    alignment: "Neutral",
  } as unknown as DesignCard,
});

describe("makeForgeBuilderConfig", () => {
  const config = makeForgeBuilderConfig([]);

  it("feature gates: public-only features off, delete + import/export on", () => {
    expect(config.features).toEqual({
      localStoragePersist: false,
      syncFiltersToUrl: false,
      enableSharing: false,
      enableDeckDelete: true,
      enableImportExport: true,
      enablePhotoImport: false,
      enablePrintExports: false,
      enableShopping: false,
      enableDetailsTab: false,
      serverDeckCheck: false,
      enableLegalityChecks: false,
    });
  });

  it("resolves public cards to a URL", () => {
    expect(config.resolveCardImage(card("069-An-Angel-Appears")).kind).toBe("url");
  });

  it("resolves forge cards (imgFile is a forge dataLine) to a composite element, never a URL", () => {
    // imgFile keyed (not dataLine) so loaded/saved forge cards still render forge art.
    expect(config.resolveCardImage(card("forge:abc")).kind).toBe("element");
  });

  it("renders an explicit unavailable tile (not nothing) for a dangling forge ref", () => {
    const r = config.resolveCardImage(card("forge:gone"));
    expect(r.kind).toBe("element");
    expect(r.kind === "element" && r.node).toBeTruthy();
  });

  it("injects a forge_decks persistence override", () => {
    expect(config.persistence?.save).toBeTypeOf("function");
    expect(config.persistence?.loadById).toBeTypeOf("function");
  });

  it("rehydrates loaded forge rows to the full pool card via resolveCard", () => {
    const cfg = makeForgeBuilderConfig([grantedCard("11111111-2222-3333-4444-555555555555", "Test Soul")]);
    const resolved = cfg.persistence?.resolveCard?.({
      card_name: "Test Soul",
      card_set: "Forge",
      card_img_file: "forge:11111111-2222-3333-4444-555555555555",
    });
    expect(resolved?.name).toBe("Test Soul");
    expect(resolved?.type).not.toBe("Unknown");
  });

  it("resolveCard falls through (null) for public rows and dangling forge refs", () => {
    const cfg = makeForgeBuilderConfig([]);
    expect(
      cfg.persistence?.resolveCard?.({ card_name: "A", card_set: "Wom", card_img_file: "a-card" })
    ).toBeNull();
    expect(
      cfg.persistence?.resolveCard?.({ card_name: "B", card_set: "Forge", card_img_file: "forge:dead" })
    ).toBeNull();
  });
});

describe("forge persistence.listDecks", () => {
  it("maps ForgeDeckSummary to the modal's DeckListItem shape", async () => {
    const config = makeForgeBuilderConfig([]);
    const items = await config.persistence!.listDecks!();
    expect(items).toEqual([
      { id: "d1", name: "Alpha", format: "Type 1", card_count: 50, updated_at: "2026-07-01T00:00:00.000Z" },
    ]);
  });
});

describe("forge text export/import round-trip", () => {
  it("a forge card survives generateDeckText → parseDeckText against the pool", () => {
    const config = makeForgeBuilderConfig([grantedCard("abc-123", "My Forge Hero")]);
    const forgeCard = config.pool[0];
    const deck = {
      name: "T",
      cards: [{ card: forgeCard, quantity: 2, zone: "main" as const }],
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const text = generateDeckText(deck);
    expect(text).toBe("2\tMy Forge Hero");
    const result = parseDeckText(text, config.pool);
    expect(result.errors).toEqual([]);
    expect(result.deck!.cards[0].card.imgFile).toBe("forge:abc-123");
    expect(result.deck!.cards[0].quantity).toBe(2);
    expect(result.deck!.cards[0].zone).toBe("main");
  });
});
