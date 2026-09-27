import { describe, it, expect } from "vitest";
import { toMatchResult } from "../stateAdapter";

const P1 = "p1";
const P2 = "p2";
const base = { player1_id: P1, player2_id: P2 };

describe("toMatchResult — forfeits (migration 110)", () => {
  it("player1 forfeit → forfeit / forfeit_opponent, even though souls are 0–0", () => {
    expect(
      toMatchResult(
        { ...base, player1_score: 0, player2_score: 0, is_tie: false, winner_id: P2, player1_forfeit: true, player2_forfeit: false },
        5,
      ),
    ).toEqual({ p1Souls: 0, p2Souls: 0, p1Outcome: "forfeit", p2Outcome: "forfeit_opponent" });
  });

  it("player2 forfeit → forfeit_opponent / forfeit", () => {
    expect(
      toMatchResult(
        { ...base, player1_score: 0, player2_score: 0, is_tie: false, winner_id: P1, player1_forfeit: false, player2_forfeit: true },
        5,
      ),
    ).toEqual({ p1Souls: 0, p2Souls: 0, p1Outcome: "forfeit_opponent", p2Outcome: "forfeit" });
  });

  it("double forfeit → forfeit / forfeit", () => {
    expect(
      toMatchResult(
        { ...base, player1_score: 0, player2_score: 0, is_tie: false, winner_id: null, player1_forfeit: true, player2_forfeit: true },
        5,
      ),
    ).toEqual({ p1Souls: 0, p2Souls: 0, p1Outcome: "forfeit", p2Outcome: "forfeit" });
  });

  it("the flags win over a stale is_tie", () => {
    // Defensive: a row whose is_tie was derived from 0–0 before the flag landed.
    const r = toMatchResult(
      { ...base, player1_score: 0, player2_score: 0, is_tie: true, winner_id: null, player1_forfeit: true, player2_forfeit: false },
      5,
    );
    expect(r?.p1Outcome).toBe("forfeit");
  });

  it("no flags: 0–0 is still a tie, and played results derive as before", () => {
    expect(
      toMatchResult({ ...base, player1_score: 0, player2_score: 0, is_tie: true, winner_id: null, player1_forfeit: false, player2_forfeit: false }, 5),
    ).toEqual({ p1Souls: 0, p2Souls: 0, p1Outcome: "tie", p2Outcome: "tie" });
    expect(
      toMatchResult({ ...base, player1_score: 5, player2_score: 2, is_tie: false, winner_id: P1 }, 5),
    ).toEqual({ p1Souls: 5, p2Souls: 2, p1Outcome: "full_win", p2Outcome: "full_loss" });
    expect(toMatchResult({ ...base, player1_score: null, player2_score: null }, 5)).toBeUndefined();
  });
});
