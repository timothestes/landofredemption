import { describe, it, expect } from "vitest";
import {
  deriveSupersededBy, buildHistory, buildCommentEras,
  EVENT_LABEL, VERSION_STATUS_LABEL, VERSION_PILL, versionVerb,
  splitHistoryForDisplay, splitCommentEras,
} from "../historyView";

const prop = (over: any) => ({
  id: "p1", cardId: "c1", baseVersionId: null, resultingVersionId: null, summary: "s",
  status: "open", proposedSnapshot: {}, createdBy: "u1", createdAt: "2026-07-01T00:00:00Z",
  closedAt: null, closedBy: null, ...over,
});
const ver = (over: any) => ({
  id: "v1", versionNumber: 1, status: "published", data: {}, note: null,
  createdBy: "u1", createdAt: "2026-07-01T00:00:00Z", authorName: "Tim", ...over,
});
const comment = (over: any) => ({
  id: "m1", cardId: "c1", proposalId: null, field: null, suggestedValue: null,
  parentId: null, body: "hi", resolved: false, createdBy: "u1",
  createdAt: "2026-07-01T12:00:00Z", authorName: "Tim", ...over,
});

describe("deriveSupersededBy", () => {
  const T = "2026-07-03T10:00:00Z";
  it("names the sibling accepted at the same instant", () => {
    const s = prop({ id: "p1", status: "superseded", closedAt: T });
    const winner = prop({ id: "p2", status: "accepted", closedAt: T, summary: "buff Goliath" });
    expect(deriveSupersededBy(s, [s, winner])).toBe("buff Goliath");
  });
  it("returns null (out of date) when no sibling was accepted then", () => {
    const s = prop({ id: "p1", status: "superseded", closedAt: T });
    const other = prop({ id: "p2", status: "accepted", closedAt: "2026-07-04T00:00:00Z" });
    expect(deriveSupersededBy(s, [s, other])).toBeNull();
  });
});

describe("buildHistory", () => {
  it("merges sources newest-first, diffs consecutive versions, attaches proposal reasons", () => {
    const v1 = ver({ id: "v1", versionNumber: 1, data: { name: "A" }, createdAt: "2026-07-01T00:00:00Z" });
    const v2 = ver({ id: "v2", versionNumber: 2, data: { name: "B" }, createdAt: "2026-07-03T00:00:00Z", note: "renamed" });
    const denied = prop({ id: "p1", status: "denied", closedAt: "2026-07-02T00:00:00Z" });
    const reason = comment({ id: "m1", proposalId: "p1", body: "too strong", createdAt: "2026-07-02T00:00:00Z" });
    const ev = { id: 1, action: "card_approved", actor: "u1", actorName: "Tim", at: "2026-07-04T00:00:00Z" };
    const h = buildHistory([v2, v1], [denied], [ev], [reason]);
    expect(h.map((e) => e.kind)).toEqual(["lifecycle", "version", "proposal", "version"]);
    const versionEntry = h[1] as any;
    expect(versionEntry.version.id).toBe("v2");
    expect(versionEntry.changes).toEqual([expect.objectContaining({ field: "name", before: "A", after: "B" })]);
    expect((h[2] as any).reasons).toEqual([expect.objectContaining({ id: "m1" })]);
  });
  it("omits open proposals (they render in the Open proposals section)", () => {
    expect(buildHistory([], [prop({ status: "open" })], [], [])).toEqual([]);
  });
  it("resolves the accepted proposal's resulting version number", () => {
    const v2 = ver({ id: "v2", versionNumber: 2, createdAt: "2026-07-03T00:00:00Z" });
    const accepted = prop({ id: "p1", status: "accepted", closedAt: "2026-07-03T00:00:00Z", resultingVersionId: "v2" });
    const h = buildHistory([v2], [accepted], [], []);
    const pe = h.find((e) => e.kind === "proposal") as any;
    expect(pe.resultingVersionNumber).toBe(2);
  });
  it("diffs across a draft→draft→published chain (never against {})", () => {
    const v1 = ver({ id: "v1", versionNumber: 1, status: "draft", data: { name: "A" }, createdAt: "2026-07-01T00:00:00Z" });
    const v2 = ver({ id: "v2", versionNumber: 2, status: "draft", data: { name: "B" }, createdAt: "2026-07-02T00:00:00Z" });
    const v3 = ver({ id: "v3", versionNumber: 3, status: "published", data: { name: "C" }, createdAt: "2026-07-03T00:00:00Z" });
    const h = buildHistory([v3, v2, v1], [], [], []) as any[];
    const byId = Object.fromEntries(h.map((e) => [e.version.id, e.changes]));
    expect(byId.v3).toEqual([expect.objectContaining({ field: "name", before: "B", after: "C" })]);
    expect(byId.v2).toEqual([expect.objectContaining({ field: "name", before: "A", after: "B" })]);
  });
  it("resolves resultingVersionNumber for a draft version row", () => {
    const v1 = ver({ id: "v1", versionNumber: 1, status: "draft", createdAt: "2026-07-01T00:00:00Z" });
    const accepted = prop({ id: "p1", status: "accepted", closedAt: "2026-07-01T00:00:00Z", resultingVersionId: "v1" });
    const pe = buildHistory([v1], [accepted], [], []).find((e) => e.kind === "proposal") as any;
    expect(pe.resultingVersionNumber).toBe(1);
  });
});

describe("buildCommentEras", () => {
  it("inserts an era marker before the first comment written after each release", () => {
    const v1 = { versionNumber: 1, createdAt: "2026-07-01T00:00:00Z", status: "published" as const };
    const v2 = { versionNumber: 2, createdAt: "2026-07-03T00:00:00Z", status: "published" as const };
    const c1 = comment({ id: "m1", createdAt: "2026-07-02T00:00:00Z" });
    const c2 = comment({ id: "m2", createdAt: "2026-07-04T00:00:00Z" });
    expect(buildCommentEras([c1, c2], [v2, v1]).map((x) => x.kind === "era" ? `v${x.versionNumber}` : x.comment.id))
      .toEqual(["v1", "m1", "v2", "m2"]);
  });
  it("emits no markers when there are no versions", () => {
    const c1 = comment({ id: "m1" });
    expect(buildCommentEras([c1], [])).toEqual([{ kind: "comment", comment: c1 }]);
  });
  it("carries the version status onto era items (draft iterations divide too)", () => {
    const v1 = { versionNumber: 1, createdAt: "2026-07-01T00:00:00Z", status: "draft" as const };
    const c1 = comment({ id: "m1", createdAt: "2026-07-02T00:00:00Z" });
    const era = buildCommentEras([c1], [v1])[0] as any;
    expect(era).toEqual({ kind: "era", versionNumber: 1, at: "2026-07-01T00:00:00Z", status: "draft" });
  });
});

describe("EVENT_LABEL", () => {
  it("covers all six audited actions", () => {
    for (const a of ["card_approved", "card_unapproved", "card_archived", "card_unarchived", "card_returned_to_ideas", "card_draft_restored"]) {
      expect(EVENT_LABEL[a]).toBeTruthy();
    }
  });
});

describe("version rendering maps", () => {
  it("cover every version status (a miss renders an unlabeled pill)", () => {
    for (const s of ["draft", "published", "approved", "superseded"] as const) {
      expect(VERSION_STATUS_LABEL[s]).toBeTruthy();
      expect(VERSION_PILL[s]).toBeTruthy();
    }
  });
  it("uses 'updated' for draft iterations and 'released' otherwise", () => {
    expect(versionVerb("draft")).toBe("updated");
    expect(versionVerb("published")).toBe("released");
    expect(versionVerb("approved")).toBe("released");
    expect(versionVerb("superseded")).toBe("released");
  });
});

describe("splitHistoryForDisplay", () => {
  const versions7 = Array.from({ length: 7 }, (_, i) => {
    const n = i + 1;
    return ver({ id: `v${n}`, versionNumber: n, createdAt: `2026-07-0${n}T00:00:00Z` });
  });

  it("keeps only the latest version expanded, folding the rest behind one count", () => {
    const h = buildHistory(versions7, [], [], []);
    const { recent, older, hiddenVersionCount } = splitHistoryForDisplay(h);
    expect(recent.length).toBe(1);
    expect((recent[0] as any).version.versionNumber).toBe(7);
    expect(hiddenVersionCount).toBe(6);
    expect(older.length).toBe(6);
  });

  it("keeps events newer than the latest version expanded alongside it", () => {
    const v1 = ver({ id: "v1", versionNumber: 1, createdAt: "2026-07-01T00:00:00Z" });
    const v2 = ver({ id: "v2", versionNumber: 2, createdAt: "2026-07-03T00:00:00Z" });
    const ev = { id: 1, action: "card_approved", actor: "u1", actorName: "Tim", at: "2026-07-04T00:00:00Z" };
    const h = buildHistory([v2, v1], [], [ev], []);
    const { recent, hiddenVersionCount } = splitHistoryForDisplay(h);
    expect(recent.map((e) => e.kind)).toEqual(["lifecycle", "version"]);
    expect(hiddenVersionCount).toBe(1);
  });

  it("keeps a same-instant accepted proposal with the version it minted", () => {
    const v1 = ver({ id: "v1", versionNumber: 1, createdAt: "2026-07-01T00:00:00Z" });
    const v2 = ver({ id: "v2", versionNumber: 2, createdAt: "2026-07-03T00:00:00Z" });
    const accepted = prop({ id: "p1", status: "accepted", closedAt: "2026-07-03T00:00:00Z", resultingVersionId: "v2" });
    const h = buildHistory([v2, v1], [accepted], [], []);
    const { recent, older, hiddenVersionCount } = splitHistoryForDisplay(h);
    expect(recent.map((e) => e.kind)).toEqual(["version", "proposal"]);
    expect(older.map((e) => e.kind)).toEqual(["version"]);
    expect(hiddenVersionCount).toBe(1);
  });

  it("folds nothing when there are no version events", () => {
    const ev1 = { id: 1, action: "card_approved", actor: "u1", actorName: "Tim", at: "2026-07-02T00:00:00Z" };
    const ev2 = { id: 2, action: "card_archived", actor: "u1", actorName: "Tim", at: "2026-07-01T00:00:00Z" };
    const h = buildHistory([], [], [ev1, ev2], []);
    const { recent, older, hiddenVersionCount } = splitHistoryForDisplay(h);
    expect(older).toEqual([]);
    expect(hiddenVersionCount).toBe(0);
    expect(recent).toEqual(h);
  });

  it("never folds down to \"Show 0 earlier versions\" (a lone version with an older denied proposal)", () => {
    const v1 = ver({ id: "v1", versionNumber: 1, createdAt: "2026-07-03T00:00:00Z" });
    const denied = prop({ id: "p1", status: "denied", closedAt: "2026-07-01T00:00:00Z" });
    const h = buildHistory([v1], [denied], [], []);
    const { older, hiddenVersionCount } = splitHistoryForDisplay(h);
    expect(older).toEqual([]);
    expect(hiddenVersionCount).toBe(0);
  });
});

describe("splitCommentEras", () => {
  const v1 = { versionNumber: 1, createdAt: "2026-07-01T00:00:00Z", status: "published" as const };
  const v2 = { versionNumber: 2, createdAt: "2026-07-03T00:00:00Z", status: "published" as const };
  const m1 = comment({ id: "m1", createdAt: "2026-07-02T00:00:00Z" });
  const m2 = comment({ id: "m2", createdAt: "2026-07-04T00:00:00Z" });

  it("defaults to the current version's era, folding earlier eras", () => {
    const items = buildCommentEras([m1, m2], [v2, v1]);
    const { recent, older, hiddenCommentCount } = splitCommentEras(items, 2, () => 0);
    expect(recent.map((i) => (i.kind === "era" ? `v${i.versionNumber}` : i.comment.id))).toEqual(["v2", "m2"]);
    expect(older.map((i) => (i.kind === "era" ? `v${i.versionNumber}` : i.comment.id))).toEqual(["v1", "m1"]);
    expect(hiddenCommentCount).toBe(1);
  });

  it("counts replies toward the hidden total", () => {
    const items = buildCommentEras([m1, m2], [v2, v1]);
    const { hiddenCommentCount } = splitCommentEras(items, 2, (id) => (id === "m1" ? 2 : 0));
    expect(hiddenCommentCount).toBe(3);
  });

  it("hides nothing when there are no versions", () => {
    const items = buildCommentEras([m1], []);
    const { older, hiddenCommentCount } = splitCommentEras(items, null, () => 0);
    expect(older).toEqual([]);
    expect(hiddenCommentCount).toBe(0);
  });

  it("folds everything when nobody has commented since the current version", () => {
    const v2later = { versionNumber: 2, createdAt: "2026-07-05T00:00:00Z", status: "published" as const };
    const items = buildCommentEras([m1], [v2later, v1]);
    const { recent, hiddenCommentCount } = splitCommentEras(items, 2, () => 0);
    expect(recent).toEqual([]);
    expect(hiddenCommentCount).toBe(1);
  });

  it("folds nothing when every comment is in the current era", () => {
    const items = buildCommentEras([m1], [v1]);
    const { older, hiddenCommentCount } = splitCommentEras(items, 1, () => 0);
    expect(older).toEqual([]);
    expect(hiddenCommentCount).toBe(0);
  });
});
