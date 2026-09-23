import { describe, it, expect } from "vitest";
import { wrapLines, abilityParagraphs, textFit, textWidth, TEXT_METRICS, TEXT_WIDTH } from "@/app/forge/lib/textFit";

// Line breaks read off printed cards (Roots, Roots 2, Times to Come) — the preview must wrap
// exactly where the card does, or "doesn't fit" means nothing.
const A = TEXT_METRICS.ability, V = TEXT_METRICS.verse;
const ability = (t: string) => wrapLines(t, "bold", A.size, TEXT_WIDTH);
const verse = (t: string) => wrapLines(t, "italic", V.size, TEXT_WIDTH);

describe("wrapLines against printed abilities", () => {
  it("The Goat with a Horn (T2C)", () => {
    expect(ability("May band to a Greek warrior. O.T. Enhancements used by this card cannot be negated.")).toEqual([
      "May band to a Greek warrior. O.T.", "Enhancements used by this card", "cannot be negated.",
    ]);
  });
  it("Abram, the Blameless (Roots)", () => {
    expect(ability("Negate Lost Souls. Protect this card from evil O.T. humans. Cannot be prevented.")).toEqual([
      "Negate Lost Souls. Protect this card", "from evil O.T. humans. Cannot be", "prevented.",
    ]);
  });
  it("A New Beginning (Roots 2)", () => {
    expect(ability("If attacking, banish this card: Shuffle all cards and all hands. End the battle. Each player must draw 8. Begin a new turn. Regardless of protect abilities.")).toEqual([
      "If attacking, banish this card: Shuffle", "all cards and all hands. End the battle.", "Each player must draw 8. Begin a new", "turn. Regardless of protect abilities.",
    ]);
  });
  it("Babylonian Banquet Hall (Roots 2)", () => {
    expect(ability("If your lone crimson human blocks, discard an Artifact in each territory. If human is Babylonian, you may draw 2.")).toEqual([
      "If your lone crimson human blocks,", "discard an Artifact in each territory. If", "human is Babylonian, you may draw 2.",
    ]);
  });
  it("Patrollers of the Earth (T2C)", () => {
    expect(ability("You may draw X (limit 3) or exchange up to X cards from hand with an equal number of good O.T. cards from Reserve. Cannot be negated.")).toEqual([
      "You may draw X (limit 3) or exchange", "up to X cards from hand with an equal", "number of good O.T. cards from", "Reserve. Cannot be negated.",
    ]);
  });
  it("Laban, the Deal Breaker (Roots) — breaks after the hyphen only when it must", () => {
    expect(ability("You may bounce a multi-brigade card in a territory. You may look at the top 6 cards of deck: Take up to 1 evil card.")).toEqual([
      "You may bounce a multi-brigade card", "in a territory. You may look at the top", "6 cards of deck: Take up to 1 evil card.",
    ]);
  });
});

describe("wrapLines against printed verses", () => {
  it("Daniel 8:5 (The Goat with a Horn)", () => {
    expect(verse("While I was observing, behold, a male goat was coming from the west over the surface of the entire earth without touching the ground; and the goat had a prominent horn between his eyes.")).toEqual([
      "While I was observing, behold, a male goat was coming", "from the west over the surface of the entire earth", "without touching the ground; and the goat had a", "prominent horn between his eyes.",
    ]);
  });
  it("Genesis 17:1 (Abram)", () => {
    expect(verse("Now when Abram was ninety-nine years old, the Lord appeared to Abram and said to him, “I am God Almighty; walk before Me, and be blameless.”")).toEqual([
      "Now when Abram was ninety-nine years old, the Lord", "appeared to Abram and said to him, “I am God", "Almighty; walk before Me, and be blameless.”",
    ]);
  });
  it("Daniel 5:3 (Babylonian Banquet Hall)", () => {
    expect(verse("Then they brought the gold vessels that had been taken out of the temple, the house of God which was in Jerusalem; and the king and his nobles, his wives, and his concubines drank out of them.")).toEqual([
      "Then they brought the gold vessels that had been taken", "out of the temple, the house of God which was in", "Jerusalem; and the king and his nobles, his wives, and", "his concubines drank out of them.",
    ]);
  });
  it("I Samuel 4:22 (Captured Ark)", () => {
    expect(verse("So she said, “The glory has departed from Israel, because the ark of God has been taken.”")).toEqual([
      "So she said, “The glory has departed from Israel,", "because the ark of God has been taken.”",
    ]);
  });
  it("II Peter 3:9 (I Am Patience)", () => {
    expect(verse("The Lord is not slow about His promise, as some count slowness, but is patient toward you, not willing for any to perish, but for all to come to repentance.")).toEqual([
      "The Lord is not slow about His promise, as some count", "slowness, but is patient toward you, not willing for any", "to perish, but for all to come to repentance.",
    ]);
  });
  it("Genesis 30:27 (Laban)", () => {
    expect(verse("But Laban said to him, “If it pleases you at all, stay with me; I have determined by divination that the Lord has blessed me on your account.”")).toEqual([
      "But Laban said to him, “If it pleases you at all, stay with", "me; I have determined by divination that the Lord has", "blessed me on your account.”",
    ]);
  });
  it("wraps nothing for an empty verse and honours explicit newlines", () => {
    expect(verse("")).toEqual([]);
    expect(verse("  ")).toEqual([]);
    expect(ability("One.\nTwo.")).toEqual(["One.", "Two."]);
  });
});

describe("abilityParagraphs", () => {
  it("splits dual-type abilities at the type prefix, and at newlines", () => {
    expect(abilityParagraphs("GE: Negate and shuffle an opponent's card. / A: You may convert an evil human. If you do, skip your next battle phase.")).toEqual([
      "GE: Negate and shuffle an opponent's card.", "A: You may convert an evil human. If you do, skip your next battle phase.",
    ]);
    expect(abilityParagraphs("Draw 2.\n\nLimit once per turn.")).toEqual(["Draw 2.", "Limit once per turn."]);
    expect(abilityParagraphs("Choose 1/2 of them.")).toEqual(["Choose 1/2 of them."]);
    expect(abilityParagraphs("")).toEqual([]);
  });
});

describe("textFit", () => {
  const goat = {
    rawText: "May band to a Greek warrior. O.T. Enhancements used by this card cannot be negated.",
    scripture: "While I was observing, behold, a male goat was coming from the west over the surface of the entire earth without touching the ground; and the goat had a prominent horn between his eyes.",
  };
  it("reports the printed layout for a card that fits", () => {
    const f = textFit(goat);
    expect(f.abilityLines).toBe(3);
    expect(f.verseLines).toHaveLength(4);
    expect(f.over).toBe(0);
    // fully dark `above` px before the first verse line's box (negative: just inside it, at
    // its cap top, as the finished cards measure), the transition in the span above that
    expect(f.gradient.dark).toBeCloseTo(f.verseTop - TEXT_METRICS.gradient.above, 5);
    expect(f.gradient.light).toBeCloseTo(f.gradient.dark - TEXT_METRICS.gradient.span, 5);
    expect(f.gradient.dark).toBeLessThan(f.verseTop + 10);
    expect(f.abilityBottom).toBeCloseTo(A.top + 3 * A.pitch, 5);
    expect(f.verseTop).toBeCloseTo(V.bottom - 4 * V.pitch, 5);
  });
  it("counts the ability lines that collide with the verse", () => {
    const long = `${goat.rawText} Protect this card from capture. Cannot be negated by a Greek.`;
    const f = textFit({ ...goat, rawText: long });
    expect(f.abilityLines).toBe(5);
    // five lines end 177.6 px down the box; the four-line verse now starts at 159.5 (the
    // finished cards' verse block sits 6 px higher than Roots printed it), so two collide
    expect(f.over).toBe(2);
    expect(textFit({ ...goat, rawText: long, scripture: "So she said, “The glory has departed from Israel, because the ark of God has been taken.”" }).over).toBe(0);
  });
  it("the tightest printed card (I Am Patience: 4 ability lines in 2 paragraphs, 3 verse lines) still fits", () => {
    const f = textFit({
      rawText: "GE: Negate and shuffle an opponent's card. / A: You may convert an evil human. If you do, skip your next battle phase.",
      scripture: "The Lord is not slow about His promise, as some count slowness, but is patient toward you, not willing for any to perish, but for all to come to repentance.",
    });
    expect(f.abilityLines).toBe(4);
    expect(f.verseLines).toHaveLength(3);
    expect(f.over).toBe(0);
    expect(f.abilityBottom + TEXT_METRICS.minGap).toBeLessThanOrEqual(f.verseTop);
  });
  it("dual-type halves are separate paragraphs and the gap counts", () => {
    const f = textFit({ rawText: "GE: Negate and shuffle an opponent's card. / A: You may convert an evil human. If you do, skip your next battle phase." });
    expect(f.paragraphs).toHaveLength(2);
    expect(f.abilityBottom).toBeCloseTo(A.top + f.abilityLines * A.pitch + A.paragraphGap, 5);
  });
  it("without a verse the reference line is the floor and the gradient sits just above it", () => {
    const f = textFit({ rawText: "Draw 1." });
    expect(f.verseLines).toEqual([]);
    expect(f.verseTop).toBe(V.bottom);
    expect(f.gradient.dark).toBeCloseTo(V.bottom - TEXT_METRICS.gradient.above, 5);
    expect(f.over).toBe(0);
    expect(textFit({}).abilityLines).toBe(0);
  });
  it("widths come from the font tables", () => {
    expect(textWidth("", "bold", 31)).toBe(0);
    expect(textWidth("iii", "bold", 10)).toBeLessThan(textWidth("WWW", "bold", 10));
  });
});
