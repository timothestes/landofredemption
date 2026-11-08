// Pure assembly of the card History timeline — isomorphic (no "use server"),
// imported by client components and unit tests alike.

import { diffCards, type FieldChange } from "@/app/forge/lib/cardDiff";
import { STATUS_BADGE_CLASS } from "@/app/forge/lib/lifecycleCopy";
import type { ProposalRow } from "@/app/forge/lib/proposals";
import type { VersionRow, CardEventRow } from "@/app/forge/lib/versions";
import type { CommentRow } from "@/app/forge/lib/comments";

export type HistoryEvent =
  | { kind: "version"; at: string; version: VersionRow; changes: FieldChange[] }
  | { kind: "proposal"; at: string; proposal: ProposalRow; reasons: CommentRow[]; supersededBy: string | null; resultingVersionNumber: number | null }
  | { kind: "lifecycle"; at: string; event: CardEventRow };

export const EVENT_LABEL: Record<string, string> = {
  card_approved: "Marked final",
  card_unapproved: "Reopened testing",
  card_archived: "Shelved",
  card_unarchived: "Restored",
  card_returned_to_ideas: "Returned to ideas",
  card_draft_restored: "Draft put back to the last version",
};

// Version rendering maps — every value of VersionRow["status"] MUST have an
// entry (coverage-tested); a miss renders an unlabeled pill.
export const VERSION_STATUS_LABEL: Record<VersionRow["status"], string> = {
  draft: "Draft",
  published: "Current",
  approved: "Final",
  superseded: "Superseded",
};
export const VERSION_PILL: Record<VersionRow["status"], string> = {
  draft: STATUS_BADGE_CLASS.draft,
  published: STATUS_BADGE_CLASS.playtesting,
  approved: STATUS_BADGE_CLASS.approved,
  superseded: STATUS_BADGE_CLASS.archived,
};
// Draft iterations were never released to playtesters — say "updated".
export function versionVerb(status: VersionRow["status"]): string {
  return status === "draft" ? "updated" : "released";
}

// A superseded proposal closes inside forge_accept_proposal, in the same
// transaction as the winning sibling — their closed_at values are identical
// (transaction-stable now()). No accepted sibling at that instant means the
// stale-base case: a direct release replaced the version it was based on.
export function deriveSupersededBy(p: ProposalRow, all: ProposalRow[]): string | null {
  if (p.status !== "superseded" || !p.closedAt) return null;
  const winner = all.find(
    (q) => q.id !== p.id && q.status === "accepted" && q.closedAt === p.closedAt
  );
  return winner ? (winner.summary ?? "an accepted proposal") : null;
}

// Newest-first merged timeline. Ties (an accept freezes a version and closes
// the proposal at the same instant) order version above its proposal entry.
const KIND_RANK: Record<HistoryEvent["kind"], number> = { lifecycle: 0, version: 1, proposal: 2 };

// PRECONDITION: `versions` must be the FULL elder-visible list (all statuses,
// draft included). A status-filtered list creates versionNumber gaps and the
// n-1 diff silently falls back to {} — a giant "everything added" diff.
export function buildHistory(
  versions: VersionRow[],
  proposals: ProposalRow[],
  events: CardEventRow[],
  comments: CommentRow[]
): HistoryEvent[] {
  const byNumber = new Map(versions.map((v) => [v.versionNumber, v]));
  const out: HistoryEvent[] = [];
  for (const v of versions) {
    const prev = byNumber.get(v.versionNumber - 1);
    out.push({ kind: "version", at: v.createdAt, version: v, changes: diffCards(prev?.data ?? {}, v.data) });
  }
  for (const p of proposals) {
    if (p.status === "open") continue;
    out.push({
      kind: "proposal",
      at: p.closedAt ?? p.createdAt,
      proposal: p,
      reasons: comments.filter((c) => c.proposalId === p.id),
      supersededBy: deriveSupersededBy(p, proposals),
      resultingVersionNumber:
        versions.find((v) => v.id === p.resultingVersionId)?.versionNumber ?? null,
    });
  }
  for (const e of events) out.push({ kind: "lifecycle", at: e.at, event: e });
  return out.sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || KIND_RANK[a.kind] - KIND_RANK[b.kind]
  );
}

// Era dividers for the (ascending) top-level comment thread: before the first
// comment written at-or-after each release, mark which version it followed.
export type CommentEraItem =
  | { kind: "comment"; comment: CommentRow }
  | { kind: "era"; versionNumber: number; at: string; status: VersionRow["status"] };

export function buildCommentEras(
  topComments: CommentRow[],
  versions: Pick<VersionRow, "versionNumber" | "createdAt" | "status">[]
): CommentEraItem[] {
  const eras = [...versions].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: CommentEraItem[] = [];
  let nextEra = 0;
  for (const c of topComments) {
    while (nextEra < eras.length && Date.parse(eras[nextEra].createdAt) <= Date.parse(c.createdAt)) {
      out.push({ kind: "era", versionNumber: eras[nextEra].versionNumber, at: eras[nextEra].createdAt, status: eras[nextEra].status });
      nextEra++;
    }
    out.push({ kind: "comment", comment: c });
  }
  return out;
}

// The fold for History: the latest version (plus anything newer, plus anything
// closed at the same instant — an accept freezes the version and closes its
// proposal together) stays expanded; older entries go behind one disclosure.
// `hiddenVersionCount` is 0 whenever nothing is folded, so the label can never
// say "Show 0 earlier versions".
export function splitHistoryForDisplay(events: HistoryEvent[]): {
  recent: HistoryEvent[];
  older: HistoryEvent[];
  hiddenVersionCount: number;
} {
  const nothingFolded = { recent: events, older: [] as HistoryEvent[], hiddenVersionCount: 0 };
  let latestIdx = -1;
  let latestNumber = -Infinity;
  events.forEach((e, i) => {
    if (e.kind === "version" && e.version.versionNumber > latestNumber) {
      latestNumber = e.version.versionNumber;
      latestIdx = i;
    }
  });
  if (latestIdx === -1) return nothingFolded;
  // Keep same-instant siblings (accepted/superseded proposals) with their version.
  const at = Date.parse(events[latestIdx].at);
  let boundary = latestIdx;
  while (boundary + 1 < events.length && Date.parse(events[boundary + 1].at) === at) boundary++;
  const older = events.slice(boundary + 1);
  const hiddenVersionCount = older.filter((e) => e.kind === "version").length;
  if (hiddenVersionCount === 0) return nothingFolded;
  return { recent: events.slice(0, boundary + 1), older, hiddenVersionCount };
}

// The fold for Comments: default to the current version's era. Everything
// before its era divider collapses behind one disclosure. Replies render as
// their own items, so they count toward the hidden total.
export function splitCommentEras(
  items: CommentEraItem[],
  currentVersionNumber: number | null,
  replyCount: (commentId: string) => number
): { older: CommentEraItem[]; recent: CommentEraItem[]; hiddenCommentCount: number } {
  if (currentVersionNumber === null) return { older: [], recent: items, hiddenCommentCount: 0 };
  const idx = items.findIndex((i) => i.kind === "era" && i.versionNumber === currentVersionNumber);
  // No divider for the current version = nobody has commented since it landed;
  // every comment belongs to an earlier era.
  const older = idx === -1 ? items : items.slice(0, idx);
  const recent = idx === -1 ? [] : items.slice(idx);
  const hiddenCommentCount = older.reduce(
    (n, i) => (i.kind === "comment" ? n + 1 + replyCount(i.comment.id) : n),
    0
  );
  return { older, recent, hiddenCommentCount };
}
