// Pure assembly of the set-wide Review queue — isomorphic (no "use server"),
// imported by a client component and by unit tests alike (same shape as
// app/forge/lib/setCommentsView.ts).

import { sinceCutoffMs } from "@/app/forge/lib/setCommentsView";

export type ReviewKind = "all" | "proposals" | "suggestions";
export type ReviewCardRow = { id: string; title: string | null; status: string };
export type ReviewOpenItem = { cardId: string; kind: "proposal" | "suggestion"; createdAt: string };
export type ReviewQueueItem = {
  cardId: string;
  title: string | null;
  status: string;
  openProposals: number;
  openSuggestions: number;
  newCount: number;
  latestAt: string;
};

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
      };
      queue.set(card.id, row);
    }
    if (item.kind === "proposal") row.openProposals += 1;
    else row.openSuggestions += 1;
    if (newSince !== null && at > newSince) row.newCount += 1;
    if (at > Date.parse(row.latestAt)) row.latestAt = item.createdAt;
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
