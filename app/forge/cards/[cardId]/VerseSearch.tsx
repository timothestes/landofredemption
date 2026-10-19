"use client";

// Keyword-search half of the verse finder (spec §5.4): scope chips, sort segment, count line,
// the results listbox with match highlights, and Show more. Presentational — every fetch is the
// panel's, triggered only through the callbacks below.

import { useEffect, useRef, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SCOPES, highlightSegments, type ScopeId } from "@/app/forge/lib/searchScope";

export type Hit = { id: string; reference: string; text: string };
export type SearchSort = "relevance" | "canonical";

/** The API caps keyword search at offset 100 (5 pages of `limit` = 25). */
export const CAP = 125;

export function hasMore(r: { total: number; offset: number; limit: number }): boolean {
  return r.offset + r.limit < Math.min(r.total, CAP);
}

const toggle = (pressed: boolean) =>
  cn(
    "px-2.5 py-1 text-xs disabled:opacity-50",
    pressed ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60",
  );
const link = "underline underline-offset-2 hover:text-foreground disabled:opacity-50";

export default function VerseSearch(props: {
  listRef: RefObject<HTMLDivElement | null>;
  results: { total: number; verses: Hit[]; offset: number; limit: number };
  words: string;
  scopeLabel: string | null;
  boxScoped: boolean;
  scope: ScopeId;
  onScope: (s: ScopeId) => void;
  sort: SearchSort;
  onSort: (s: SearchSort) => void;
  exact: boolean;
  onExact: (e: boolean) => void;
  highlight: number;
  setHighlight: (i: number) => void;
  loading: boolean;
  onOpen: (hit: Hit) => void;
  onMore: () => void;
  onEverywhere: () => void;
}) {
  const { results, scopeLabel, exact, loading, listRef } = props;
  const { total, verses } = results;
  const shown = verses.length;
  const more = hasMore(results);
  const capped = !more && total > CAP && results.offset + results.limit >= CAP;

  const where = scopeLabel ? `in ${scopeLabel}` : "matches";
  const count =
    total > CAP ? `${total} ${where} · showing ${shown} of the first ${CAP}` : `${total} ${where} · showing ${shown}`;

  const exactLink = exact ? (
    <>
      {" · exact spelling · "}
      <button type="button" className={link} disabled={loading} onClick={() => props.onExact(false)}>
        Allow similar words
      </button>
    </>
  ) : (
    <>
      {" · "}
      <button type="button" className={link} disabled={loading} onClick={() => props.onExact(true)}>
        Only exact spelling
      </button>
    </>
  );

  function more_() {
    props.onMore();
    listRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Search scope" className="flex flex-wrap overflow-hidden rounded-md border">
          {SCOPES.map((s) => {
            const pressed = !props.boxScoped && props.scope === s.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={pressed}
                disabled={loading || props.boxScoped}
                onClick={() => props.onScope(s.id)}
                className={toggle(pressed)}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="Sort" className="flex shrink-0 overflow-hidden rounded-md border">
          {(
            [
              ["relevance", "Relevance"],
              ["canonical", "Bible order"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={props.sort === id}
              disabled={loading}
              onClick={() => props.onSort(id)}
              className={toggle(props.sort === id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <p role="status">
            {scopeLabel ? `None in ${scopeLabel}.` : "No verses matched."}
            {exact && exactLink}
          </p>
          {scopeLabel && (
            <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={props.onEverywhere}>
              Search everywhere
            </Button>
          )}
        </div>
      ) : (
        <>
          <p role="status" className="text-xs tabular-nums text-muted-foreground">
            {count}
            {exactLink}
          </p>
          <ResultsList {...props} more={more} />
          {(more || capped) && (
            <div>
              <Button type="button" variant="secondary" size="sm" disabled={loading || capped} onClick={more_}>
                {capped ? "Narrow the search to see more" : "Show more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResultsList({
  listRef,
  results,
  words,
  highlight,
  setHighlight,
  loading,
  onOpen,
  onMore,
  more,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  results: { verses: Hit[]; offset: number };
  words: string;
  highlight: number;
  setHighlight: (i: number) => void;
  loading: boolean;
  onOpen: (hit: Hit) => void;
  onMore: () => void;
  more: boolean;
}) {
  const hits = results.verses;
  const prev = useRef(hits);

  useEffect(() => {
    // Scroll only the list itself (scrollIntoView would also scroll the page).
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }, [highlight, listRef]);

  // New rows: an appended page brings its first row into view; a fresh search starts at the top.
  useEffect(() => {
    const list = listRef.current;
    const before = prev.current.length;
    if (prev.current === hits || !list) return; // mount (incl. back from a chapter): highlight effect owns it
    prev.current = hits;
    if (results.offset === 0) {
      list.scrollTop = 0;
      return;
    }
    const row = list.querySelector<HTMLElement>(`[data-index="${before}"]`);
    if (row && row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);

  return (
    <div
      ref={listRef}
      tabIndex={0}
      role="listbox"
      aria-label="Search results"
      aria-activedescendant={`verse-hit-${highlight}`}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          if (highlight >= hits.length - 1) {
            if (more && !loading) onMore();
          } else setHighlight(highlight + 1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlight(Math.max(highlight - 1, 0));
        } else if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          if (hits[highlight]) onOpen(hits[highlight]);
        }
      }}
      className="relative max-h-[50vh] overflow-y-auto rounded-md border outline-none"
    >
      {hits.map((hit, i) => {
        const segs = highlightSegments(hit.text, words);
        const matched = segs.some((s) => s.hit);
        return (
          <div
            key={hit.id}
            id={`verse-hit-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === highlight}
            onClick={() => {
              setHighlight(i);
              onOpen(hit);
            }}
            className={cn(
              "cursor-pointer border-b px-3 py-2 text-sm last:border-b-0",
              i === highlight ? "bg-muted" : "hover:bg-muted/50",
            )}
          >
            <div className="font-medium">{hit.reference}</div>
            <div className="text-muted-foreground">
              {segs.map((s, k) =>
                s.hit ? (
                  <span key={k} className="font-semibold text-foreground">
                    {s.text}
                  </span>
                ) : (
                  <span key={k}>{s.text}</span>
                ),
              )}
              {!matched && <span className="ml-1.5 text-[11px] text-muted-foreground">similar wording</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
