"use client";

// Inline verse finder under the card's ability text (spec §6.4–6.7). No modal, no backdrop:
// the live card preview beside the form stays visible while the builder trims. Every network
// call is an explicit action; typing only re-runs `classify`. All excerpt / ellipsis / handle
// math comes from verseExcerpt.ts — this file only renders it and routes input to it.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { classify, canonicalRef, parseRef, type ParsedRef } from "@/app/forge/lib/scriptureRef";
import {
  words,
  excerpt,
  clampHandles,
  moveHandle,
  snapHandle,
  wholeRange,
  trimToFit,
  type Verse,
  type Handles,
} from "@/app/forge/lib/verseExcerpt";
import { pushRecent, readRecent, writeRecent, type RecentChapter } from "@/app/forge/lib/recentChapters";
import { wrapLines, textFit, TEXT_METRICS, TEXT_WIDTH } from "@/app/forge/lib/textFit";
import type { DesignCard } from "@/app/forge/lib/designCard";
import type { BibleEdition } from "@/app/forge/lib/apiBible";
import { SCOPES, cardNameQuery, scopeById, type ScopeId } from "@/app/forge/lib/searchScope";
import VerseSearch, { type Hit, type SearchSort } from "./VerseSearch";

declare global {
  interface Window {
    fums?: (...args: unknown[]) => void;
    fumsData?: unknown[];
  }
}

type Chapter = {
  bookId: string;
  chapter: number;
  book: string;
  requested: { from: number; to: number };
  verses: Verse[];
  prev: string | null;
  next: string | null;
  copyright: string;
  fumsToken: string;
};
type Search = { total: number; verses: Hit[]; copyright: string; fumsToken: string; offset: number; limit: number };
/** Where the results on screen came from, so paging / chips / sort re-run the same words. */
type SearchOpts = { range: string | null; scopeLabel: string | null; boxScoped: boolean };
/** Recorded when the response lands: paging and the chip row follow the rows on screen, not pending state. */
type LastSearch = SearchOpts & { words: string; sort: SearchSort; exact: boolean; edition: BibleEdition };
type SearchSettings = { sort: SearchSort; exact: boolean; ed: BibleEdition };
type Which = "start" | "end";

const UPSTREAM = "Couldn't reach API.Bible. Type the verse by hand for now.";
const CANT_FIT = "Can't fit without the ability shrinking";
const EDITION_KEY = "forge.verseFinder.edition";
const SEARCH_KEY = "forge.verseFinder.search";

export default function VerseFinderPanel({
  snapshot,
  initialQuery,
  cardName,
  onUse,
  onClose,
  onPreview,
}: {
  snapshot: DesignCard;
  initialQuery: string;
  /** Prefills the box (as keywords, selected) when the card has no reference yet. */
  cardName?: string | null;
  onUse: (patch: { reference: string; scripture: string }) => void;
  onClose: () => void;
  /** Candidate excerpt for the live card preview; null when nothing is loaded. Never saved. */
  onPreview?: (scripture: string | null) => void;
}) {
  const [prefill] = useState(() => (initialQuery.trim() ? null : cardNameQuery(cardName)));
  const [query, setQuery] = useState(prefill ?? initialQuery);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [results, setResults] = useState<Search | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [handles, setHandles] = useState<Handles | null>(null);
  const [recent, setRecent] = useState<RecentChapter[]>([]);
  const [edition, setEdition] = useState<BibleEdition>("2020");
  const [scope, setScope] = useState<ScopeId>("any"); // per card: never persisted
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [exact, setExact] = useState(false);
  const [lastSearch, setLastSearch] = useState<LastSearch | null>(null);
  const [offset, setOffset] = useState(0);
  /** The chapter on screen was opened from a result row: Esc / ← Results go back to the list. */
  const [fromHit, setFromHit] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const startHandleRef = useRef<HTMLButtonElement>(null);
  const mountLookup = useRef(false);
  const onPreviewRef = useRef(onPreview);
  useEffect(() => {
    onPreviewRef.current = onPreview;
  });

  const classified = useMemo(() => classify(query), [query]);

  async function run(
    qs: string,
    opts:
      | { kind: "chapter"; ref?: ParsedRef; select?: number; fromHit?: boolean }
      | { kind: "search"; search: LastSearch; at: number },
    ed: BibleEdition = edition,
  ) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`/forge/api/scripture?${qs}&bible=${ed}`, { signal: ac.signal });
      const body = await res.json().catch(() => null);
      if (ac.signal.aborted) return;
      if (opts.kind === "chapter" && res.status === 404 && body?.error === "verse_out_of_range" && opts.ref) {
        setStatus(`${opts.ref.book} ${opts.ref.chapter} has ${body.verseCount} verses.`);
        return;
      }
      if (!res.ok || !body) {
        setStatus(UPSTREAM);
        return;
      }
      if (opts.kind === "search") {
        const data = body as Search;
        if (opts.at > 0) {
          // A page: append to the list on screen; highlight and focus stay where they are.
          // Upstream relevance paging can shift, so drop rows already listed (keeps `key={hit.id}` unique).
          setResults((prev) => {
            if (!prev) return data;
            const seen = new Set(prev.verses.map((v) => v.id));
            return { ...data, verses: [...prev.verses, ...data.verses.filter((v) => !seen.has(v.id))] };
          });
        } else {
          setChapter(null);
          setHandles(null);
          setFromHit(false);
          setResults(data);
          setHighlight(0);
        }
        setOffset(opts.at);
        setLastSearch(opts.search);
      } else {
        const data = body as Chapter;
        const from = opts.select ?? data.requested.from;
        const to = opts.select ?? data.requested.to;
        // A hit keeps the list behind the chapter; a reference lookup replaces it.
        if (!opts.fromHit) {
          setResults(null);
          setLastSearch(null);
        }
        setFromHit(!!opts.fromHit);
        setChapter(data);
        setHandles(wholeRange(data.verses, from, to));
      }
    } catch {
      if (!ac.signal.aborted) setStatus(UPSTREAM);
    } finally {
      if (abortRef.current === ac) setLoading(false);
    }
  }

  // One keyword search call. A new search from the box uses state; re-runs and pages pass the
  // settings of the search on screen (`fromLast`) with at most one value changed.
  function search(
    words: string,
    opts: SearchOpts,
    at = 0,
    { sort: so, exact: ex, ed }: SearchSettings = { sort, exact, ed: edition },
  ) {
    const p = new URLSearchParams({ q: words, offset: String(at) });
    if (opts.range) p.set("range", opts.range);
    if (so === "canonical") p.set("sort", "canonical");
    if (ex) p.set("exact", "1");
    const { range, scopeLabel, boxScoped } = opts;
    run(
      p.toString(),
      { kind: "search", search: { words, range, scopeLabel, boxScoped, sort: so, exact: ex, edition: ed }, at },
      ed,
    );
  }
  const fromLast = (l: LastSearch): SearchSettings => ({ sort: l.sort, exact: l.exact, ed: l.edition });

  // The chip the rows on screen came from (none while a book from the box scopes them).
  const shownScope: ScopeId | null = lastSearch
    ? lastSearch.boxScoped
      ? null
      : (SCOPES.find((x) => x.range === lastSearch.range)?.id ?? "any")
    : scope;

  const chipSearch = (id: ScopeId): SearchOpts => {
    const s = scopeById(id);
    return { range: s.range, scopeLabel: id === "any" ? null : s.label, boxScoped: false };
  };

  function submit() {
    const c = classified;
    if (c.kind === "ref") run(`ref=${encodeURIComponent(query.trim())}`, { kind: "chapter", ref: c.ref });
    else if (c.kind === "scoped") search(c.rest, { range: c.book.id, scopeLabel: c.book.name, boxScoped: true });
    else if (c.kind === "search") search(query.trim(), chipSearch(scope));
    else if (c.kind === "suggest") setQuery(`${c.book} ${c.rest}`.trim());
  }

  const loadChapter = (id: string, select?: number, fromHit = false) =>
    run(`chapter=${encodeURIComponent(id)}`, { kind: "chapter", select, fromHit });

  function openHit(hit: Hit) {
    const [book, ch, verse] = hit.id.split(".");
    loadChapter(`${book}.${ch}`, Number(verse), true);
  }

  function saveSearchPrefs(next: { sort: SearchSort; exact: boolean }) {
    try {
      window.sessionStorage.setItem(SEARCH_KEY, JSON.stringify(next));
    } catch {
      // storage blocked — the choice still holds for this panel
    }
  }

  // Chip / sort / exact changes re-run what is on screen at offset 0 (one call); with nothing on
  // screen they only update state.
  // The chip row renders from lastSearch, so a click also re-syncs state to what is on screen.
  function changeScope(id: ScopeId) {
    if (id === shownScope) return;
    setScope(id);
    if (results && lastSearch && !lastSearch.boxScoped) search(lastSearch.words, chipSearch(id), 0, fromLast(lastSearch));
  }
  function changeSort(next: SearchSort) {
    const cur = lastSearch ?? { sort, exact };
    if (next === cur.sort) return;
    setSort(next);
    setExact(cur.exact);
    saveSearchPrefs({ sort: next, exact: cur.exact });
    if (results && lastSearch) search(lastSearch.words, lastSearch, 0, { ...fromLast(lastSearch), sort: next });
  }
  function changeExact(next: boolean) {
    const cur = lastSearch ?? { sort, exact };
    setExact(next);
    setSort(cur.sort);
    saveSearchPrefs({ sort: cur.sort, exact: next });
    if (results && lastSearch) search(lastSearch.words, lastSearch, 0, { ...fromLast(lastSearch), exact: next });
  }
  function more() {
    if (results && lastSearch) search(lastSearch.words, lastSearch, offset + results.limit, fromLast(lastSearch));
  }
  function everywhere() {
    if (!lastSearch) return;
    if (lastSearch.boxScoped) setQuery(lastSearch.words);
    setScope("any");
    search(lastSearch.words, chipSearch("any"), 0, fromLast(lastSearch));
  }

  // Back from a chapter opened from a hit: the list returns with the same row highlighted, no fetch.
  // The preview effect releases the card preview (null) once `chapter` is gone.
  const backable = !!chapter && !!results && fromHit;
  const focusList = useRef(false);
  function backToResults() {
    setChapter(null);
    setHandles(null);
    setFromHit(false);
    setStatus(null);
    focusList.current = true;
  }

  // Mount: recent chips, FUMS script + queue stub, and the one automatic lookup.
  useEffect(() => {
    setRecent(readRecent());
    let ed: BibleEdition = "2020";
    try {
      if (window.sessionStorage.getItem(EDITION_KEY) === "1995") ed = "1995";
    } catch {
      // storage blocked — stay on 2020
    }
    setEdition(ed);
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(SEARCH_KEY) ?? "null");
      if (saved?.sort === "canonical") setSort("canonical");
      if (saved?.exact === true) setExact(true);
    } catch {
      // storage blocked or junk — defaults
    }
    window.fumsData = window.fumsData || [];
    window.fums =
      window.fums ||
      function () {
        // eslint-disable-next-line prefer-rest-params
        window.fumsData!.push(arguments);
      };
    if (!document.querySelector('script[src*="fumsV3"]')) {
      const s = document.createElement("script");
      s.src = "https://pkg.api.bible/fumsV3.min.js";
      s.async = true;
      document.head.appendChild(s);
    }
    const c = classify(initialQuery);
    if (c.kind === "ref") {
      mountLookup.current = true;
      run(`ref=${encodeURIComponent(initialQuery.trim())}`, { kind: "chapter", ref: c.ref }, ed);
    }
    // A card-name prefill is only a suggestion: select it so typing replaces it. No fetch.
    if (prefill) inputRef.current?.select();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FUMS: one trackView per chapter / results list rendered from a response.
  useEffect(() => {
    if (chapter?.fumsToken) window.fums?.("trackView", chapter.fumsToken);
  }, [chapter]);
  useEffect(() => {
    if (results?.verses.length && results.fumsToken) window.fums?.("trackView", results.fumsToken);
  }, [results]);

  const ex = useMemo(() => (chapter && handles ? excerpt(chapter.verses, handles) : null), [chapter, handles]);

  // Switching editions refetches what is on screen (same verse span, or the same search).
  function switchEdition(next: BibleEdition) {
    if (next === edition) return;
    setEdition(next);
    try {
      window.sessionStorage.setItem(EDITION_KEY, next);
    } catch {
      // storage blocked — the choice still holds for this panel
    }
    if (chapter && ex) {
      const canonical = canonicalRef(chapter.bookId, chapter.chapter, ex.from, ex.to);
      run(
        `ref=${encodeURIComponent(canonical)}`,
        { kind: "chapter", ref: parseRef(canonical) ?? undefined, fromHit },
        next,
      );
    } else if (results && lastSearch) {
      search(lastSearch.words, lastSearch, 0, { ...fromLast(lastSearch), ed: next });
    }
  }
  const lines = useMemo(
    () => (ex ? wrapLines(ex.text, "italic", TEXT_METRICS.verse.size, TEXT_WIDTH) : []),
    [ex],
  );
  const over = useMemo(() => (ex ? textFit({ ...snapshot, scripture: ex.text }).over : 0), [ex, snapshot]);

  function commit() {
    if (!chapter || !ex || !ex.text) return;
    const reference = canonicalRef(chapter.bookId, chapter.chapter, ex.from, ex.to);
    writeRecent(
      pushRecent(readRecent(), { id: `${chapter.bookId}.${chapter.chapter}`, label: `${chapter.book} ${chapter.chapter}` }),
    );
    onUse({ reference, scripture: ex.text });
  }

  function trim() {
    if (!chapter || !handles) return;
    const next = trimToFit(chapter.verses, handles, snapshot);
    if (next) {
      setHandles(next);
      setStatus(null);
    } else setStatus(CANT_FIT);
  }

  function onRootKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (backable) backToResults();
      else onClose();
    }
  }

  // Live preview: the candidate excerpt while a chapter is loaded, null otherwise and on unmount.
  const previewText = chapter && ex ? ex.text : null;
  useEffect(() => {
    onPreviewRef.current?.(previewText);
  }, [previewText]);
  useEffect(() => () => onPreviewRef.current?.(null), []);

  // Keep focus inside the panel so Esc / ⌘Enter / handle keys keep working. Opening a hit or a chip,
  // a successful trim, and disabled-while-loading buttons all drop focus to <body>; pull it back.
  // Only from <body>: focus the builder moved elsewhere on purpose is left alone.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusList.current && !chapter) {
      focusList.current = false;
      listRef.current?.focus();
    }
  }, [chapter]);
  useEffect(() => {
    if (loading) return;
    // The automatic mount lookup landed while focus is still in the input: go straight to the start
    // handle so a keyboard builder doesn't Tab through Look up / prev / next first.
    if (mountLookup.current && chapter) {
      mountLookup.current = false;
      if (document.activeElement === inputRef.current) startHandleRef.current?.focus();
    }
    const root = rootRef.current;
    const active = document.activeElement;
    if (!root || root.contains(active) || (active && active !== document.body)) return;
    (startHandleRef.current ?? inputRef.current)?.focus();
  }, [chapter, handles, loading]);

  const hasResults = !!results?.verses.length;
  const copyright = chapter ? chapter.copyright : hasResults ? results!.copyright : null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onRootKeyDown}
      className="flex flex-col gap-3 rounded-md border bg-card p-3 outline-none"
    >
      <InputRow
        inputRef={inputRef}
        query={query}
        setQuery={setQuery}
        hint={backable ? "Esc · back to results" : hintFor(classified)}
        status={status}
        loading={loading}
        onSubmit={submit}
        onArrowDown={() => !chapter && hasResults && listRef.current?.focus()}
        chapter={chapter}
        onPrev={() => chapter?.prev && loadChapter(chapter.prev)}
        onNext={() => chapter?.next && loadChapter(chapter.next)}
        edition={edition}
        onEdition={switchEdition}
      />
      {!chapter && !results && <RecentChips recent={recent} disabled={loading} onPick={(id) => loadChapter(id)} />}
      {!chapter && results && lastSearch && (
        <VerseSearch
          listRef={listRef}
          results={{ total: results.total, verses: results.verses, offset, limit: results.limit }}
          words={lastSearch.words}
          scopeLabel={lastSearch.scopeLabel}
          boxScoped={lastSearch.boxScoped}
          scope={shownScope ?? "any"}
          onScope={changeScope}
          sort={lastSearch.sort}
          onSort={changeSort}
          exact={lastSearch.exact}
          onExact={changeExact}
          highlight={highlight}
          setHighlight={setHighlight}
          loading={loading}
          onOpen={openHit}
          onMore={more}
          onEverywhere={everywhere}
        />
      )}
      {chapter && handles && ex && (
        <>
          {backable && (
            <div className="flex items-center">
              <Button type="button" variant="ghost" size="sm" onClick={backToResults}>
                <span aria-hidden="true">←</span> Results ({results!.total})
              </Button>
            </div>
          )}
          <ChapterView
            startHandleRef={startHandleRef}
            chapter={chapter}
            handles={handles}
            excerptText={ex.text}
            onChange={(h) => {
              setHandles(h);
              setStatus(null);
            }}
          />
          <Readout lines={lines} over={over} onTrim={trim} />
          <div className="flex justify-end">
            <Button type="button" variant="default" size="sm" onClick={commit} disabled={!ex.text}>
              Use on card
            </Button>
          </div>
        </>
      )}
      <Footer copyright={copyright} />
    </div>
  );
}

function hintFor(c: ReturnType<typeof classify>): string | null {
  switch (c.kind) {
    case "ref":
      return `→ ${canonicalRef(c.ref.bookId, c.ref.chapter, c.ref.from, c.ref.to)}`;
    case "search":
      return "Keyword search";
    case "scoped":
      return `Keyword search · in ${c.book.name}`;
    case "suggest":
      return `Did you mean ${`${c.book} ${c.rest}`.trim()}?`;
    case "invalid":
      return 'Try "Genesis 6:2" or words from the verse.';
    default:
      return null;
  }
}

function InputRow(props: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (q: string) => void;
  hint: string | null;
  status: string | null;
  loading: boolean;
  onSubmit: () => void;
  onArrowDown: () => void;
  chapter: Chapter | null;
  onPrev: () => void;
  onNext: () => void;
  edition: BibleEdition;
  onEdition: (e: BibleEdition) => void;
}) {
  const { chapter, loading } = props;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          ref={props.inputRef}
          value={props.query}
          onChange={(e) => props.setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              props.onSubmit();
            } else if (e.key === "ArrowDown") {
              props.onArrowDown();
            }
          }}
          placeholder="Genesis 6:2, or words you remember"
          aria-label="Verse reference or keywords"
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <div role="group" aria-label="NASB edition" className="flex shrink-0 overflow-hidden rounded-md border">
          {(["2020", "1995"] as const).map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={props.edition === e}
              title={`NASB ${e}`}
              onClick={() => props.onEdition(e)}
              disabled={loading}
              className={cn(
                "px-2.5 py-1.5 text-xs tabular-nums",
                props.edition === e ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {e}
            </button>
          ))}
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={props.onSubmit} disabled={loading}>
          {loading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          Look up
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label="Previous chapter"
          onClick={props.onPrev}
          disabled={loading || !chapter?.prev}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label="Next chapter"
          onClick={props.onNext}
          disabled={loading || !chapter?.next}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {props.hint && <p className="text-xs text-muted-foreground">{props.hint}</p>}
      {props.status && (
        <p role="status" className="text-xs text-muted-foreground">
          {props.status}
        </p>
      )}
    </div>
  );
}

function RecentChips({
  recent,
  disabled,
  onPick,
}: {
  recent: RecentChapter[];
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  if (!recent.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {recent.map((r, i) => (
        <button
          key={r.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(r.id)}
          className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {r.label}
          {i === 0 && " · last used"}
        </button>
      ))}
    </div>
  );
}

function ChapterView({
  startHandleRef,
  chapter,
  handles,
  excerptText,
  onChange,
}: {
  startHandleRef: RefObject<HTMLButtonElement | null>;
  chapter: Chapter;
  handles: Handles;
  excerptText: string;
  onChange: (h: Handles) => void;
}) {
  const { verses } = chapter;
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRefs = { start: startHandleRef, end: useRef<HTMLButtonElement>(null) };
  const refocus = useRef<Which | null>(null);

  // Word axis for rendering and click routing (offset of each verse's first word).
  const rows = useMemo(() => {
    let offset = 0;
    return verses.map((v) => {
      const w = words(v.text);
      const row = { n: v.n, w, offset };
      offset += w.length;
      return row;
    });
  }, [verses]);
  const abs = (h: Handles["start"]) => {
    const row = rows.find((r) => r.n === h.verse);
    return row ? row.offset + h.word : 0;
  };
  const s = abs(handles.start);
  const e = abs(handles.end);

  // Scroll the selection into view once per loaded chapter.
  useEffect(() => {
    // Center the first selected word by scrolling this box only (never the page).
    const box = containerRef.current;
    const word = box?.querySelector<HTMLElement>('[data-first="true"]');
    if (box && word) box.scrollTop = word.offsetTop + word.offsetHeight / 2 - box.clientHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter]);

  // A moved handle can be re-parented by reconciliation and drop focus; put it back.
  useEffect(() => {
    if (refocus.current) handleRefs[refocus.current].current?.focus();
    refocus.current = null;
  });

  function onWord(n: number, k: number, i: number) {
    const toStart = Math.abs(i - s);
    const toEnd = Math.abs(i + 1 - e);
    const which: Which = i < s ? "start" : i >= e ? "end" : toStart < toEnd ? "start" : "end";
    const next =
      which === "start" ? { ...handles, start: { verse: n, word: k } } : { ...handles, end: { verse: n, word: k + 1 } };
    const focused = (["start", "end"] as const).find((w) => handleRefs[w].current === document.activeElement);
    if (focused) refocus.current = focused;
    onChange(clampHandles(verses, next));
  }

  function onHandleKey(which: Which, ev: KeyboardEvent<HTMLButtonElement>) {
    let next: Handles | null = null;
    if (ev.key === "ArrowLeft") next = moveHandle(verses, handles, which, -1);
    else if (ev.key === "ArrowRight") next = moveHandle(verses, handles, which, 1);
    else if (ev.key === "Home") next = snapHandle(verses, handles, which, "home");
    else if (ev.key === "End") next = snapHandle(verses, handles, which, "end");
    if (!next) return;
    ev.preventDefault();
    refocus.current = which;
    onChange(next);
  }

  const handle = (which: Which) => (
    <button
      key={`${which}-handle`}
      ref={handleRefs[which]}
      type="button"
      aria-label={`${which} handle`}
      onKeyDown={(ev) => onHandleKey(which, ev)}
      className="mx-px inline-block h-5 w-0.5 cursor-ew-resize rounded-full bg-foreground/50 align-middle outline-none focus:bg-primary"
    />
  );

  const lead = excerptText.startsWith("…");
  const trail = excerptText.endsWith("…");
  const items: ReactNode[] = [];
  for (const row of rows) {
    items.push(
      <sup key={`v${row.n}`} className="mr-0.5 text-[10px] text-muted-foreground">
        {row.n}
      </sup>,
    );
    row.w.forEach((word, k) => {
      const i = row.offset + k;
      const inside = i >= s && i < e;
      if (handles.start.verse === row.n && handles.start.word === k) {
        items.push(handle("start"));
        if (lead)
          items.push(
            <span key="lead" className="bg-primary/15">
              …
            </span>,
          );
      }
      items.push(
        <button
          key={`w${i}`}
          type="button"
          tabIndex={-1}
          data-first={i === s ? "true" : undefined}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onWord(row.n, k, i)}
          className={cn("inline cursor-pointer", inside ? "bg-primary/15" : "text-muted-foreground/60")}
        >
          {word}
        </button>,
      );
      if (handles.end.verse === row.n && handles.end.word === k + 1) {
        if (trail)
          items.push(
            <span key="trail" className="bg-primary/15">
              …
            </span>,
          );
        items.push(handle("end"));
      }
      items.push(
        <span key={`s${i}`} className={i >= s && i + 1 < e ? "bg-primary/15" : undefined}>
          {" "}
        </span>,
      );
    });
  }

  return (
    <div
      ref={containerRef}
      className="relative max-h-[50vh] select-none overflow-y-auto rounded-md border bg-background p-3 text-sm leading-7"
    >
      {items}
    </div>
  );
}

function Readout({ lines, over, onTrim }: { lines: string[]; over: number; onTrim: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border bg-background px-3 py-2 font-['ForgeBody'] text-sm italic">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre">
            {line}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
        {over > 0 && (
          <>
            <span className="tabular-nums">ability runs {over} over</span>
            <Button type="button" variant="secondary" size="sm" onClick={onTrim}>
              Trim to fit
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Footer({ copyright }: { copyright: string | null }) {
  return (
    <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
      {copyright && <p>{copyright}</p>}
      <p>
        Scripture text from{" "}
        <a href="https://api.bible" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
          API.Bible
        </a>
      </p>
    </div>
  );
}
