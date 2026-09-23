import { describe, it, expect } from "vitest";
import { sortSetCards, END_OF_TIMES_SET_ID } from "../cardOrder";
import type { ForgeCardFull } from "../cards";
import type { DesignCard } from "../designCard";

let seq = 0;
const forgeCard = (title: string, snapshot: DesignCard, setId: string = END_OF_TIMES_SET_ID): ForgeCardFull => ({
  id: `card-${++seq}`,
  title,
  snapshot,
  hasArt: false,
  hasFinished: false,
  isPlaceholder: false,
  status: "approved",
  updatedAt: "",
  setId,
  publishedVersionId: null,
  approvedVersionId: null,
  ownerId: "owner",
  creatorId: "owner",
  createdAt: "",
});

const titles = (cards: ForgeCardFull[]): string[] => sortSetCards(cards).map((c) => c.title ?? "");

describe("sortSetCards — End of Times print order", () => {
  it("puts The Days of Noah (Purple/Blue) at the head of the Good section, not in the Purple slot", () => {
    const cards = [
      forgeCard("Beware of Abominations", { cardType: ["GE"], brigades: ["Purple"], alignment: "Good", strength: "5" }),
      forgeCard("Peter, Son of Jonah", { cardType: ["Hero"], brigades: ["Purple"], alignment: "Good", strength: "4" }),
      forgeCard("Paul, Church Planter", { cardType: ["Hero"], brigades: ["Clay"], alignment: "Good", strength: "11" }),
      forgeCard("The Days of Noah", { cardType: ["GE"], brigades: ["Purple", "Blue"], alignment: "Good", strength: "4" }),
    ];
    expect(titles(cards)).toEqual([
      "The Days of Noah", "Paul, Church Planter", "Peter, Son of Jonah", "Beware of Abominations",
    ]);
  });

  it("puts Tree of Life (Blue/Silver) first among covenants instead of last", () => {
    const cards = [
      forgeCard("No More Pain", { cardType: ["Covenant"], brigades: ["White"], alignment: "Good", strength: "4" }),
      forgeCard("Saved by Faith", { cardType: ["Covenant"], brigades: ["Clay"], alignment: "Good", strength: "5" }),
      forgeCard("Tree of Life", { cardType: ["Covenant"], brigades: ["Blue", "Silver"], alignment: "Good", strength: "4" }),
      forgeCard("Covenant of Prayer [EoT]", { cardType: ["Covenant"], brigades: ["Silver", "White"], alignment: "Good", strength: "3" }),
    ];
    expect(titles(cards)).toEqual(["Tree of Life", "Covenant of Prayer [EoT]", "Saved by Faith", "No More Pain"]);
  });

  it("passes toughness through so same-strength cards keep the printed tie order", () => {
    // Non-EoT set: the general comparator breaks ties toughness descending.
    const cards = [
      forgeCard("The Lawless One", { cardType: ["EvilCharacter"], brigades: ["PaleGreen"], alignment: "Evil", strength: "4", toughness: "2" }, "some-other-set"),
      forgeCard("Meddling Mage", { cardType: ["EvilCharacter"], brigades: ["PaleGreen"], alignment: "Evil", strength: "4", toughness: "4" }, "some-other-set"),
    ];
    // Alphabetical would put "Lawless One" first; toughness 4 beats 2.
    expect(titles(cards)).toEqual(["Meddling Mage", "The Lawless One"]);
  });

  it("breaks same-strength Good Enhancement ties by toughness ascending, opposite of every other set", () => {
    const cards = [
      forgeCard("Stand Firm [EoT]", { cardType: ["GE"], brigades: ["Clay"], alignment: "Good", strength: "2", toughness: "5" }),
      forgeCard("Risen by Christ", { cardType: ["GE"], brigades: ["Clay"], alignment: "Good", strength: "2", toughness: "3" }),
    ];
    // Real EoT print order (49-50): Risen by Christ (2/3) before Stand Firm (2/5).
    expect(titles(cards)).toEqual(["Risen by Christ", "Stand Firm [EoT]"]);
  });

  it("does NOT extend the ascending rule to Evil Enhancements, Heroes, or Evil Characters", () => {
    // Real EoT (111-112): Great Feast (0/6) prints before Filled with Flesh
    // (0/0) — Evil Enhancements still descend.
    const eeCards = [
      forgeCard("Filled with Flesh", { cardType: ["EE"], brigades: ["Crimson"], alignment: "Evil", strength: "0", toughness: "0" }),
      forgeCard("Great Feast", { cardType: ["EE"], brigades: ["Crimson"], alignment: "Evil", strength: "0", toughness: "6" }),
    ];
    expect(titles(eeCards)).toEqual(["Great Feast", "Filled with Flesh"]);

    // Real EoT: Seven Trumpet Sounders (7/7) prints before The Third
    // Creature (7/5) — Heroes still descend.
    const heroCards = [
      forgeCard("The Third Creature", { cardType: ["Hero"], brigades: ["Silver"], alignment: "Good", strength: "7", toughness: "5" }),
      forgeCard("Seven Trumpet Sounders", { cardType: ["Hero"], brigades: ["Silver"], alignment: "Good", strength: "7", toughness: "7" }),
    ];
    expect(titles(heroCards)).toEqual(["Seven Trumpet Sounders", "The Third Creature"]);

    // Real EoT pair (PaleGreen): Evil Characters still descend too.
    const evilCharCards = [
      forgeCard("The Lawless One", { cardType: ["EvilCharacter"], brigades: ["PaleGreen"], alignment: "Evil", strength: "4", toughness: "2" }),
      forgeCard("Meddling Mage", { cardType: ["EvilCharacter"], brigades: ["PaleGreen"], alignment: "Evil", strength: "4", toughness: "4" }),
    ];
    expect(titles(evilCharCards)).toEqual(["Meddling Mage", "The Lawless One"]);
  });

  it("re-reads the snapshot on every sort, so a brigade change moves the card without a manual step", () => {
    const noah = forgeCard("The Days of Noah", { cardType: ["GE"], brigades: ["Purple"], alignment: "Good", strength: "4" });
    const cards = [
      forgeCard("Paul, Church Planter", { cardType: ["Hero"], brigades: ["Clay"], alignment: "Good", strength: "11" }),
      noah,
    ];
    expect(titles(cards)).toEqual(["Paul, Church Planter", "The Days of Noah"]);
    noah.snapshot = { ...noah.snapshot, brigades: ["Purple", "Blue"] };
    expect(titles(cards)).toEqual(["The Days of Noah", "Paul, Church Planter"]);
  });

  it("counts a leading 'The' as a real word among Artifacts, unlike every other validated set", () => {
    // Real EoT numbering (6-10): Letters, Seven Lamps, Stumbling Block, then
    // the two "The"-titled cards — "The" is not stripped here.
    const cards = [
      forgeCard("The Book of Life", { cardType: ["Artifact"], alignment: "Neutral" }),
      forgeCard("The Golden Altar", { cardType: ["Artifact"], alignment: "Neutral" }),
      forgeCard("Letters to Thessalonica", { cardType: ["Artifact"], alignment: "Neutral" }),
      forgeCard("Seven Lamps of Fire", { cardType: ["Artifact"], alignment: "Neutral" }),
      forgeCard("Stumbling Block", { cardType: ["Artifact"], alignment: "Evil" }),
    ];
    expect(titles(cards)).toEqual([
      "Letters to Thessalonica", "Seven Lamps of Fire", "Stumbling Block", "The Book of Life", "The Golden Altar",
    ]);
  });

  it("hand-orders the five Dominants — Alpha and Omega leads; Beast's Mark prints last despite alphabetizing before Deceiving the Nations", () => {
    const cards = [
      forgeCard("Beast's Mark", { cardType: ["Dominant", "Artifact", "Curse"], alignment: "Evil" }),
      forgeCard("Deceiving the Nations", { cardType: ["Dominant"], alignment: "Evil" }),
      forgeCard("Armageddon", { cardType: ["Dominant"], alignment: "Good_Evil" }),
      forgeCard("Word of the Lord", { cardType: ["Dominant"], alignment: "Good" }),
      forgeCard("Alpha and Omega", { cardType: ["Dominant"], alignment: "Good" }),
    ];
    expect(titles(cards)).toEqual([
      "Alpha and Omega", "Word of the Lord", "Armageddon", "Deceiving the Nations", "Beast's Mark",
    ]);
  });

  it("leaves other sets alone: 'The' still strips and the Dominant list doesn't apply", () => {
    const cards = [
      forgeCard("The Book of Knowledge", { cardType: ["Artifact"], alignment: "Neutral" }, "some-other-set"),
      forgeCard("Darius' Decree", { cardType: ["Artifact"], alignment: "Neutral" }, "some-other-set"),
      forgeCard("Abomination of Desolation", { cardType: ["Artifact"], alignment: "Neutral" }, "some-other-set"),
    ];
    expect(titles(cards)).toEqual(["Abomination of Desolation", "The Book of Knowledge", "Darius' Decree"]);
  });
});
