// Pure assembly of the set-wide Review queue — isomorphic (no "use server"),
// imported by a client component and by unit tests alike (same shape as
// app/forge/lib/setCommentsView.ts).

import { diffCards, displayValue, FIELD_LABELS, summarizeDiff } from "@/app/forge/lib/cardDiff";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { timeAgo } from "@/app/forge/lib/relativeTime";
import { sinceCutoffMs } from "@/app/forge/lib/setCommentsView";

export type ReviewKind = "all" | "proposals" | "suggestions";
export type ReviewCardRow = { id: string; title: string | null; status: string };
export type ReviewOpenItem = {
  id: string;
  cardId: string;
  kind: "proposal" | "suggestion";
  createdAt: string;
  who: string | null;
  summary: string | null;    // a proposal's own words; a suggestion has none
  changed: string | null;    // "Changed Card text, Toughness." or "Suggested Toughness: 2"
  baseVersion: number | null;
};
export type ReviewQueueItem = {
  cardId: string;
  title: string | null;
  status: string;
  openProposals: number;
  openSuggestions: number;
  newCount: number;
  latestAt: string;
  items: ReviewOpenItem[];   // proposals first, newest first within each kind
};

export function proposalReviewItem(p: {
  id: string;
  cardId: string;
  createdAt: string;
  who: string | null;
  summary: string | null;
  baseVersionId: string | null;
  base: { versionNumber: number; data: DesignCard } | null;
  proposed: DesignCard;
}): ReviewOpenItem {
  return {
    id: p.id,
    cardId: p.cardId,
    kind: "proposal",
    createdAt: p.createdAt,
    who: p.who,
    summary: p.summary,
    changed: p.baseVersionId === null
      ? "New card — first proposal"
      : p.base ? summarizeDiff(diffCards(p.base.data, p.proposed)) : null,
    baseVersion: p.base?.versionNumber ?? null,
  };
}

export function suggestionReviewItem(c: {
  id: string;
  cardId: string;
  createdAt: string;
  who: string | null;
  field: string;
  suggestedValue: unknown;
}): ReviewOpenItem {
  return {
    id: c.id,
    cardId: c.cardId,
    kind: "suggestion",
    createdAt: c.createdAt,
    who: c.who,
    summary: null,
    changed: `Suggested ${FIELD_LABELS[c.field] ?? c.field}: ${displayValue(c.suggestedValue) ?? "no value given"}`,
    baseVersion: null,
  };
}

// Cards holding at least one open item that survives the filters. Counts are
// recomputed from the surviving items, so the pills always describe what the
// current filters are showing.
export function buildReviewQueue(
  cards: ReviewCardRow[],
  items: ReviewOpenItem[],
  opts?: { since?: string; kind?: ReviewKind; newSince?: number | null }
): ReviewQueueItem[] {
  const cutoff = sinceCutoffMs(opts?.since);
  const kind = opts?.kind ?? "all";
  const newSince = opts?.newSince ?? null;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const queue = new Map<string, ReviewQueueItem>();

  for (const item of items) {
    if (kind === "proposals" && item.kind !== "proposal") continue;
    if (kind === "suggestions" && item.kind !== "suggestion") continue;
    const at = Date.parse(item.createdAt);
    if (cutoff !== null && at < cutoff) continue;
    const card = byId.get(item.cardId);
    if (!card) continue; // an open item on a card outside this set

    let row = queue.get(card.id);
    if (!row) {
      row = {
        cardId: card.id,
        title: card.title,
        status: card.status,
        openProposals: 0,
        openSuggestions: 0,
        newCount: 0,
        latestAt: item.createdAt,
        items: [],
      };
      queue.set(card.id, row);
    }
    row.items.push(item);
    if (item.kind === "proposal") row.openProposals += 1;
    else row.openSuggestions += 1;
    if (newSince !== null && at > newSince) row.newCount += 1;
    if (at > Date.parse(row.latestAt)) row.latestAt = item.createdAt;
  }

  for (const row of queue.values()) {
    row.items.sort(
      (a, b) =>
        Number(b.kind === "proposal") - Number(a.kind === "proposal") ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  }

  return [...queue.values()].sort(
    (a, b) =>
      b.openProposals + b.openSuggestions - (a.openProposals + a.openSuggestions) ||
      Date.parse(b.latestAt) - Date.parse(a.latestAt)
  );
}

// The proposals to list on a card. A refresh drops a closed proposal from the open list, and
// that used to unmount its row with the Accept dialog still open on it, so an error vanished
// a moment after it appeared. The row whose dialog is open stays until the dialog closes.
export function keepHeldProposal<T extends { proposal: { id: string } }>(open: T[], held: T | null): T[] {
  return held && !open.some((d) => d.proposal.id === held.proposal.id) ? [...open, held] : open;
}

// Where a queue row lands. The section ids are in ReviewPanel.
export function reviewRowHref(cardId: string, openProposals: number): string {
  return `/forge/cards/${cardId}#${openProposals > 0 ? "proposals" : "comments"}`;
}

// The studio's way down past the editor to what is waiting for a reviewer.
export function reviewJumpLinks(proposals: number, unresolvedComments: number): { href: string; label: string }[] {
  const count = (n: number, noun: string) => (n === 0 ? `No ${noun}s` : `${n} ${noun}${n === 1 ? "" : "s"}`);
  return [
    { href: "#proposals", label: count(proposals, "open proposal") },
    { href: "#comments", label: count(unresolvedComments, "unresolved comment") },
  ];
}

// The first things a reviewer asks about a proposal or a suggestion.
export function reviewByline(
  p: { who: string | null; at: string; baseVersion: number | null },
  nowMs?: number,
): string {
  return [
    p.who ?? "Forge member",
    timeAgo(p.at, nowMs),
    ...(p.baseVersion === null ? [] : [`against v${p.baseVersion}`]),
  ].join(" · ");
}
