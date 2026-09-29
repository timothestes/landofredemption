"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import TopNav from "../../components/top-nav";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import Link from "next/link";

interface CardRuling {
  id: string;
  card_name: string;
  question: string;
  answer: string;
  source: string;
  ruling_date: string | null;
}

interface DiscordMsg {
  id: string;
  author_name: string | null;
  content: string;
  message_date: string;
}

type Tab = "rulings" | "discord";

const SEARCH_LIMIT = 50;

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ruling_date is a DATE column ("2026-09-04"): build it as a local date so the
// day never shifts with the viewer's timezone. Anything else is shown as-is.
function formatRulingDate(dateStr: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function highlightMatch(text: string, query: string) {
  if (!query || query.trim().length < 2) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-transparent font-semibold text-foreground">{part}</mark>
    ) : (
      part
    )
  );
}

/* ------------------------------------------------------------------ */
/*  Discord message card with expandable conversation context           */
/* ------------------------------------------------------------------ */

function DiscordMessageCard({
  msg,
  search,
}: {
  msg: DiscordMsg;
  search: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [context, setContext] = useState<DiscordMsg[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [loadingDir, setLoadingDir] = useState<'older' | 'newer' | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(true);
  const [hasNewer, setHasNewer] = useState(true);
  const messagesRef = useRef<HTMLDivElement>(null);

  const toggleContext = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    if (context.length > 0) {
      setExpanded(true);
      return;
    }

    setContextLoading(true);
    try {
      const res = await fetch(`/api/rulings?discord_context=${msg.id}`);
      if (res.ok) {
        const data = await res.json();
        const messages = data.messages || [];
        setContext(messages);
        setTargetId(data.targetId || msg.id);
        // If we got fewer than 5 before/after the target, there are no more
        const targetIdx = messages.findIndex((m: DiscordMsg) => m.id === (data.targetId || msg.id));
        setHasOlder(targetIdx >= 5);
        setHasNewer(messages.length - targetIdx - 1 >= 5);
      }
    } catch {
      // ignore
    } finally {
      setContextLoading(false);
      setExpanded(true);
    }
  };

  const loadMore = async (direction: 'older' | 'newer') => {
    if (context.length === 0) return;
    const edgeMsg = direction === 'older' ? context[0] : context[context.length - 1];
    if (!edgeMsg) return;

    setLoadingDir(direction);

    // Capture scroll position before DOM change (for older messages)
    const container = messagesRef.current;
    const prevScrollHeight = container?.scrollHeight || 0;

    try {
      const res = await fetch(
        `/api/rulings?discord_more=${encodeURIComponent(edgeMsg.message_date)}&dir=${direction}`
      );
      if (res.ok) {
        const data = await res.json();
        const newMessages: DiscordMsg[] = data.messages || [];

        if (newMessages.length < 5) {
          if (direction === 'older') setHasOlder(false);
          else setHasNewer(false);
        }

        if (newMessages.length > 0) {
          if (direction === 'older') {
            setContext(prev => [...newMessages, ...prev]);
            // Preserve scroll position after prepending
            requestAnimationFrame(() => {
              if (container) {
                const heightDelta = container.scrollHeight - prevScrollHeight;
                window.scrollBy(0, heightDelta);
              }
            });
          } else {
            setContext(prev => [...prev, ...newMessages]);
          }
        } else {
          if (direction === 'older') setHasOlder(false);
          else setHasNewer(false);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingDir(null);
    }
  };

  return (
    <div className="py-3">
      {/* Collapsed: single message */}
      {!expanded && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            {msg.author_name && (
              <span className="text-xs font-medium text-foreground">{msg.author_name}</span>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDate(msg.message_date)}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{highlightMatch(msg.content, search)}</p>
        </div>
      )}

      {/* Expanded: full conversation context */}
      {expanded && (
        <div ref={messagesRef}>
          {/* Sticky collapse header */}
          <button
            onClick={() => setExpanded(false)}
            className="sticky top-0 z-10 flex min-h-11 w-full items-center justify-between border-b border-border/60 bg-background text-xs font-medium text-muted-foreground hover:text-foreground transition-colors sm:min-h-9"
          >
            <span className="flex items-center gap-1.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
              {context.length} messages
            </span>
            <span className="flex items-center gap-1">
              Collapse
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </span>
          </button>

          {/* Load older button */}
          {hasOlder && (
            <button
              onClick={() => loadMore('older')}
              disabled={loadingDir === 'older'}
              className="flex min-h-11 w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors sm:min-h-9"
            >
              {loadingDir === 'older' ? (
                <><div className="animate-spin rounded-full h-3 w-3 border-b border-current" /> Loading...</>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                  Load older messages
                </>
              )}
            </button>
          )}

          <div className="divide-y divide-border/60">
            {context.map((ctxMsg) => {
              const isTarget = ctxMsg.id === (targetId || msg.id);
              return (
                <div
                  key={ctxMsg.id}
                  className={`border-l-2 py-2.5 pl-3 ${isTarget ? 'border-primary' : 'border-transparent'}`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    {ctxMsg.author_name && (
                      <span className={`text-xs font-medium ${isTarget ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {ctxMsg.author_name}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground/60 tabular-nums">
                      {formatDate(ctxMsg.message_date)}
                    </span>
                  </div>
                  <p className={`text-sm leading-relaxed whitespace-pre-wrap ${isTarget ? 'text-foreground' : 'text-muted-foreground/70'}`}>
                    {isTarget ? highlightMatch(ctxMsg.content, search) : ctxMsg.content}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Load newer button */}
          {hasNewer && (
            <button
              onClick={() => loadMore('newer')}
              disabled={loadingDir === 'newer'}
              className="flex min-h-11 w-full items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors sm:min-h-9"
            >
              {loadingDir === 'newer' ? (
                <><div className="animate-spin rounded-full h-3 w-3 border-b border-current" /> Loading...</>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                  Load newer messages
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={toggleContext}
        disabled={contextLoading}
        className="mt-1 flex min-h-11 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors sm:min-h-8"
      >
        {contextLoading ? (
          <>
            <div className="animate-spin rounded-full h-3 w-3 border-b border-current" />
            Loading...
          </>
        ) : expanded ? (
          <>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
            </svg>
            Hide conversation
          </>
        ) : (
          <>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
            </svg>
            Show conversation
          </>
        )}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function RulingsPage() {
  return (
    <Suspense>
      <RulingsPageContent />
    </Suspense>
  );
}

function RulingsPageContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "discord" ? "discord" : "rulings";
  const initialQuery = searchParams.get("q") || "";

  const [tab, setTab] = useState<Tab>(initialTab);
  const [search, setSearch] = useState(initialQuery);
  const [rulings, setRulings] = useState<CardRuling[]>([]);
  const [discordMessages, setDiscordMessages] = useState<DiscordMsg[]>([]);
  const [loading, setLoading] = useState(true);

  // Pagination for recent rulings
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Discord pagination + sort
  const [discordPage, setDiscordPage] = useState(1);
  const [discordTotalPages, setDiscordTotalPages] = useState(1);
  const [discordTotal, setDiscordTotal] = useState(0);
  const [discordSort, setDiscordSort] = useState<"newest" | "oldest">("newest");

  const isSearching = search.trim().length >= 2;
  const searchRef = useRef(search);
  searchRef.current = search;

  // Load recent rulings
  const loadRecent = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rulings?recent=1&page=${p}`);
      if (res.ok) {
        const data = await res.json();
        setRulings(data.rulings || []);
        setTotalPages(data.totalPages || 1);
        setTotal(data.total || 0);
      }
    } catch {
      setRulings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load recent on mount
  useEffect(() => {
    loadRecent(1);
  }, [loadRecent]);

  // Search handler
  const doSearch = useCallback(async (query: string, currentTab: Tab) => {
    if (query.trim().length < 2) return;

    setLoading(true);
    try {
      if (currentTab === "rulings") {
        const res = await fetch(`/api/rulings?search=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          if (searchRef.current === query) {
            setRulings(data.rulings || []);
          }
        }
      } else {
        const res = await fetch(`/api/rulings?discord=${encodeURIComponent(query)}&page=${discordPage}&sort=${discordSort}`);
        if (res.ok) {
          const data = await res.json();
          if (searchRef.current === query) {
            setDiscordMessages(data.messages || []);
            setDiscordTotalPages(data.totalPages || 1);
            setDiscordTotal(data.total || 0);
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [discordPage, discordSort]);

  // Debounced search
  useEffect(() => {
    if (!isSearching) {
      if (tab === "rulings") {
        loadRecent(page);
      } else {
        setDiscordMessages([]);
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    const timeout = setTimeout(() => {
      doSearch(search, tab);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, tab, isSearching, doSearch, loadRecent, page, discordPage, discordSort]);

  // Handle tab switch
  const switchTab = (newTab: Tab) => {
    setTab(newTab);
    setSearch("");
    setDiscordMessages([]);
    setPage(1);
    setDiscordPage(1);
    setDiscordTotal(0);
    setDiscordTotalPages(1);
    if (newTab === "rulings") {
      loadRecent(1);
    } else {
      setRulings([]);
      setLoading(false);
    }
  };

  // Handle discord page change
  const goToDiscordPage = (p: number) => {
    setDiscordPage(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Handle discord sort change
  const toggleDiscordSort = () => {
    setDiscordSort(s => s === "newest" ? "oldest" : "newest");
    setDiscordPage(1);
  };

  // Handle page change
  const goToPage = (p: number) => {
    setPage(p);
    loadRecent(p);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Group rulings by card name
  const groupedRulings = rulings.reduce<Record<string, CardRuling[]>>((acc, ruling) => {
    if (!acc[ruling.card_name]) acc[ruling.card_name] = [];
    acc[ruling.card_name].push(ruling);
    return acc;
  }, {});

  return (
    <>
      <TopNav />
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="font-cinzel text-3xl font-bold tracking-tight sm:text-4xl mb-2">Card Rulings</h1>
          <p className="text-sm text-muted-foreground">
            Search for official rulings and FAQs for Redemption cards.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 mb-4 border-b border-border/60">
          <button
            onClick={() => switchTab("rulings")}
            className={`-mb-px min-h-11 text-sm font-medium border-b-2 transition-colors ${
              tab === "rulings"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Rulings
          </button>
          <button
            onClick={() => switchTab("discord")}
            className={`-mb-px min-h-11 text-sm font-medium border-b-2 transition-colors ${
              tab === "discord"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Community Discussions
          </button>
        </div>

        <div className="mb-6">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setDiscordPage(1); }}
            placeholder={tab === "rulings"
              ? "Search by card name, question, or keyword..."
              : "Search by card name, mechanic, or rules term..."
            }
            className="h-11 w-full text-base"
            autoFocus
          />
        </div>

        {/* Results area — fixed min-height prevents layout shift */}
        <div className="min-h-[320px]">
          {/* Content with loading fade — keeps layout stable */}
          <div className={`transition-opacity duration-150 ${loading ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>

            {/* Rulings tab */}
            {tab === "rulings" && (
              <>
                {/* Section label */}
                {rulings.length > 0 && (
                  <p className="border-b border-border/60 pb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground tabular-nums">
                    {isSearching
                      ? `${rulings.length} result${rulings.length !== 1 ? "s" : ""}`
                      : `${total} rulings total`
                    }
                  </p>
                )}

                {/* No results for search */}
                {!loading && rulings.length === 0 && isSearching && (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg font-medium mb-1">No rulings found</p>
                    <p className="text-sm">
                      Try a different search term, or check back later as more rulings are added.
                    </p>
                  </div>
                )}

                {/* Rulings list */}
                {rulings.length > 0 && (
                  <div>
                    <div className="divide-y divide-border/60">
                      {Object.entries(groupedRulings).map(([cardName, cardRulings]) => (
                        <div key={cardName} className="py-4">
                          <div className="flex items-baseline justify-between gap-3">
                            <h2 className="font-semibold text-foreground">{highlightMatch(cardName, search)}</h2>
                            <Link
                              href={`/decklist/card-search?q=${encodeURIComponent(cardName)}&field=name`}
                              className="-my-3 flex min-h-11 shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors sm:my-0 sm:min-h-0"
                            >
                              View Card
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                              </svg>
                            </Link>
                          </div>
                          <div className="mt-2 space-y-3">
                            {cardRulings.map((ruling) => (
                              <div key={ruling.id}>
                                <p className="text-sm leading-relaxed text-foreground">
                                  <span className="mr-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Q</span>
                                  {highlightMatch(ruling.question, search)}
                                </p>
                                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                                  <span className="mr-2 text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">A</span>
                                  {highlightMatch(ruling.answer, search)}
                                </p>
                                {ruling.ruling_date && (
                                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                                    {formatRulingDate(ruling.ruling_date)}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Search limit notice */}
                    {isSearching && rulings.length >= SEARCH_LIMIT && (
                      <p className="border-t border-border/60 pt-4 text-xs text-muted-foreground text-center">
                        Showing first {SEARCH_LIMIT} results. Try a more specific search to narrow down.
                      </p>
                    )}

                    {/* Pagination for recent (non-search) mode */}
                    {!isSearching && totalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 border-t border-border/60 pt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 sm:min-h-0"
                          onClick={() => goToPage(page - 1)}
                          disabled={page <= 1}
                        >
                          Previous
                        </Button>
                        <span className="text-sm text-muted-foreground px-2 tabular-nums">
                          Page {page} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 sm:min-h-0"
                          onClick={() => goToPage(page + 1)}
                          disabled={page >= totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Discord tab */}
            {tab === "discord" && (
              <>
                {/* Empty state — no search yet */}
                {!isSearching && (
                  <div className="text-center py-16 text-muted-foreground">
                    <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                    </svg>
                    <p className="text-lg font-medium mb-1">Search community discussions</p>
                    <p className="text-sm max-w-md mx-auto">
                      Browse past discussions from the Redemption rulings Discord channel.
                      These are community conversations, and not garunteed to be official rulings,
                      (Unless the message is from RedemptionAggie.)
                    </p>
                  </div>
                )}

                {/* No results */}
                {isSearching && !loading && discordMessages.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-lg font-medium mb-1">No messages found</p>
                    <p className="text-sm">Try a different search term.</p>
                  </div>
                )}

                {/* Discord results */}
                {discordMessages.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-2">
                      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground tabular-nums">
                        {discordTotal} result{discordTotal !== 1 ? "s" : ""}
                        {" from the rulings Discord channel"}
                      </p>
                      <button
                        onClick={toggleDiscordSort}
                        className="-my-3 flex min-h-11 shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors sm:my-0 sm:min-h-0"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                        </svg>
                        {discordSort === "newest" ? "Newest first" : "Oldest first"}
                      </button>
                    </div>
                    <div className="divide-y divide-border/60">
                      {discordMessages.map((msg) => (
                        <DiscordMessageCard key={msg.id} msg={msg} search={search} />
                      ))}
                    </div>

                    {/* Discord pagination */}
                    {discordTotalPages > 1 && (
                      <div className="flex items-center justify-center gap-2 border-t border-border/60 pt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 sm:min-h-0"
                          onClick={() => goToDiscordPage(discordPage - 1)}
                          disabled={discordPage <= 1}
                        >
                          Previous
                        </Button>
                        <span className="text-sm text-muted-foreground px-2 tabular-nums">
                          Page {discordPage} of {discordTotalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-11 sm:min-h-0"
                          onClick={() => goToDiscordPage(discordPage + 1)}
                          disabled={discordPage >= discordTotalPages}
                        >
                          Next
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Centered spinner — only on initial load when no content exists */}
          {loading && rulings.length === 0 && discordMessages.length === 0 && (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
