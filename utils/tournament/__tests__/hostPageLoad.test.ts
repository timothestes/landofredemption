import { describe, expect, it } from "vitest";
import { initialHostTab, tournamentReadOutcome } from "../hostPageLoad";

describe("initialHostTab", () => {
  it("opens Participants before the event starts", () => {
    expect(initialHostTab({ has_started: false, has_ended: false })).toBe(0);
    expect(initialHostTab({ has_started: null, has_ended: null })).toBe(0);
  });

  it("opens Rounds while the event is running", () => {
    expect(initialHostTab({ has_started: true, has_ended: false })).toBe(1);
  });

  it("opens Standings once the event has ended", () => {
    expect(initialHostTab({ has_started: true, has_ended: true })).toBe(2);
  });

  it("stays on Participants for an ended event that never started, which has no Standings tab", () => {
    expect(initialHostTab({ has_started: false, has_ended: true })).toBe(0);
  });
});

describe("tournamentReadOutcome", () => {
  it("is loaded when the row came back", () => {
    expect(tournamentReadOutcome({ id: "t1" }, null)).toBe("loaded");
  });

  it("is not found only when the database answered with zero rows", () => {
    expect(
      tournamentReadOutcome(null, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" })
    ).toBe("not_found");
    expect(tournamentReadOutcome(null, null)).toBe("not_found");
  });

  it("is failed for a dropped connection, not not found", () => {
    expect(tournamentReadOutcome(null, { code: "", message: "TypeError: Failed to fetch" })).toBe("failed");
  });

  it("is failed for a server error", () => {
    expect(tournamentReadOutcome(null, { code: "57014", message: "canceling statement due to statement timeout" })).toBe(
      "failed"
    );
  });
});
