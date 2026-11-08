// app/forge/lib/__tests__/lifecycleCopy.test.ts
import { describe, it, expect } from "vitest";
import {
  STATUS_LABEL, ACTION_LABEL, releaseLabel, isEligible, BULK_DONE_VERB, releaseProposalNotice,
  returnToIdeasCopy, deleteCopy, bulkReleaseLabel, bulkConfirmCopy, bulkProposalNotice,
  releaseBlockers, releaseBlockedNote, bulkBlockedNotice, bulkSummary,
  releaseUnchangedNote, isReleaseUnchanged,
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

describe("deleteCopy", () => {
  it("names a single card", () => {
    const c = deleteCopy(["Invented Card"]);
    expect(c.title).toBe("Delete “Invented Card”?");
    expect(c.description).toMatch(/cannot be undone/);
    expect(c.confirmLabel).toBe("Delete card");
  });

  it("falls back for a card with no name", () => {
    expect(deleteCopy([null]).title).toBe("Delete this untitled card?");
    expect(deleteCopy(["   "]).title).toBe("Delete this untitled card?");
  });

  it("names up to three cards in bulk and counts the rest", () => {
    const c = deleteCopy(["A", null, "C", "D", "E"]);
    expect(c.title).toBe("Delete 5 cards?");
    expect(c.description).toContain("A, Untitled, C and 2 more");
    expect(c.confirmLabel).toBe("Delete 5 cards");
  });

  it("does not say 'and 0 more' when every card fits", () => {
    expect(deleteCopy(["A", "B"]).description).toContain("removes A, B, with");
  });
});

describe("bulkReleaseLabel", () => {
  it("never offers 'Release to playtesters' for cards already released", () => {
    expect(bulkReleaseLabel(["playtesting", "playtesting"])).toBe("Release update");
  });

  it("matches the single-card label for all-draft selections", () => {
    expect(bulkReleaseLabel(["draft"])).toBe(releaseLabel("draft"));
  });

  it("uses a neutral word for a mixed selection", () => {
    expect(bulkReleaseLabel(["draft", "playtesting"])).toBe("Release");
  });

  it("falls back to the action label with nothing eligible", () => {
    expect(bulkReleaseLabel([])).toBe(ACTION_LABEL.release);
  });
});

describe("bulkConfirmCopy", () => {
  const ctx = (n: number, extra = {}) => ({ names: Array.from({ length: n }, (_, i) => `Card ${i + 1}`), ...extra });

  it("has a confirmation for every action in the bulk bar", () => {
    for (const a of ["release", "markFinal", "shelve", "restore", "returnToIdeas", "delete", "releaseAll"] as const) {
      const c = bulkConfirmCopy(a, ctx(2));
      expect(c.title).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.confirmLabel).toBeTruthy();
    }
  });

  it("never says '1 cards'", () => {
    for (const a of ["release", "markFinal", "shelve", "restore", "releaseAll"] as const) {
      const c = bulkConfirmCopy(a, ctx(1));
      expect(`${c.title} ${c.description}`).not.toMatch(/\b1 cards\b/);
    }
  });

  it("release says what it freezes and who sees it", () => {
    const c = bulkConfirmCopy("release", ctx(3));
    expect(c.title).toBe("Release 3 cards?");
    expect(c.description).toMatch(/new version visible to playtesters/);
    expect(c.description).toMatch(/no changes since its last release is skipped/);
  });

  it("mark final says no new version is made and playtesters keep it", () => {
    const c = bulkConfirmCopy("markFinal", ctx(2));
    expect(c.title).toBe("Mark 2 cards final?");
    expect(c.description).toMatch(/No new version is made/);
    expect(c.description).toMatch(/Playtesters can still see/);
  });

  it("shelve says playtesters lose them and where Restore takes them", () => {
    const c = bulkConfirmCopy("shelve", ctx(2));
    expect(c.description).toMatch(/Playtesters can no longer see/);
    expect(c.description).toMatch(/In playtest/);
    expect(c.description).toMatch(/Draft/);
  });

  it("restore says released cards reach playtesters again", () => {
    const c = bulkConfirmCopy("restore", ctx(2));
    expect(c.description).toMatch(/In playtest/);
    expect(c.description).toMatch(/playtesters can see/);
  });

  it("delete and return reuse the single-card copy", () => {
    expect(bulkConfirmCopy("delete", ctx(1)).title).toBe("Delete \u201cCard 1\u201d?");
    expect(bulkConfirmCopy("returnToIdeas", ctx(2)).description).toMatch(/makes you their owner/);
  });

  it("release all counts the drafts", () => {
    expect(bulkConfirmCopy("releaseAll", ctx(3)).description).toMatch(/3 draft cards/);
    expect(bulkConfirmCopy("releaseAll", ctx(1)).description).toMatch(/1 draft card\b/);
  });
});

describe("bulkProposalNotice", () => {
  it("says nothing with no open proposals", () => {
    expect(bulkProposalNotice(0)).toEqual([]);
  });

  it("says a release closes them, and how, matching migration 083", () => {
    const [one] = bulkProposalNotice(1);
    expect(one).toMatch(/^1 open proposal on these cards will be closed/);
    expect(one).toMatch(/recorded as accepted/);
    expect(one).toMatch(/out of date/);
    expect(bulkProposalNotice(4)[0]).toMatch(/^4 open proposals on these cards will be closed/);
  });
});

describe("releaseBlockers", () => {
  it("passes a card with a name and a type, with no art or anything else", () => {
    expect(releaseBlockers({ name: "Invented", cardType: ["Hero"] })).toEqual([]);
  });

  it("flags what's missing", () => {
    expect(releaseBlockers({})).toEqual(["name", "type"]);
    expect(releaseBlockers({ cardType: ["Hero"] })).toEqual(["name"]);
    expect(releaseBlockers({ name: "Invented" })).toEqual(["type"]);
    expect(releaseBlockers({ name: "Invented", cardType: [] })).toEqual(["type"]);
  });

  it("treats a blank name as missing, as the database does", () => {
    expect(releaseBlockers({ name: "   ", cardType: ["Hero"] })).toEqual(["name"]);
  });
});

describe("releaseBlockedNote", () => {
  it("is silent when nothing blocks", () => {
    expect(releaseBlockedNote([])).toBeNull();
  });

  it("names what to add", () => {
    expect(releaseBlockedNote(["name", "type"])).toBe("Add a name and a type to release.");
    expect(releaseBlockedNote(["name"])).toBe("Add a name to release.");
    expect(releaseBlockedNote(["type"])).toBe("Add a type to release.");
  });
});

describe("bulkBlockedNotice", () => {
  it("says how many will be skipped and why", () => {
    expect(bulkBlockedNotice(0)).toEqual([]);
    expect(bulkBlockedNotice(1)).toEqual(["1 card has no name or type and will be skipped."]);
    expect(bulkBlockedNotice(3)).toEqual(["3 cards have no name or type and will be skipped."]);
  });
});

describe("bulkSummary", () => {
  it("keeps the plain form when no reasons are known", () => {
    expect(bulkSummary("shelve", { done: 2, skipped: 1, failed: 0 })).toBe("Shelved 2 \u00b7 1 skipped \u00b7 0 failed");
  });

  it("gives the reason for cards skipped for having no name or type", () => {
    expect(bulkSummary("release", { done: 2, skipped: 1, failed: 0, reasons: { noNameOrType: 1 } }))
      .toBe("Released 2 \u00b7 1 skipped (1 no name or type) \u00b7 0 failed");
  });

  it("gives the reason for cards skipped as unchanged", () => {
    expect(bulkSummary("release", { done: 0, skipped: 2, failed: 0, reasons: { unchanged: 2 } }))
      .toBe("Released 0 \u00b7 2 skipped (2 unchanged since last release) \u00b7 0 failed");
    expect(bulkSummary("release", { done: 1, skipped: 2, failed: 0, reasons: { unchanged: 1, noNameOrType: 1 } }))
      .toBe("Released 1 \u00b7 2 skipped (1 no name or type, 1 unchanged since last release) \u00b7 0 failed");
  });

  it("accounts for the rest when only some skips have a reason", () => {
    expect(bulkSummary("release", { done: 0, skipped: 3, failed: 0, reasons: { noNameOrType: 1 } }))
      .toBe("Released 0 \u00b7 3 skipped (1 no name or type, 2 not eligible) \u00b7 0 failed");
  });
});

describe("isReleaseUnchanged", () => {
  const DATA = { name: "Invented", cardType: ["Hero" as const], rawText: "Draw 2." };
  const base = (over = {}) => ({ versionNumber: 3, data: DATA, live: true, artChanged: false, ...over });

  it("is true when content and art match the live version", () => {
    expect(isReleaseUnchanged({ ...DATA, reference: "" }, base())).toBe(true);
  });

  it("is false for a first release", () => {
    expect(isReleaseUnchanged(DATA, null)).toBe(false);
  });

  it("is false when the content changed", () => {
    expect(isReleaseUnchanged({ ...DATA, rawText: "Draw 3." }, base())).toBe(false);
  });

  it("is false when only the art changed", () => {
    expect(isReleaseUnchanged(DATA, base({ artChanged: true }))).toBe(false);
  });

  it("is false when the last release is no longer live, so releasing still has an effect", () => {
    expect(isReleaseUnchanged(DATA, base({ live: false }))).toBe(false);
  });
});

describe("releaseUnchangedNote", () => {
  it("names the version", () => {
    expect(releaseUnchangedNote(3)).toBe("Nothing has changed since v3, so there is nothing to release.");
  });

  it("copes without a version number", () => {
    expect(releaseUnchangedNote(null)).toBe("Nothing has changed since the last release, so there is nothing to release.");
  });
});
