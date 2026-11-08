import { describe, expect, it } from "vitest";
import type { Card } from "../../utils";
import { parseDeckText } from "../deckImportExport";
import { continueHint, droppedHeading, importedCardCount, importNotice, nextImportStep } from "../importOutcome";

const card = (name: string, set: string): Card =>
  ({ dataLine: `${name}|${set}|img`, name, set, imgFile: "img", officialSet: set, type: "Hero" } as Card);

const pool = [card("Invented Hero", "AA"), card("Invented Twin", "AA"), card("Invented Twin", "BB")];

describe("parseDeckText: which lines count as dropped", () => {
  it("names every line it could not import", () => {
    const { errors, deck } = parseDeckText(
      ["1\tInvented Hero", "1\tNo Such Card", "no tab on this line", "x\tInvented Hero"].join("\n"),
      pool,
    );
    expect(deck!.cards).toHaveLength(1);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('"No Such Card"');
    expect(errors[1]).toContain('"no tab on this line"');
    expect(errors[2]).toContain('"Invented Hero"');
  });

  it("keeps a line with several printings, as a warning and not an error", () => {
    const { errors, warnings, deck } = parseDeckText("2\tInvented Twin", pool);
    expect(errors).toEqual([]);
    expect(deck!.cards[0].card.set).toBe("AA");
    expect(warnings[0]).toContain('"Invented Twin"');
  });
});

describe("nextImportStep", () => {
  const deck = parseDeckText("1\tInvented Hero", pool).deck;

  it("imports a clean list straight away", () => {
    expect(nextImportStep({ deck, errors: [] }, false)).toBe("import");
  });

  it("stops a partly failed list until the user chooses to go on", () => {
    expect(nextImportStep({ deck, errors: ["Line 2: x"] }, false)).toBe("confirm");
    expect(nextImportStep({ deck, errors: ["Line 2: x"] }, true)).toBe("import");
  });

  it("never imports a list with nothing in it, even if asked to go on", () => {
    expect(nextImportStep({ deck: null, errors: ["Line 1: x"] }, false)).toBe("stop");
    expect(nextImportStep({ deck: null, errors: ["Line 1: x"] }, true)).toBe("stop");
    expect(nextImportStep({ deck: null, errors: [] }, false)).toBe("stop");
  });
});

describe("importedCardCount", () => {
  it("counts copies, not lines", () => {
    expect(importedCardCount(parseDeckText("3\tInvented Hero\n2\tInvented Twin", pool).deck)).toBe(5);
    expect(importedCardCount(null)).toBe(0);
  });
});

describe("importNotice", () => {
  it("keeps today's messages for a clean import", () => {
    expect(importNotice({ dropped: 0, signedIn: true, saved: true })).toEqual({ message: "Deck imported and saved!", type: "success" });
    expect(importNotice({ dropped: 0, signedIn: true, saved: false })).toEqual({ message: "Imported, but failed to save", type: "error" });
    expect(importNotice({ dropped: 0, signedIn: false, saved: false })).toBeNull();
  });

  it("never reports plain success after dropping lines", () => {
    const saved = importNotice({ dropped: 3, signedIn: true, saved: true })!;
    expect(saved.message).toBe("Deck imported and saved without 3 lines");
    expect(saved.type).not.toBe("success");
    expect(importNotice({ dropped: 1, signedIn: true, saved: true })!.message).toBe("Deck imported and saved without 1 line");
    expect(importNotice({ dropped: 2, signedIn: true, saved: false })).toEqual({
      message: "Imported without 2 lines, but failed to save",
      type: "error",
    });
  });

  it("never claims a save for a signed-out user", () => {
    const notice = importNotice({ dropped: 2, signedIn: false, saved: false })!;
    expect(notice.message).toBe("Deck imported without 2 lines");
    expect(notice.message).not.toMatch(/saved/i);
  });
});

describe("modal copy", () => {
  it("counts the dropped lines in the heading", () => {
    expect(droppedHeading(1)).toBe("1 line not imported:");
    expect(droppedHeading(4)).toBe("4 lines not imported:");
  });

  it("says the deck saves only when it will", () => {
    expect(continueHint(47, true)).toBe(
      "Correct the list and import again, or import the other 47 cards without these lines. The deck saves straight away.",
    );
    expect(continueHint(47, false)).toBe("Correct the list and import again, or import the other 47 cards without these lines.");
    expect(continueHint(1, false)).toContain("the other card without");
  });
});
