import { describe, it, expect } from "vitest";
import { placeholderShowing, removeFinishedCopy } from "../artStatus";

describe("placeholderShowing", () => {
  it("is true for flagged art that is on the face", () => {
    expect(placeholderShowing({ hasArt: true, hasFinished: false }, true)).toBe(true);
  });

  it("is false when nothing is flagged", () => {
    expect(placeholderShowing({ hasArt: true, hasFinished: false }, false)).toBe(false);
  });

  it("is false with no art to flag", () => {
    expect(placeholderShowing({ hasArt: false, hasFinished: false }, true)).toBe(false);
  });

  it("is false when a finished image covers the art", () => {
    expect(placeholderShowing({ hasArt: true, hasFinished: true }, true)).toBe(false);
  });
});

describe("removeFinishedCopy", () => {
  it("says what the card goes back to, and that the image can't be got back here", () => {
    const { title, description, confirmLabel } = removeFinishedCopy("draft");
    expect(title).toBe("Remove the finished image?");
    expect(description).toMatch(/drawn from its fields/);
    expect(description).toMatch(/upload it again/);
    expect(description).toMatch(/download it first/i);
    expect(confirmLabel).toBe("Remove");
  });

  it("doesn't mention playtesters on a card they can't see", () => {
    for (const status of ["private_idea", "draft", "archived"]) {
      expect(removeFinishedCopy(status).description).not.toMatch(/playtester/i);
    }
  });

  it("says a released version isn't touched, on a card playtesters can see", () => {
    for (const status of ["playtesting", "approved"]) {
      expect(removeFinishedCopy(status).description).toMatch(/playtesters keep seeing the released version until your next release/i);
    }
  });
});
