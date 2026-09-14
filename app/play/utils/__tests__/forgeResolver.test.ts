import { describe, it, expect } from "vitest";
import { forgeCardIdFromImgFile, forgeProxyUrl, resolveCardImageUrl, mergeForgeDeckData, resolveBattleRowFields, resolveForgeCardName, forgeRenderWarmUrls } from "../forgeResolver";
import { getEffectiveAbilities } from "@/lib/cards/cardAbilities";
import { getCardImageUrl, getCardImageUrlOrNull } from "@/app/shared/utils/cardImageUrl";
import { RENDER_VERSION } from "@/app/forge/lib/renderVersion";

const ID = "11111111-2222-3333-4444-555555555555";
const entry = {
  cardId: ID, name: "Test Hero", rawText: "Does things.", hasFinished: true, versionId: "v-1",
  typeDisplay: "Hero", alignment: "Good", brigade: "Blue", strength: "5", toughness: "4",
  identifier: "Judah", reference: "Genesis 1:1", cardClass: "Warrior",
};
const resolver = new Map([[ID, entry]]);

describe("forge image seams", () => {
  it("getCardImageUrl returns '' for forge: URIs (never the public CDN)", () => {
    expect(getCardImageUrl(`forge:${ID}`)).toBe("");
  });
  it("getCardImageUrlOrNull passes through leading-/ URLs and nulls forge:", () => {
    expect(getCardImageUrlOrNull("/forge/api/art/x?v=approved")).toBe("/forge/api/art/x?v=approved");
    expect(getCardImageUrlOrNull(`forge:${ID}`)).toBeNull();
  });
  it("extracts the forge card id", () => {
    expect(forgeCardIdFromImgFile(`forge:${ID}`)).toBe(ID);
    expect(forgeCardIdFromImgFile("SomeCard.jpg")).toBeNull();
  });
  it("prefers the finished scan, else the rendered card of the released version", () => {
    expect(forgeProxyUrl(entry)).toBe(`/forge/api/art/${ID}?v=approved&kind=finished&t=v-1`);
    expect(forgeProxyUrl({ ...entry, hasFinished: false })).toBe(`/forge/api/art/${ID}?v=approved&kind=rendered&t=v-1.r${RENDER_VERSION}`);
  });
  it("forgeRenderWarmUrls lists each granted card without a finished image once", () => {
    const OTHER = "99999999-2222-3333-4444-555555555555";
    const map = new Map([[ID, { ...entry, hasFinished: false }], [OTHER, { ...entry, cardId: OTHER, hasFinished: true }]]);
    const cards = [
      { cardImgFile: `forge:${ID}` }, { cardImgFile: `forge:${ID}` }, { cardImgFile: `forge:${OTHER}` },
      { cardImgFile: "Public.jpg" }, { cardImgFile: "forge:not-granted" },
    ];
    expect(forgeRenderWarmUrls(cards, map as any)).toEqual([`/forge/api/art/${ID}?v=approved&kind=rendered&t=v-1.r${RENDER_VERSION}`]);
    expect(forgeRenderWarmUrls(cards, null)).toEqual([]);
  });
  it("resolveCardImageUrl: resolved -> proxy URL; unresolved -> ''", () => {
    expect(resolveCardImageUrl(`forge:${ID}`, resolver)).toContain("/forge/api/art/");
    expect(resolveCardImageUrl(`forge:${ID}`, new Map())).toBe("");
    expect(resolveCardImageUrl(`forge:${ID}`, null)).toBe("");
  });
  it("mergeForgeDeckData merges name/text/img and leaves public cards alone", () => {
    const cards = [
      { cardName: "", cardSet: "Forge", cardImgFile: `forge:${ID}`, cardType: "", brigade: "", strength: "", toughness: "", alignment: "", identifier: "", reference: "", specialAbility: "", isReserve: false },
      { cardName: "Public", cardSet: "S", cardImgFile: "Public.jpg", cardType: "", brigade: "", strength: "", toughness: "", alignment: "", identifier: "", reference: "", specialAbility: "", isReserve: false },
    ];
    const merged = mergeForgeDeckData(cards as any, resolver as any);
    expect(merged[0].cardName).toBe("Test Hero");
    expect(merged[0].specialAbility).toBe("Does things.");
    expect(merged[0].cardImgFile).toContain("/forge/api/art/");
    expect(merged[1]).toBe(cards[1]);
  });

  it("mergeForgeDeckData restores the searchable metadata (alignment/brigade/stats/identifier/reference)", () => {
    // Regression: the world-readable STDB row blanks these fields (leak spine),
    // so the owner's client must re-hydrate them — otherwise the in-game Search
    // Deck modal can't match forge cards by alignment/brigade/identifier/reference.
    const evil = {
      cardId: ID, name: "Wormwood", rawText: "Bad things.", hasFinished: false, versionId: "v-2",
      typeDisplay: "Evil Character", alignment: "Evil", brigade: "Gray", strength: "7", toughness: "6",
      identifier: "Demon", reference: "Revelation 8:11",
    };
    const cards = [
      { cardName: "", cardSet: "Forge", cardImgFile: `forge:${ID}`, cardType: "Evil Character", brigade: "", strength: "", toughness: "", alignment: "", identifier: "", reference: "", specialAbility: "", isReserve: false },
    ];
    const merged = mergeForgeDeckData(cards as any, new Map([[ID, evil]]) as any);
    expect(merged[0].alignment).toBe("Evil");
    expect(merged[0].brigade).toBe("Gray");
    expect(merged[0].strength).toBe("7");
    expect(merged[0].toughness).toBe("6");
    expect(merged[0].identifier).toBe("Demon");
    expect(merged[0].reference).toBe("Revelation 8:11");
  });
});

describe("resolveForgeCardName", () => {
  // Right-click abilities are keyed by card name. The world-readable STDB row
  // blanks the name on forge cards, so dispatching off the raw row found zero
  // abilities even though the context menu (which uses the resolved name)
  // offered them — the forge "Virgin Birth" right-click did nothing.
  const forgeRow = { cardImgFile: `forge:${ID}`, cardName: "" };

  it("returns the granted name for a forge row", () => {
    expect(resolveForgeCardName(forgeRow, resolver)).toBe("Test Hero");
  });

  it("keeps the blank name when the viewer has no grant — fail-closed", () => {
    expect(resolveForgeCardName(forgeRow, new Map())).toBe("");
    expect(resolveForgeCardName(forgeRow, null)).toBe("");
  });

  it("passes public rows through untouched", () => {
    expect(resolveForgeCardName({ cardImgFile: "Public.jpg", cardName: "Pub" }, resolver)).toBe("Pub");
  });

  it("makes a forge card's abilities dispatchable; blank name finds none", () => {
    const vb = new Map([[ID, { ...entry, name: "Virgin Birth" }]]);
    expect(getEffectiveAbilities({ cardName: resolveForgeCardName(forgeRow, vb) })).toHaveLength(1);
    expect(getEffectiveAbilities({ cardName: forgeRow.cardName })).toHaveLength(0);
  });
});

describe("resolveBattleRowFields", () => {
  // Battle-zone math (totals/initiative) reads CardInstance rows whose text
  // fields the leak spine blanked for forge cards. The viewer's granted
  // resolver must re-hydrate name/brigade/stats or forge cards read as unknown
  // stats.
  const blankRow = { cardImgFile: `forge:${ID}`, cardName: "", brigade: "", strength: "", toughness: "" };

  it("re-hydrates a granted forge row's name/brigade/stats", () => {
    expect(resolveBattleRowFields(blankRow, resolver)).toEqual({
      cardName: "Test Hero", brigade: "Blue", strength: "5", toughness: "4",
    });
  });

  it("leaves an ungranted forge row blank (fail-closed)", () => {
    expect(resolveBattleRowFields(blankRow, new Map())).toEqual({
      cardName: "", brigade: "", strength: "", toughness: "",
    });
    expect(resolveBattleRowFields(blankRow, null)).toEqual({
      cardName: "", brigade: "", strength: "", toughness: "",
    });
  });

  it("passes public rows through untouched", () => {
    const pub = { cardImgFile: "Moses.jpg", cardName: "Moses", brigade: "Blue", strength: "10", toughness: "10" };
    expect(resolveBattleRowFields(pub, resolver)).toEqual({
      cardName: "Moses", brigade: "Blue", strength: "10", toughness: "10",
    });
  });
});
