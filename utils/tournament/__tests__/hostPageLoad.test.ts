import { describe, expect, it } from "vitest";
import { tournamentReadOutcome } from "../hostPageLoad";

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
