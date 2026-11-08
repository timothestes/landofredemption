// app/forge/lib/__tests__/lifecycleCopy.test.ts
import { describe, it, expect } from "vitest";
import {
  STATUS_LABEL, ACTION_LABEL, releaseLabel, isEligible, BULK_DONE_VERB, releaseProposalNotice,
  returnToIdeasCopy,
} from "../lifecycleCopy";

describe("lifecycleCopy", () => {
  it("maps every status to its display label", () => {
    expect(STATUS_LABEL).toEqual({
      private_idea: "Idea",
      draft: "Draft",
      playtesting: "In playtest",
      approved: "Final",
      promoted: "Public",
      archived: "Shelved",
    });
  });

  it("labels the publish action by where the card is", () => {
    expect(releaseLabel("draft")).toBe("Release to playtesters");
    expect(releaseLabel("playtesting")).toBe("Release update");
  });

  it("release admits draft and playtesting only", () => {
    expect(isEligible("release", "draft")).toBe(true);
    expect(isEligible("release", "playtesting")).toBe(true);
    expect(isEligible("release", "approved")).toBe(false);
    expect(isEligible("release", "archived")).toBe(false);
    expect(isEligible("release", "private_idea")).toBe(false);
  });

  it("markFinal admits playtesting only; reopen admits approved only", () => {
    expect(isEligible("markFinal", "playtesting")).toBe(true);
    expect(isEligible("markFinal", "approved")).toBe(false);
    expect(isEligible("reopen", "approved")).toBe(true);
    expect(isEligible("reopen", "playtesting")).toBe(false);
  });

  it("shelve/restore mirror archive/unarchive guards", () => {
    expect(isEligible("shelve", "draft")).toBe(true);
    expect(isEligible("shelve", "archived")).toBe(false);
    expect(isEligible("restore", "archived")).toBe(true);
    expect(isEligible("restore", "draft")).toBe(false);
  });

  it("delete admits every status", () => {
    for (const s of ["private_idea", "draft", "playtesting", "approved", "archived"]) {
      expect(isEligible("delete", s)).toBe(true);
    }
  });

  it("has a past-tense verb for every action", () => {
    for (const a of Object.keys(ACTION_LABEL)) {
      expect(BULK_DONE_VERB[a as keyof typeof BULK_DONE_VERB]).toBeTruthy();
    }
  });
});

describe("releaseProposalNotice", () => {
  it("says nothing when the card has no open proposals", () => {
    expect(releaseProposalNotice(0, false)).toEqual([]);
  });

  it("reports the sole matching proposal as recorded-accepted, with nothing closed", () => {
    const n = releaseProposalNotice(1, true);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatch(/recorded as accepted/);
  });

  it("reports a sole non-matching proposal as closed out of date", () => {
    const n = releaseProposalNotice(1, false);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatch(/closed as out of date/);
  });

  it("counts only ONE accept per release — the rest are closed", () => {
    const n = releaseProposalNotice(3, true);
    expect(n).toHaveLength(2);
    expect(n[0]).toMatch(/recorded as accepted/);
    expect(n[1]).toMatch(/^2 open proposals will be closed as out of date/);
  });

  it("pluralizes the closed count with no match", () => {
    expect(releaseProposalNotice(2, false)[0]).toMatch(/^2 open proposals will be closed/);
  });
});

describe("returnToIdeasCopy", () => {
  // forge_send_card_to_private sets owner_id = auth.uid() on purpose (#443), so the
  // person clicking becomes the owner, whoever made the card.
  it("says the clicker becomes the owner, not that it goes back to its owner", () => {
    const c = returnToIdeasCopy(1);
    expect(c.description).toMatch(/your own ideas/);
    expect(c.description).toMatch(/makes you its owner/);
    expect(c.description).not.toMatch(/its owner's/);
    expect(c.description).not.toMatch(/each card/);
    expect(c.title).toBe("Return to ideas?");
  });

  it("still says playtesters lose the card", () => {
    expect(returnToIdeasCopy(1).description).toMatch(/playtesters can no longer see it/);
    expect(returnToIdeasCopy(3).description).toMatch(/playtesters can no longer see them/);
  });

  it("counts cards in bulk", () => {
    const c = returnToIdeasCopy(3);
    expect(c.title).toBe("Return 3 cards to ideas?");
    expect(c.description).toMatch(/makes you their owner/);
  });
});
