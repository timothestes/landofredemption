import { describe, it, expect } from "vitest";
import { justAddedKeys } from "../justAdded";

describe("justAddedKeys", () => {
  it("drops removed and unresolved", () => {
    expect(
      justAddedKeys([
        { finalKey: "a|S|a.jpg" },
        { finalKey: "b|S|b.jpg", removed: true },
        { finalKey: "c|S|c.jpg", unresolved: true },
        { finalKey: "d|S|d.jpg", removed: false, unresolved: false },
      ]),
    ).toEqual(["a|S|a.jpg", "d|S|d.jpg"]);
  });

  it("dedupes keys keeping order", () => {
    expect(
      justAddedKeys([{ finalKey: "x" }, { finalKey: "y" }, { finalKey: "x" }]),
    ).toEqual(["x", "y"]);
  });

  it("ignores malformed entries", () => {
    expect(
      justAddedKeys([null, undefined, 3, "s", {}, { finalKey: 5 }, { finalKey: "" }, { finalKey: "ok" }]),
    ).toEqual(["ok"]);
  });
});
