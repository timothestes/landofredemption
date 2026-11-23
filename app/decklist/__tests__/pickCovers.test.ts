import { describe, expect, it } from "vitest";
import { pickCovers, type CoverCandidate } from "../pickCovers";

const card = (imgFile: string, type: string, zone = "main", quantity = 1): CoverCandidate => ({
  imgFile,
  type,
  zone,
  quantity,
});

const heroA = card("hero-a", "Hero");
const heroB = card("hero-b", "Hero");
const evilA = card("evil-a", "Evil Character");
const evilB = card("evil-b", "Evil Character");
const fort = card("fort", "Fortress");

describe("pickCovers", () => {
  it("keeps chosen covers that are still in the main deck", () => {
    expect(pickCovers(["hero-b", "fort"], [heroA, heroB, evilA, fort])).toEqual(["hero-b", "fort"]);
  });

  it("swaps a cut cover for the first Hero (cover 1) or first Evil Character (cover 2)", () => {
    expect(pickCovers(["gone", "evil-b"], [heroA, evilA, evilB])).toEqual(["hero-a", "evil-b"]);
    expect(pickCovers(["hero-a", "gone"], [heroA, evilA, evilB])).toEqual(["hero-a", "evil-a"]);
  });

  it("treats a cover moved to the Reserve or maybeboard, or down to zero copies, as cut", () => {
    const deck = [heroA, evilA, card("hero-b", "Hero", "reserve"), card("evil-b", "Evil Character", "maybeboard")];
    expect(pickCovers(["hero-b", "evil-b"], deck)).toEqual(["hero-a", "evil-a"]);
    expect(pickCovers(["hero-a", "evil-a"], [card("hero-a", "Hero", "main", 0), heroB, evilA])).toEqual([
      "hero-b",
      "evil-a",
    ]);
  });

  it("follows a cover card to its new printing when the player swapped printings", () => {
    const davidOld = "david-loc";
    const davidNew = { ...card("david-plus", "Hero"), name: "David" };
    const names: Record<string, string> = { "david-loc": "David" };
    expect(pickCovers([davidOld, "evil-a"], [heroA, davidNew, evilA], (f) => names[f])).toEqual([
      "david-plus",
      "evil-a",
    ]);
    // Without a name for the old printing it can only treat the card as cut.
    expect(pickCovers([davidOld, "evil-a"], [heroA, davidNew, evilA])).toEqual(["hero-a", "evil-a"]);
  });

  it("never fills a slot with the card the other cover is showing", () => {
    // Cover 2 was set to the deck's only Hero; cover 1's replacement can't be that Hero again.
    expect(pickCovers(["gone", "hero-a"], [fort, heroA])).toEqual(["fort", "hero-a"]);
    // Cover 1 was set to the deck's only Evil Character.
    expect(pickCovers(["evil-a", "gone"], [evilA, fort])).toEqual(["evil-a", "fort"]);
  });

  it("fills empty slots the way it fills cut ones", () => {
    expect(pickCovers([null, undefined], [fort, evilA, heroA])).toEqual(["hero-a", "evil-a"]);
    expect(pickCovers([null, null], [fort, card("site", "Site")])).toEqual(["fort", "site"]);
  });

  it("leaves a slot empty when the main deck has nothing else to show", () => {
    expect(pickCovers(["gone", "fort"], [fort])).toEqual([null, "fort"]);
    expect(pickCovers(["gone", "gone-too"], [])).toEqual([null, null]);
  });
});
