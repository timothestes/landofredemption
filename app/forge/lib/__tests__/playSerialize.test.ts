import { describe, it, expect } from "vitest";
import { buildForgePlayDeck, sanitizeParagon, buildForgeGoldfishCards } from "../playSerialize";
import type { ForgeDeckEntry } from "../deckTypes";
import type { ForgePlayResolverEntry } from "../playDecks";

const FORGE_ID = "11111111-2222-3333-4444-555555555555";

const resolverEntry = (overrides: Partial<ForgePlayResolverEntry> = {}): ForgePlayResolverEntry => ({
  cardId: FORGE_ID,
  name: "Playtest Hero",
  rawText: "Some raw ability text.",
  hasFinished: false,
  versionId: "v1",
  typeDisplay: "",
  alignment: "",
  brigade: "",
  strength: "",
  toughness: "",
  identifier: "",
  reference: "",
  cardClass: "",
  ...overrides,
});

describe("buildForgePlayDeck", () => {
  it("serializes forge entries as opaque stubs with zero text fields", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 2, zone: "main" },
    ];
    const { deckData, dropped } = buildForgePlayDeck(entries, () => resolverEntry());
    expect(dropped).toBe(0);
    expect(deckData).toHaveLength(2);
    for (const c of deckData) {
      expect(c.cardImgFile).toBe(`forge:${FORGE_ID}`);
      expect(c.cardSet).toBe("Forge");
      expect(c.isReserve).toBe(false);
      // THE LEAK ASSERTION: every other text field is empty — cardType now
      // deliberately carries the type/'LS' contract (see tests below).
      for (const key of ["cardName","brigade","strength","toughness","alignment","identifier","reference","specialAbility"] as const) {
        expect(c[key]).toBe("");
      }
    }
  });

  it("drops unresolved (ungranted/revoked) forge entries (fail-closed) and counts them", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 3, zone: "main" },
    ];
    const { deckData, dropped } = buildForgePlayDeck(entries, () => undefined);
    expect(deckData).toHaveLength(0);
    expect(dropped).toBe(3);
  });

  it("marks reserve-zone entries and skips maybeboard", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "reserve" },
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "maybeboard" as any },
    ];
    const { deckData } = buildForgePlayDeck(entries, () => resolverEntry());
    expect(deckData).toHaveLength(1);
    expect(deckData[0].isReserve).toBe(true);
  });

  it("serializes public entries with full enrichment (real card from the registry)", () => {
    // 'Son of God' exists in every Redemption card registry snapshot.
    const entries: ForgeDeckEntry[] = [
      { source: "public", name: "Son of God", set: "Promo", qty: 1, zone: "main" },
    ];
    const { deckData } = buildForgePlayDeck(entries, () => resolverEntry());
    expect(deckData).toHaveLength(1);
    expect(deckData[0].cardName).toBe("Son of God");
    expect(deckData[0].cardImgFile).not.toContain("forge:");
  });

  it("routes a Lost Soul type display to the 'LS' server auto-route contract", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "main" },
    ];
    const { deckData } = buildForgePlayDeck(entries, () => resolverEntry({ typeDisplay: "Lost Soul" }));
    expect(deckData[0].cardType).toBe("LS");
    // Name/rawText must never leak into any stub field, even for lost souls.
    expect(deckData[0].cardName).toBe("");
    expect(deckData[0].specialAbility).toBe("");
  });

  it("passes a non-lost-soul type display through verbatim", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "main" },
    ];
    const { deckData } = buildForgePlayDeck(entries, () => resolverEntry({ typeDisplay: "Hero" }));
    expect(deckData[0].cardType).toBe("Hero");
  });

  it("routes a multi-type card containing Lost Soul to 'LS'", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "main" },
    ];
    const { deckData } = buildForgePlayDeck(entries, () => resolverEntry({ typeDisplay: "Lost Soul/Site" }));
    expect(deckData[0].cardType).toBe("LS");
  });
});

describe("sanitizeParagon", () => {
  it("passes a real paragon through and blanks everything else", () => {
    expect(sanitizeParagon(null)).toBe("");
    expect(sanitizeParagon("Totally Not A Paragon (unreleased card name)")).toBe("");
  });
});

describe("buildForgeGoldfishCards", () => {
  it("resolves a granted forge entry with name/text from the resolver, preserving quantity", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 3, zone: "main" },
    ];
    const entry = resolverEntry();
    const cards = buildForgeGoldfishCards(entries, () => entry);
    expect(cards).toHaveLength(1); // NOT expanded — goldfish takes quantity, unlike buildForgePlayDeck
    const c = cards[0];
    expect(c.card_name).toBe(entry.name);
    expect(c.card_special_ability).toBe(entry.rawText);
    expect(c.card_set).toBe("Forge");
    expect(c.card_img_file.startsWith("/forge/api/art/")).toBe(true);
    expect(c.quantity).toBe(3);
    expect(c.is_reserve).toBe(false);
  });

  it("restores searchable metadata (alignment/brigade/stats/identifier/reference) from the resolver", () => {
    // Regression: goldfish forge cards had card_alignment: "" hardcoded, so the
    // in-game Search Deck alignment/brigade/identifier/reference filters never
    // matched them even though the resolver knows the values.
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "main" },
    ];
    const entry = resolverEntry({
      alignment: "Evil", brigade: "Gray", strength: "7", toughness: "6",
      identifier: "Demon", reference: "Revelation 8:11",
    });
    const c = buildForgeGoldfishCards(entries, () => entry)[0];
    expect(c.card_alignment).toBe("Evil");
    expect(c.card_brigade).toBe("Gray");
    expect(c.card_strength).toBe("7");
    expect(c.card_toughness).toBe("6");
    expect(c.card_identifier).toBe("Demon");
    expect(c.card_reference).toBe("Revelation 8:11");
  });

  it("emits the resolver's type display string in card_type (LostSoul, not 'LS')", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "main" },
    ];
    const cards = buildForgeGoldfishCards(entries, () => resolverEntry({ typeDisplay: "Lost Soul" }));
    expect(cards[0].card_type).toBe("Lost Soul");
  });

  it("drops unresolved (revoked) forge entries entirely", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 2, zone: "main" },
    ];
    const cards = buildForgeGoldfishCards(entries, () => undefined);
    expect(cards).toHaveLength(0);
  });

  it("never leaks the public CDN base or a bare forge: URI into card_img_file", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "main" },
    ];
    // A finished image wins → the finished proxy URL
    const finished = buildForgeGoldfishCards(entries, () => resolverEntry({ hasFinished: true }))[0];
    expect(finished.card_img_file.startsWith("/forge/api/art/")).toBe(true);
    expect(finished.card_img_file).toContain("kind=finished");
    expect(finished.card_img_file).not.toContain("forge:");

    // No finished image → the server-rendered card: never '' and never a bare forge: uri
    const rendered = buildForgeGoldfishCards(entries, () => resolverEntry({ hasFinished: false }))[0];
    expect(rendered.card_img_file.startsWith("/forge/api/art/")).toBe(true);
    expect(rendered.card_img_file).toContain("kind=rendered");
    expect(rendered.card_img_file).not.toContain("forge:");
  });

  it("skips maybeboard entries and marks reserve-zone entries", () => {
    const entries: ForgeDeckEntry[] = [
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "reserve" },
      { source: "forge", cardId: FORGE_ID, qty: 1, zone: "maybeboard" as any },
    ];
    const entry = resolverEntry();
    const cards = buildForgeGoldfishCards(entries, () => entry);
    expect(cards).toHaveLength(1);
    expect(cards[0].is_reserve).toBe(true);
  });

  it("enriches public entries from the real card registry", () => {
    // 'Son of God' exists in every Redemption card registry snapshot.
    const entries: ForgeDeckEntry[] = [
      { source: "public", name: "Son of God", set: "Promo", qty: 2, zone: "main" },
    ];
    const cards = buildForgeGoldfishCards(entries, () => undefined);
    expect(cards).toHaveLength(1);
    expect(cards[0].card_name).toBe("Son of God");
    expect(cards[0].quantity).toBe(2);
    expect(cards[0].card_img_file).not.toContain("forge:");
  });
});
