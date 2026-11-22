import { describe, expect, it } from "vitest";
import { CARDS, type CardData } from "@/lib/cards/lookup";
import { defaultCovers } from "../defaultCovers";

const ofType = (type: string) => CARDS.find((c) => c.type === type) as CardData;
const row = (c: CardData, zone = "main", quantity = 1) => ({
  card_name: c.name,
  card_set: c.set,
  card_img_file: c.imgFile,
  quantity,
  zone,
});

const hero = ofType("Hero");
const ec = ofType("Evil Character");
const other = CARDS.find((c) => c.type !== "Hero" && c.type !== "Evil Character" && c.imgFile) as CardData;
const other2 = CARDS.find((c) => c !== other && c.type !== "Hero" && c.type !== "Evil Character" && c.imgFile) as CardData;

describe("defaultCovers", () => {
  it("picks the first Hero and the first Evil Character, wherever they sit in the list", () => {
    expect(defaultCovers([row(other), row(ec), row(hero)])).toEqual([hero.imgFile, ec.imgFile]);
  });

  it("falls back to the first two main-deck cards", () => {
    expect(defaultCovers([row(other), row(other2)])).toEqual([other.imgFile, other2.imgFile]);
  });

  it("never takes a reserve, maybeboard or zero-count card", () => {
    expect(defaultCovers([row(hero, "reserve"), row(ec, "maybeboard"), row(hero, "main", 0), row(other)])).toEqual([
      other.imgFile,
      null,
    ]);
  });

  it("gives no covers for an empty deck", () => {
    expect(defaultCovers([])).toEqual([null, null]);
  });
});
