import { describe, it, expect } from "vitest";
import { dropConfirmationText, DROP_BEFORE_PAIRING_TEXT } from "../dropConfirmation";

const match = (
  p1: string,
  p2: string,
  s1: number | null = null,
  s2: number | null = null,
) => ({ player1_id: p1, player2_id: p2, player1_score: s1, player2_score: s2 });

describe("dropConfirmationText", () => {
  it("keeps the next-round wording when the current round is unknown", () => {
    expect(dropConfirmationText("a", null, [])).toBe(DROP_BEFORE_PAIRING_TEXT);
  });

  it("keeps the next-round wording when the player has no match this round (a bye)", () => {
    expect(dropConfirmationText("a", 2, [match("b", "c")])).toBe(DROP_BEFORE_PAIRING_TEXT);
  });

  it("keeps the next-round wording once the player's match has a result", () => {
    expect(dropConfirmationText("a", 2, [match("a", "b", 5, 3)])).toBe(DROP_BEFORE_PAIRING_TEXT);
  });

  // The case the old text got wrong: End Round pairs the next round at once,
  // so a player dropped between rounds is already in it.
  it("says the player is already paired, and how to re-pair, when no results are in", () => {
    const text = dropConfirmationText("b", 2, [match("a", "b"), match("c", "d")]);
    expect(text).toContain("Already paired for round 2.");
    expect(text).toContain("forfeit when the round ends");
    expect(text).toContain("Regenerate pairings");
    expect(text).not.toContain("will not appear");
  });

  it("leaves out the re-pair advice once another table has a result", () => {
    const text = dropConfirmationText("a", 3, [match("a", "b"), match("c", "d", 2, 5)]);
    expect(text).toContain("Already paired for round 3.");
    expect(text).toContain("forfeit when the round ends");
    expect(text).not.toContain("Regenerate pairings");
  });

  it("treats a half-entered result as no result", () => {
    expect(dropConfirmationText("a", 1, [match("a", "b", 3, null)])).toContain("Already paired for round 1.");
  });
});
