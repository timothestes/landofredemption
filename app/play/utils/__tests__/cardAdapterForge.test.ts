import { describe, it, expect } from "vitest";
import { cardInstanceToGameCard } from "../cardAdapter";
import { RENDER_VERSION } from "@/app/forge/lib/renderVersion";

const ID = "11111111-2222-3333-4444-555555555555";
const entry = {
  cardId: ID, name: "Test Hero", rawText: "Does things.", hasFinished: false, versionId: "v-9",
  typeDisplay: "Hero", alignment: "Good", brigade: "Blue", strength: "5", toughness: "4",
  identifier: "Judah", reference: "Genesis 1:1", cardClass: "Warrior",
};

function stubInstance(over: Record<string, unknown> = {}) {
  return {
    id: 1n, gameId: 1n, ownerId: 1n, originalOwnerId: 1n, zone: "hand", zoneIndex: 0n,
    posX: "", posY: "", isMeek: false, isFlipped: false,
    cardName: "", cardSet: "Forge", cardImgFile: `forge:${ID}`, cardType: "", brigade: "",
    strength: "", toughness: "", alignment: "", identifier: "", specialAbility: "",
    reference: "", notes: "", equippedToInstanceId: 0n, isSoulDeckOrigin: false,
    isToken: false, revealExpiresAt: undefined, revealStartedAt: undefined,
    outlineColor: "", imitatingName: "", ...over,
  } as any;
}

describe("cardInstanceToGameCard forge resolution", () => {
  it("merges name/text/proxy URL when resolver has the card", () => {
    const gc = cardInstanceToGameCard(stubInstance(), [], "player1", new Map([[ID, entry]]));
    expect(gc.cardName).toBe("Test Hero");
    expect(gc.specialAbility).toBe("Does things.");
    expect(gc.cardImgFile).toBe(`/forge/api/art/${ID}?v=approved&kind=rendered&t=v-9.r${RENDER_VERSION}`);
  });
  it("leaves the opaque URI when unresolved (fail-closed placeholder)", () => {
    const gc = cardInstanceToGameCard(stubInstance(), [], "player1", new Map());
    expect(gc.cardName).toBe("");
    expect(gc.cardImgFile).toBe(`forge:${ID}`);
  });
  it("does not touch public cards", () => {
    const gc = cardInstanceToGameCard(stubInstance({ cardImgFile: "Public.jpg", cardName: "Pub" }), [], "player1", new Map([[ID, entry]]));
    expect(gc.cardName).toBe("Pub");
    expect(gc.cardImgFile).toBe("Public.jpg");
  });
  it("restores searchable metadata from the resolver so the deck search can filter forge cards", () => {
    // The STDB row blanks alignment/brigade/stats/identifier/reference (leak
    // spine); the viewer's granted resolver re-hydrates them here. Without this
    // the in-game Search Deck alignment filter never matched forge cards.
    const gc = cardInstanceToGameCard(stubInstance(), [], "player1", new Map([[ID, entry]]));
    expect(gc.alignment).toBe("Good");
    expect(gc.brigade).toBe("Blue");
    expect(gc.strength).toBe("5");
    expect(gc.toughness).toBe("4");
    expect(gc.identifier).toBe("Judah");
    expect(gc.reference).toBe("Genesis 1:1");
  });
  it("keeps the blank STDB values for an unresolved (ungranted) forge card — no leak", () => {
    const gc = cardInstanceToGameCard(stubInstance(), [], "player1", new Map());
    expect(gc.alignment).toBe("");
    expect(gc.brigade).toBe("");
    expect(gc.reference).toBe("");
  });
  it("carries the forge class so the weapon-equip hit-test can see it", () => {
    // The STDB row has no class field at all and forge cards aren't in the
    // public index, so without this a forge Warrior could never host a weapon.
    expect(cardInstanceToGameCard(stubInstance(), [], "player1", new Map([[ID, entry]])).cardClass).toBe("Warrior");
    // Unresolved stays undefined rather than '' — nothing to assert about it.
    expect(cardInstanceToGameCard(stubInstance(), [], "player1", new Map()).cardClass).toBeUndefined();
    // Public cards never carry it; their class comes from the card index.
    expect(cardInstanceToGameCard(stubInstance({ cardImgFile: "Public.jpg" }), [], "player1", new Map([[ID, entry]])).cardClass).toBeUndefined();
  });
});
