"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  buildReviewQueue,
  reviewByline,
  reviewRowHref,
  type ReviewCardRow,
  type ReviewKind,
  type ReviewOpenItem,
} from "@/app/forge/lib/reviewView";
import { useLastVisit } from "@/app/forge/lib/useLastVisit";
import SinceFilter from "../SinceFilter";

// A row is meant to be enough to decide whether to open it, not a transcript of the card.
const MAX_ROW_ITEMS = 3;

export default function ReviewQueue({
  setId,
  cards,
  items,
}: {
  setId: string;
  cards: ReviewCardRow[];
  items: ReviewOpenItem[];
}) {
  const [since, setSince] = useState(""); // "" = no date filter; the queue opens on everything
  const [kind, setKind] = useState<ReviewKind>("all");
  const lastVisit = useLastVisit(`forge:set:${setId}:review-last-visit`);

  const rows = useMemo(
    () => buildReviewQueue(cards, items, { since, kind, newSince: lastVisit }),
    [cards, items, since, kind, lastVisit]
  );
  // Counted through the kind filter (but not the date one, which the chip sets),
  // so the chip never promises rows the current filter would hide.
  const newCount = useMemo(
    () => buildReviewQueue(cards, items, { kind, newSince: lastVisit }).reduce((s, r) => s + r.newCount, 0),
    [cards, items, kind, lastVisit]
  );

  return (
    <div className="space-y-3">
      <SinceFilter
        since={since}
        onSince={setSince}
        shown={rows.length}
        total={cards.length}
        newCount={newCount}
        lastVisit={lastVisit}
        dateLabel="Show cards with review items since date"
      >
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ReviewKind)}
          aria-label="Filter by review item kind"
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="all">Proposals and suggestions</option>
          <option value="proposals">Proposals only</option>
          <option value="suggestions">Suggestions only</option>
        </select>
      </SinceFilter>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {cards.length === 0
            ? "Nothing needs review right now."
            : since
              ? `Nothing new since ${since} matches this filter.`
              : "No cards match this filter."}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((i) => (
            <li key={i.cardId}>
              <Link
                href={reviewRowHref(i.cardId, i.openProposals)}
                className="block rounded-md border px-3 py-2 text-sm hover:bg-muted/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words font-medium">{i.title ?? "Untitled card"}</span>
                  <span className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {i.newCount > 0 && (
                      <span className="rounded-full border border-foreground/30 px-2 py-0.5 font-medium text-foreground">
                        {i.newCount} new
                      </span>
                    )}
                    {i.openProposals > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                        {i.openProposals} proposal{i.openProposals === 1 ? "" : "s"}
                      </span>
                    )}
                    {i.openSuggestions > 0 && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">
                        {i.openSuggestions} suggestion{i.openSuggestions === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                  {i.items.slice(0, MAX_ROW_ITEMS).map((item) => (
                    <div key={item.id}>
                      {item.summary && <p className="line-clamp-2 text-sm text-foreground">{item.summary}</p>}
                      {/* The relative time can differ between the server's render and this one. */}
                      <p suppressHydrationWarning className="line-clamp-2">
                        {reviewByline({ who: item.who, at: item.createdAt, baseVersion: item.baseVersion })}
                        {item.changed && ` · ${item.changed}`}
                      </p>
                    </div>
                  ))}
                  {i.items.length > MAX_ROW_ITEMS && <p>+{i.items.length - MAX_ROW_ITEMS} more</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
