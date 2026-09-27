"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@/components/ui/dialog";
import { MobileDrawer } from "@/components/ui/mobile-drawer";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useInputMode } from "@/app/shared/hooks/useInputMode";
import { loadPublicDecksAction, type LoadPublicDecksParams } from "@/app/decklist/actions";
import { loadUserDecksPaged, loadStarterDecksAction, type LoadUserDecksPagedParams } from "../actions";
import { STARTER_DECKS, hasStarterDecks } from "@/app/config/starterDecks";
import { DeckPickerCard } from "./DeckPickerCard";
import type { DeckOption } from "./DeckPickerCard";

// ─── Constants ────────────────────────────────────────────────────────

const COMMUNITY_PAGE_SIZE = 12;
const MY_DECKS_PAGE_SIZE = 12;

// ─── Props ──────────────────────────────────────────────────────────

export type PickerTab = "starter" | "my" | "community";

interface DeckPickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (deck: DeckOption) => void;
  selectedDeckId?: string | null;
  /** Tab to open on. "starter" falls back to "my" when no starter decks are configured. */
  initialTab?: PickerTab;
}

// ─── Skeleton card for loading state ────────────────────────────────
// Mirrors DeckPickerCard structure so the skeleton's height matches the
// real card (h-24 image + body rows). withAuthor adds the third text row
// shown on Community cards.

function SkeletonCard({ withAuthor }: { withAuthor?: boolean }) {
  return (
    <div className="animate-pulse rounded-lg border border-border bg-gradient-to-br from-card to-muted/40 overflow-hidden flex flex-col">
      <div className="h-24 bg-muted" />
      <div className="px-3 py-2 flex flex-col gap-0.5">
        <div className="h-5 w-3/4 bg-muted rounded" />
        <div className="h-4 w-1/2 bg-muted rounded" />
        {withAuthor && <div className="h-4 w-2/5 bg-muted rounded" />}
      </div>
    </div>
  );
}

// ─── Shared inner content ───────────────────────────────────────────

function DeckPickerContent({
  selectedDeckId,
  onSelect,
  initialTab = "my",
}: {
  selectedDeckId?: string | null;
  onSelect: (deck: DeckOption) => void;
  initialTab?: PickerTab;
}) {
  const showStarter = hasStarterDecks();
  const [activeTab, setActiveTab] = useState<PickerTab>(
    initialTab === "starter" && !showStarter ? "my" : initialTab
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // ── My Decks state (server-paginated) ──
  const [mySearch, setMySearch] = useState("");
  const [mySort, setMySort] = useState<"all" | "latest" | "last_played" | "name">("all");
  const [myFormat, setMyFormat] = useState("");
  const [myPage, setMyPage] = useState(1);
  const [myResults, setMyResults] = useState<DeckOption[]>([]);
  const [myTotal, setMyTotal] = useState(0);
  const [myLoading, setMyLoading] = useState(false);
  const [myHasLoaded, setMyHasLoaded] = useState(false);
  const myDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Community state ──
  const [communitySearch, setCommunitySearch] = useState("");
  const [communityFormat, setCommunityFormat] = useState("");
  const [communitySort, setCommunitySort] = useState<"newest" | "most_viewed" | "name">("newest");
  const [communityPage, setCommunityPage] = useState(1);
  const [communityResults, setCommunityResults] = useState<DeckOption[]>([]);
  const [communityTotal, setCommunityTotal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Starter state — a short fixed list, loaded once on first visit ──
  const [starterResults, setStarterResults] = useState<DeckOption[]>([]);
  const [starterLoaded, setStarterLoaded] = useState(false);
  useEffect(() => {
    if (activeTab !== "starter" || starterLoaded) return;
    let cancelled = false;
    loadStarterDecksAction()
      .then((decks) => { if (!cancelled) setStarterResults(decks); })
      .catch(() => { if (!cancelled) setStarterResults([]); })
      .finally(() => { if (!cancelled) setStarterLoaded(true); });
    return () => { cancelled = true; };
  }, [activeTab, starterLoaded]);

  // Auto-focus search on mount — not on touch, where the keyboard covers the
  // deck grid the player came to browse.
  const isTouchPicker = useInputMode() === 'touch';
  useEffect(() => {
    if (isTouchPicker) return;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [isTouchPicker]);

  // Reset pagination when filters change
  useEffect(() => { setMyPage(1); }, [mySearch, mySort, myFormat]);
  useEffect(() => { setCommunityPage(1); }, [communitySearch, communityFormat, communitySort]);

  // ── My Decks fetch ──
  const fetchMyDecks = useCallback(async () => {
    setMyLoading(true);
    try {
      const params: LoadUserDecksPagedParams = {
        page: myPage,
        pageSize: MY_DECKS_PAGE_SIZE,
        sort: mySort,
      };
      if (mySearch.trim().length > 0) params.search = mySearch.trim();
      if (myFormat) params.format = myFormat;

      const result = await loadUserDecksPaged(params);
      setMyResults(result.decks);
      setMyTotal(result.totalCount);
    } catch {
      setMyResults([]);
      setMyTotal(0);
    } finally {
      setMyLoading(false);
      setMyHasLoaded(true);
    }
  }, [myPage, mySort, mySearch, myFormat]);

  // Debounce my-decks search; immediate on sort/page changes
  useEffect(() => {
    if (activeTab !== "my") return;
    if (myDebounceRef.current) clearTimeout(myDebounceRef.current);
    myDebounceRef.current = setTimeout(fetchMyDecks, mySearch ? 300 : 0);
    return () => {
      if (myDebounceRef.current) clearTimeout(myDebounceRef.current);
    };
  }, [fetchMyDecks, activeTab, mySearch]);

  // ── Community fetch ──
  const fetchCommunity = useCallback(async () => {
    setIsSearching(true);
    try {
      const params: LoadPublicDecksParams = {
        page: communityPage,
        pageSize: COMMUNITY_PAGE_SIZE,
        sort: communitySort,
      };
      if (communitySearch.length >= 2) params.search = communitySearch;
      if (communityFormat) params.format = communityFormat;

      const result = await loadPublicDecksAction(params);
      if (result.success) {
        setCommunityResults(
          result.decks.map((d: any) => ({
            id: d.id,
            name: d.name,
            format: d.format,
            card_count: d.card_count,
            username: d.username,
            preview_card_1: d.preview_card_1,
            preview_card_2: d.preview_card_2,
            paragon: d.paragon,
          }))
        );
        setCommunityTotal(result.totalCount);
      }
    } catch {
      setCommunityResults([]);
      setCommunityTotal(0);
    } finally {
      setIsSearching(false);
      setHasSearched(true);
    }
  }, [communityPage, communitySort, communitySearch, communityFormat]);

  useEffect(() => {
    if (activeTab !== "community") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchCommunity, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchCommunity, activeTab]);

  // Load community on first tab switch
  useEffect(() => {
    if (activeTab === "community" && !hasSearched) {
      fetchCommunity();
    }
  }, [activeTab, hasSearched, fetchCommunity]);

  // Scroll grid to top on page change
  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 });
  }, [myPage, communityPage]);

  // ── Pagination totals ──
  const myTotalPages = Math.max(1, Math.ceil(myTotal / MY_DECKS_PAGE_SIZE));
  const communityTotalPages = Math.max(1, Math.ceil(communityTotal / COMMUNITY_PAGE_SIZE));

  // Left/right arrow keys paginate. Skip when the user is mid-edit
  // (textarea, select, contenteditable, or an input that already has text —
  // there the arrows are moving the caret).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (tag === "INPUT" && (target as HTMLInputElement).value !== "") return;
      if (activeTab === "starter") return; // one page, nothing to paginate
      if (activeTab === "my") {
        if (myTotalPages <= 1) return;
        if (e.key === "ArrowLeft") setMyPage((p) => Math.max(1, p - 1));
        else setMyPage((p) => Math.min(myTotalPages, p + 1));
      } else {
        if (communityTotalPages <= 1) return;
        if (e.key === "ArrowLeft") setCommunityPage((p) => Math.max(1, p - 1));
        else setCommunityPage((p) => Math.min(communityTotalPages, p + 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, myTotalPages, communityTotalPages]);

  // ── Render ──

  const searchValue = activeTab === "my" ? mySearch : communitySearch;
  const setSearchValue = activeTab === "my" ? setMySearch : setCommunitySearch;
  const tabClass = (tab: PickerTab) =>
    `px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
      activeTab === tab
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
    }`;

  return (
    // data-deck-picker: globals.css grows the tabs / search / filter selects
    // to 44px on touch (they're 32-36px from the Tailwind classes here).
    <div data-deck-picker className="flex flex-col gap-2 flex-1 overflow-hidden">
      {/* Tabs */}
      <div className="flex gap-1 shrink-0">
        {showStarter && (
          <button type="button" onClick={() => setActiveTab("starter")} className={tabClass("starter")}>
            Starter
          </button>
        )}
        <button type="button" onClick={() => setActiveTab("my")} className={tabClass("my")}>
          My Decks
        </button>
        <button type="button" onClick={() => setActiveTab("community")} className={tabClass("community")}>
          Community
        </button>
      </div>

      {/* Search + filters row — not on Starter, a handful of decks needs no search */}
      {activeTab !== "starter" && (
      <div className="flex gap-2 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            ref={searchInputRef}
            placeholder={activeTab === "my" ? "Search your decks..." : "Search decks, players..."}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="pl-9 h-9 text-base md:text-sm focus-visible:ring-0 focus-visible:border-primary"
          />
        </div>

        {/* My Decks filters */}
        {activeTab === "my" && (
          <>
            <select
              value={myFormat}
              onChange={(e) => setMyFormat(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="">All Formats</option>
              <option value="Limited">Limited</option>
              <option value="Unlimited">Unlimited</option>
              <option value="T2">T2</option>
              <option value="Paragon">Paragon</option>
            </select>
            <select
              value={mySort}
              onChange={(e) => setMySort(e.target.value as any)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="all">All</option>
              <option value="latest">Latest</option>
              <option value="last_played">Last Played</option>
              <option value="name">Name</option>
            </select>
          </>
        )}

        {/* Community-only filters */}
        {activeTab === "community" && (
          <>
            <select
              value={communityFormat}
              onChange={(e) => setCommunityFormat(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="">All Formats</option>
              <option value="Limited">Limited</option>
              <option value="Unlimited">Unlimited</option>
              <option value="T2">T2</option>
              <option value="Paragon">Paragon</option>
            </select>
            <select
              value={communitySort}
              onChange={(e) => setCommunitySort(e.target.value as any)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              <option value="newest">Newest</option>
              <option value="most_viewed">Popular</option>
              <option value="name">Name</option>
            </select>
          </>
        )}
      </div>
      )}

      {/* Scrollable grid area — fixed flex so modal doesn't jump between pages */}
      <div ref={gridRef} className="flex-1 overflow-y-auto min-h-0" style={{ minHeight: 0 }}>
        {activeTab === "starter" ? (
          !starterLoaded ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Array.from({ length: STARTER_DECKS.length }).map((_, i) => (
                <SkeletonCard key={i} withAuthor />
              ))}
            </div>
          ) : starterResults.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No starter decks are available right now.
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {starterResults.map((deck) => (
                <DeckPickerCard
                  key={deck.id}
                  deck={deck}
                  onClick={() => onSelect(deck)}
                  selected={selectedDeckId === deck.id}
                />
              ))}
            </div>
          )
        ) : activeTab === "my" ? (
          myLoading && !myHasLoaded ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Array.from({ length: MY_DECKS_PAGE_SIZE }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : myResults.length === 0 ? (
            mySearch.trim().length > 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {`No decks matching '${mySearch}'`}
              </p>
            ) : showStarter ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  No saved decks yet. Try a starter deck, build one, or pick from the community.
                </p>
                <Button variant="outline" size="sm" onClick={() => setActiveTab("starter")}>
                  Try a starter deck
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No saved decks yet. Build a deck or try the Community tab.
              </p>
            )
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {myResults.map((deck) => (
                <DeckPickerCard
                  key={deck.id}
                  deck={deck}
                  onClick={() => onSelect(deck)}
                  selected={selectedDeckId === deck.id}
                />
              ))}
            </div>
          )
        ) : (
          isSearching ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Array.from({ length: COMMUNITY_PAGE_SIZE }).map((_, i) => (
                <SkeletonCard key={i} withAuthor />
              ))}
            </div>
          ) : communityResults.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {hasSearched ? "No community decks found." : "Loading..."}
            </p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {communityResults.map((deck) => (
                <DeckPickerCard
                  key={deck.id}
                  deck={deck}
                  onClick={() => onSelect(deck)}
                  selected={selectedDeckId === deck.id}
                />
              ))}
            </div>
          )
        )}
      </div>

      {/* Pagination */}
      {activeTab === "my" && myTotalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMyPage((p) => Math.max(1, p - 1))}
            disabled={myPage === 1}
            className="h-10 w-10 p-0"
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {myPage} / {myTotalPages}
            {myTotal > 0 && ` (${myTotal} decks)`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMyPage((p) => Math.min(myTotalPages, p + 1))}
            disabled={myPage === myTotalPages}
            className="h-10 w-10 p-0"
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        </div>
      )}
      {activeTab === "community" && communityTotalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCommunityPage((p) => Math.max(1, p - 1))}
            disabled={communityPage === 1}
            className="h-10 w-10 p-0"
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {communityPage} / {communityTotalPages}
            {communityTotal > 0 && ` (${communityTotal} decks)`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCommunityPage((p) => Math.min(communityTotalPages, p + 1))}
            disabled={communityPage === communityTotalPages}
            className="h-10 w-10 p-0"
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main modal component ───────────────────────────────────────────

export function DeckPickerModal({
  open,
  onOpenChange,
  onSelect,
  selectedDeckId,
  initialTab,
}: DeckPickerModalProps) {
  // Height-aware: a landscape phone (852x393) satisfies min-width alone and
  // got the desktop Dialog — which has no close button, leaving backdrop-tap
  // as the only undiscoverable exit. Short viewports get the drawer instead.
  const isDesktop = useMediaQuery("(min-width: 768px) and (min-height: 600px)");

  const handleSelect = useCallback(
    (deck: DeckOption) => {
      onSelect(deck);
      onOpenChange(false);
    },
    [onSelect, onOpenChange]
  );

  const content = (
    <DeckPickerContent
      selectedDeckId={selectedDeckId}
      onSelect={handleSelect}
      initialTab={initialTab}
    />
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Select a Deck</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex-1 overflow-hidden flex flex-col gap-3 p-4">
            {content}
          </DialogBody>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <MobileDrawer
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title="Select a Deck"
    >
      <div className="flex flex-col gap-3 px-4 pb-4 h-full overflow-hidden">
        {content}
      </div>
    </MobileDrawer>
  );
}
