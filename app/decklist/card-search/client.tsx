"use client";
import React, { useEffect, useState, useMemo, useRef } from "react";

const BATCH_SIZE = 60;
import { useRouter, useSearchParams } from "next/navigation";
import ModalWithClose from "./ModalWithClose";
import FilterGrid from "./components/FilterGrid";
import DeckBuilderPanel, { TabType } from "./components/DeckBuilderPanel";
import SpotlightPanel from "./components/SpotlightPanel";
import {
  Card,
  categorizeRarity,
  isNativityReference,
  iconPredicates,
  searchableIdentifier,
} from "./utils";
import { DeckBuilderConfig, PUBLIC_BUILDER_CONFIG, BuilderConfigProvider } from "./builderConfig";
import { readStickyFilters, writeStickyFilters, type AltArtMode } from "./stickyFilters";
import { hasAbReprint } from "@/lib/cards/lookup";
import { compareCardsDefault } from "@/lib/cards/defaultSort";
import { isBannedInFormat, normalizeFormat, PARAGON_EXCLUDED_SETS } from "@/lib/formats";
import { useDeckState } from "./hooks/useDeckState";
import { useDeckCheck } from "./hooks/useDeckCheck";
import { useCardImageUrl } from "./hooks/useCardImageUrl";
import { useCollectionState } from "../../collection/hooks/useCollectionState";
import { ownedCardNames } from "./utils/collectionCheck";
import { cycleOwnedMode, parseOwnedMode, ownedModeParam, OWNED_MODE_LABELS, type OwnedFilterMode } from "./ownedFilter";
import { parseDeckText, generateDeckText, downloadDeckAsFile, downloadDeckAsFileBySet, copyDeckToClipboard } from "./utils/deckImportExport";
import { createClient } from "../../../utils/supabase/client";
import { getUserSafe } from "../../../utils/supabase/getUserSafe";
import type { User } from "@supabase/supabase-js";
import { deleteDeckAction } from "../actions";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { useCardPrices } from "./hooks/useCardPrices";
import { useHoverPreview } from "./hooks/useHoverPreview";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const supabase = createClient();

// Active-filter pill styling. Compact base + color-coded variants so the summary bar reads as
// a typed list at a glance rather than a wall of identical blue chips.
const PILL_BASE =
  'animate-pill-enter px-2 py-0.5 rounded-full text-xs flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors';
const PILL_STYLES = {
  query: 'bg-blue-500/15 text-blue-300 hover:bg-blue-500/25',
  legality: 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25',
  alignmentGood: 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25',
  alignmentEvil: 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25',
  alignmentNeutral: 'bg-slate-500/20 text-slate-200 hover:bg-slate-500/30',
  rarity: 'bg-violet-500/15 text-violet-300 hover:bg-violet-500/25',
  type: 'bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25',
  testament: 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25',
  gospel: 'bg-yellow-500/15 text-yellow-200 hover:bg-yellow-500/25',
  misc: 'bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/25',
  stat: 'bg-orange-500/15 text-orange-300 hover:bg-orange-500/25',
  collection: 'bg-zinc-500/25 text-zinc-200 hover:bg-zinc-500/35',
  collectionMissing: 'bg-amber-600/20 text-amber-200 hover:bg-amber-600/30',
} as const;
// Brigade pills get tinted with their own brigade color so "Green AND White" reads as the
// brigades themselves, not generic blue chips.
const BRIGADE_PILL_STYLES: Record<string, string> = {
  Blue: 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30',
  Clay: 'bg-rose-300/15 text-rose-200 hover:bg-rose-300/25',
  'Good Gold': 'bg-yellow-400/20 text-yellow-200 hover:bg-yellow-400/30',
  Green: 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30',
  Purple: 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30',
  Silver: 'bg-slate-300/20 text-slate-200 hover:bg-slate-300/30',
  White: 'bg-zinc-100/15 text-zinc-50 hover:bg-zinc-100/25',
  Red: 'bg-red-500/20 text-red-300 hover:bg-red-500/30',
  Teal: 'bg-teal-500/20 text-teal-200 hover:bg-teal-500/30',
  'Good Multi': 'bg-gradient-to-r from-pink-500/15 to-violet-500/15 text-pink-200 hover:from-pink-500/25 hover:to-violet-500/25',
  Black: 'bg-zinc-700/40 text-zinc-200 hover:bg-zinc-700/60',
  Brown: 'bg-amber-800/40 text-amber-200 hover:bg-amber-800/60',
  Crimson: 'bg-pink-600/20 text-pink-300 hover:bg-pink-600/30',
  'Evil Gold': 'bg-yellow-500/20 text-yellow-200 hover:bg-yellow-500/30',
  Gray: 'bg-gray-500/25 text-gray-200 hover:bg-gray-500/35',
  Orange: 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30',
  'Pale Green': 'bg-lime-300/15 text-lime-200 hover:bg-lime-300/25',
  'Evil Multi': 'bg-gradient-to-r from-pink-500/15 to-violet-500/15 text-pink-200 hover:from-pink-500/25 hover:to-violet-500/25',
};
function iconPillClass(name: string): string {
  const brigade = BRIGADE_PILL_STYLES[name];
  return `${PILL_BASE} ${brigade ?? PILL_STYLES.type}`;
}
function alignmentPillClass(mode: string): string {
  const variant =
    mode === 'Good' ? PILL_STYLES.alignmentGood :
    mode === 'Evil' ? PILL_STYLES.alignmentEvil :
    PILL_STYLES.alignmentNeutral;
  return `${PILL_BASE} ${variant}`;
}

// Legality mode names as stored in URLs: 'Rotation'/'Classic' were the old
// pool-mode identifiers, renamed to 'Limited'/'Unlimited'. Normalize old
// values read from a saved/shared URL so they still resolve correctly.
function normalizeLegalityMode(mode: string | null): 'Limited'|'Unlimited'|'Banned'|'Scrolls'|'Paragon' {
  if (mode === 'Rotation') return 'Limited';
  if (mode === 'Classic') return 'Unlimited';
  if (mode === 'Unlimited' || mode === 'Banned' || mode === 'Scrolls' || mode === 'Paragon') return mode;
  return 'Limited';
}

// Helper component for rename form in new deck modal
function NewDeckRenameForm({ 
  onSubmit, 
  onSkip, 
  onDiscard, 
  onCancel 
}: { 
  onSubmit: (name: string) => void; 
  onSkip: () => void; 
  onDiscard: () => void; 
  onCancel: () => void; 
}) {
  const [deckName, setDeckName] = useState("Untitled Deck");

  return (
    <>
      <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
        Your deck is still named <strong className="text-foreground">&quot;Untitled Deck&quot;</strong>. Give it a name before saving?
      </p>

      <div className="mb-5">
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Deck Name
        </label>
        <input
          type="text"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
          placeholder="Enter deck name..."
          className="w-full px-3.5 py-2.5 rounded-lg bg-muted text-foreground placeholder:text-muted-foreground text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onSubmit(deckName.trim() || "Untitled Deck");
            }
          }}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          onClick={() => onSubmit(deckName.trim() || "Untitled Deck")}
          className="w-full px-5 py-2.5 bg-primary/85 text-primary-foreground rounded-lg transition-all font-semibold text-sm hover:bg-primary"
        >
          Save & Create New
        </button>

        <button
          onClick={onDiscard}
          className="w-full px-5 py-2.5 rounded-lg transition-all text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Don&apos;t Save
        </button>

        <button
          onClick={onCancel}
          className="w-full px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </>
  );
}

export default function CardSearchClient({
  config = PUBLIC_BUILDER_CONFIG,
  initialDeckId,
  initialIsNew,
}: {
  config?: DeckBuilderConfig;
  /** Deck id to load, when the host route carries it in the path (e.g. the Forge). Falls back to `?deckId=`. */
  initialDeckId?: string;
  /** Whether to boot in "new deck" mode. Falls back to `?new=true`. */
  initialIsNew?: boolean;
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getImageUrl } = useCardImageUrl();
  
  // Get deck ID from the host route (path param) if provided, else from URL query.
  const deckIdFromUrl = initialDeckId ?? (searchParams.get("deckId") || undefined);
  // Get folder ID from URL params if creating a new deck in a folder
  const folderIdFromUrl = searchParams.get("folderId") || undefined;
  // Check if this is an explicit "new deck" request (path-driven for the Forge, else `?new=true`).
  const isNewDeck = initialIsNew ?? (searchParams.get("new") === "true");
  
  // Collapse state for filter grid — collapsed by default on mobile
  const [filterGridCollapsed, setFilterGridCollapsed] = useState(false);
  useEffect(() => {
    if (window.innerWidth < 768) setFilterGridCollapsed(true);
  }, []);
  // Query state - each query has its own text, search field, and operator
  type QueryOperator = 'AND' | 'OR' | 'AND NOT' | 'NOT';
  type QueryWithOp = { text: string; field: string; operator: QueryOperator };
  const [queries, setQueries] = useState<QueryWithOp[]>([{text: "", field: "everything", operator: "AND"}]);

  // Icon filters with individual operators for each filter
  type IconFilterOperator = 'AND' | 'OR' | 'AND NOT';
  type IconFilterWithOp = { icon: string; operator: IconFilterOperator };
  const [selectedIconFilters, setSelectedIconFilters] = useState<IconFilterWithOp[]>([]);
  
  // Deprecated - keeping for backwards compatibility with URL params
  const [iconFilterMode, setIconFilterMode] = useState<IconFilterOperator>('AND');
  
  // Strength and toughness filter state
  const [strengthFilter, setStrengthFilter] = useState<number | null>(null);
  const [strengthOp, setStrengthOp] = useState<string>('eq');
  const [toughnessFilter, setToughnessFilter] = useState<number | null>(null);
  const [toughnessOp, setToughnessOp] = useState<string>('eq');
  const [cards, setCards] = useState<Card[]>([]);
  // Card legality filter mode: Limited (rotation pool), Unlimited (all), Banned, Scrolls (not Rotation or Banned), Paragon
  const [legalityMode, setLegalityMode] = useState<'Limited'|'Unlimited'|'Banned'|'Scrolls'|'Paragon'>('Limited');
  const [visibleCount, setVisibleCount] = useState(0); // Number of cards to show
  const [sortBy, setSortBy] = useState<'default' | 'name' | 'set' | 'strength' | 'toughness' | 'type' | 'brigade' | 'price-asc' | 'price-desc'>('default');

  const [modalCard, setModalCardRaw] = useState<Card | null>(null);
  const modalOpenedFromDeckRef = useRef(false);
  const setModalCard = React.useCallback((card: Card | null) => {
    if (card === null && modalOpenedFromDeckRef.current) {
      // Reopen deck drawer when closing modal that was opened from deck
      setIsMobileDeckDrawerOpen(true);
      modalOpenedFromDeckRef.current = false;
    }
    setModalCardRaw(card);
  }, []);
  // Alignment filters: Good, Evil, Neutral (multiple selection)
  const [selectedAlignmentFilters, setSelectedAlignmentFilters] = useState<string[]>([]);
  // Rarity filters
  const [selectedRarityFilters, setSelectedRarityFilters] = useState<string[]>([]);
  // Advanced filters
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedTestaments, setSelectedTestaments] = useState<string[]>([]);
  const [isGospel, setIsGospel] = useState(false);
  // Seed the two print/art filters from the user's per-device sticky preference
  // (default "hide" for both when unset). Applies in all modes, including deck
  // editing and the Forge, where a deckId is always present.
  // AB (alternate-art) display mode, seeded from the user's per-device sticky
  // preference. 'hide' (default) hides AB versions; 'all' shows them alongside
  // the standard prints; 'prefer' shows the AB version of any card that has one
  // and hides that card's original. Applies in every mode, including the Forge.
  const [altArtMode, setAltArtMode] = useState<AltArtMode>(() => readStickyFilters().altArt);
  const [noFirstPrint, setnoFirstPrint] = useState(() => readStickyFilters().noFirstPrint);
  const [nativityOnly, setNativityOnly] = useState(false);
  const [hasStarOnly, setHasStarOnly] = useState(false);
  const [cloudOnly, setCloudOnly] = useState(false);
  const [angelOnly, setAngelOnly] = useState(false);
  const [demonOnly, setDemonOnly] = useState(false);
  const [danielOnly, setDanielOnly] = useState(false);
  const [postexilicOnly, setPostexilicOnly] = useState(false);
  
  // Negation states for misc filters (true = NOT/exclude)
  const [nativityNot, setNativityNot] = useState(false);
  const [hasStarNot, setHasStarNot] = useState(false);
  const [cloudNot, setCloudNot] = useState(false);
  const [angelNot, setAngelNot] = useState(false);
  const [demonNot, setDemonNot] = useState(false);
  const [danielNot, setDanielNot] = useState(false);
  const [postexilicNot, setPostexilicNot] = useState(false);
  
  // Testament and Gospel NOT states
  const [testamentNots, setTestamentNots] = useState<Record<string, boolean>>({});
  const [gospelNot, setGospelNot] = useState(false);
  
  const [copyLinkNotification, setCopyLinkNotification] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Notification state
  const [notification, setNotification] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null);

  // Import/export state
  const [importText, setImportText] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFilename, setImportFilename] = useState<string | null>(null);
  const [exportNotification, setExportNotification] = useState(false);

  // Unsaved changes modal state — shown before an action that would replace a
  // deck holding unsaved work (loading another deck). The action runs after
  // Save or Discard; Cancel drops it.
  const [showUnsavedChangesModal, setShowUnsavedChangesModal] = useState(false);
  const [pendingDeckAction, setPendingDeckAction] = useState<(() => void) | null>(null);
  
  // New deck confirmation modal state
  const [showNewDeckModal, setShowNewDeckModal] = useState(false);
  const [pendingNewDeckFolderId, setPendingNewDeckFolderId] = useState<string | null | undefined>(undefined);

  // ESC key handler for the new deck / unsaved changes modals
  useEffect(() => {
    function handleEscKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (showNewDeckModal) setShowNewDeckModal(false);
      if (showUnsavedChangesModal) {
        setShowUnsavedChangesModal(false);
        setPendingDeckAction(null);
      }
    }
    
    document.addEventListener('keydown', handleEscKey);
    return () => document.removeEventListener('keydown', handleEscKey);
  }, [showNewDeckModal, showUnsavedChangesModal]);

  // Panel visibility state
  const [showDeckBuilder, setShowDeckBuilder] = useState(true);
  const [showSearch, setShowSearch] = useState(true);
  const [isMobileDeckDrawerOpen, setIsMobileDeckDrawerOpen] = useState(false);

  // Spotlight mode state
  const [mode, setMode] = useState<"deck" | "spotlight">("deck");
  const [spotlightCard, setSpotlightCard] = useState<Card | null>(null);
  const isSpotlight = mode === "spotlight";
  // Drag-to-deck is disabled on mobile — touch drag doesn't work reliably and
  // the tap/stepper controls cover adding cards.
  const isMobile = useMediaQuery("(max-width: 767px)");

  // Card hover preview. Owned here rather than in DeckBuilderPanel (which
  // renders the toggle) so the search grid on the left honors the same
  // preference as the deck panel on the right.
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(true);
  const searchHoverPreview = useHoverPreview(hoverPreviewEnabled && !isMobile);
  const [player1Name, setPlayer1Name] = useState(() => {
    if (typeof window === 'undefined') return "Player 1";
    return localStorage.getItem('spotlight-p1-name') ?? "Player 1";
  });
  const [player2Name, setPlayer2Name] = useState(() => {
    if (typeof window === 'undefined') return "Player 2";
    return localStorage.getItem('spotlight-p2-name') ?? "Player 2";
  });
  const [player1Score, setPlayer1Score] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const saved = parseInt(localStorage.getItem('spotlight-p1-score') ?? '', 10);
    return Number.isNaN(saved) ? 0 : saved;
  });
  const [player2Score, setPlayer2Score] = useState(() => {
    if (typeof window === 'undefined') return 0;
    const saved = parseInt(localStorage.getItem('spotlight-p2-score') ?? '', 10);
    return Number.isNaN(saved) ? 0 : saved;
  });

  // Persist scoreboard state across refresh / mode toggles
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem('spotlight-p1-name', player1Name);
    localStorage.setItem('spotlight-p2-name', player2Name);
    localStorage.setItem('spotlight-p1-score', String(player1Score));
    localStorage.setItem('spotlight-p2-score', String(player2Score));
  }, [player1Name, player2Name, player1Score, player2Score]);

  // Spotlight mode is desktop-only — reset on mobile
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches && modeRef.current === "spotlight") {
        setMode("deck");
      }
    };
    if (mediaQuery.matches && modeRef.current === "spotlight") {
      setMode("deck");
    }
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  // Clear spotlighted card when leaving spotlight mode.
  // Scoreboard names/scores intentionally persist (see localStorage above) so a
  // mode toggle mid-stream doesn't wipe the live score.
  useEffect(() => {
    if (mode === "deck") {
      setSpotlightCard(null);
    }
  }, [mode]);

  // ESC clears spotlight card
  useEffect(() => {
    if (!isSpotlight) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && spotlightCard) {
        setSpotlightCard(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isSpotlight, spotlightCard]);

  // Auto-open deck drawer on mobile when editing an existing deck
  useEffect(() => {
    if (deckIdFromUrl && !isNewDeck && window.innerWidth < 768) {
      setIsMobileDeckDrawerOpen(true);
    }
  }, [deckIdFromUrl, isNewDeck]);

  // Lock body scroll when mobile deck drawer is open to prevent iOS elastic overscroll
  useEffect(() => {
    if (isMobileDeckDrawerOpen && window.innerWidth < 768) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isMobileDeckDrawerOpen]);

  // Deck panel resize state
  const containerRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const currentDeckPanelWidthRef = useRef(38.2);
  const [deckPanelWidth, setDeckPanelWidth] = useState<number>(38.2);
  useEffect(() => {
    const saved = localStorage.getItem('deck-panel-width');
    if (saved) {
      const parsed = parseFloat(saved);
      if (!Number.isNaN(parsed)) setDeckPanelWidth(parsed);
    }
  }, []);
  // Keep ref in sync so mouseup handler can read latest value
  currentDeckPanelWidthRef.current = deckPanelWidth;

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = deckPanelWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !containerRef.current) return;
      const containerWidth = containerRef.current.offsetWidth;
      const deltaX = e.clientX - resizeStartXRef.current;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newWidth = Math.max(20, Math.min(70, resizeStartWidthRef.current - deltaPercent));
      setDeckPanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem('deck-panel-width', String(currentDeckPanelWidthRef.current));
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);


  // Track active tab in deck builder
  const [activeDeckTab, setActiveDeckTab] = useState<TabType>("main");

  // Track which section we're viewing in full deck view (for modal navigation)
  const [fullDeckViewSection, setFullDeckViewSection] = useState<'main' | 'reserve'>('main');

  // Track which card's "..." menu is open in the search results grid
  const [openSearchMenuCard, setOpenSearchMenuCard] = useState<string | null>(null);

  // Close search card menu on click-outside or ESC
  useEffect(() => {
    if (!openSearchMenuCard) return;
    const handleClick = () => setOpenSearchMenuCard(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenSearchMenuCard(null);
    };
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [openSearchMenuCard]);

  // User authentication state. `authChecked` flips once the first lookup
  // resolves, so anonymous-only UI (the sign-in hint) never flashes for
  // signed-in users while `user` is still null.
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Deck builder state
  const {
    deck,
    syncStatus,
    hasUnsavedChanges,
    isInitializing,
    deferredDeckId,
    addCard,
    removeCard,
    updateQuantity,
    setDeckName,
    setDeckDescription,
    setDeckFormat,
    setDeckParagon,
    setDeckPublic,
    setDeckVisibility,
    setPreviewCards,
    clearDeck,
    newDeck,
    loadDeck,
    loadDeckFromCloud,
    replaceHalf,
    saveDeckToCloud,
    getCardQuantity,
    getDeckStats,
    clearUnsavedChanges,
  } = useDeckState(deckIdFromUrl, folderIdFromUrl, isNewDeck, {
    persistence: config.persistence,
    localStoragePersist: config.features?.localStoragePersist,
  });

  // When the config turns legality checks off entirely (the Forge), the builder
  // behaves as if "Ignore Legality Checks" is permanently on and hides the toggle.
  const legalityChecksEnabled = config.features?.enableLegalityChecks !== false;

  const [ignoreLegalityChecksRawState, setIgnoreLegalityChecksRaw] = useState(() => {
    if (typeof window === 'undefined' || !deck.id) return false;
    return localStorage.getItem(`deck-ignore-legality-${deck.id}`) === 'true';
  });
  const ignoreLegalityChecks = !legalityChecksEnabled || ignoreLegalityChecksRawState;
  const setIgnoreLegalityChecks = (val: boolean) => {
    setIgnoreLegalityChecksRaw(val);
    if (deck.id) {
      localStorage.setItem(`deck-ignore-legality-${deck.id}`, String(val));
    }
  };

  // Sync ignore state when deck changes (e.g., loading a different deck)
  useEffect(() => {
    if (!deck.id) {
      setIgnoreLegalityChecksRaw(false);
      return;
    }
    setIgnoreLegalityChecksRaw(localStorage.getItem(`deck-ignore-legality-${deck.id}`) === 'true');
  }, [deck.id]);

  const { result: deckCheckResult, isChecking: isDeckChecking, setResult: setDeckCheckResult } = useDeckCheck(
    deck,
    !ignoreLegalityChecks && config.features?.serverDeckCheck !== false
  );

  const { getPrice, prices } = useCardPrices();

  // User's card collection — loaded only when signed in. Drives the owned
  // badges on search tiles and the collection actions in the card modal.
  const {
    quantities: collectionQuantities,
    isAvailable: collectionAvailable,
    syncError: collectionSyncError,
    adjustQuantity: adjustCollectionQuantity,
  } = useCollectionState({ enabled: !!user });

  // Collection filter, cycling all → cards I own → cards I don't own. "Owned"
  // builds a deck from what's in your binder; "don't own" is the want-list view
  // (what to pick up next). Ownership is name-level (any printing counts), the
  // same rule "Check my collection" uses.
  const [ownedMode, setOwnedMode] = useState<OwnedFilterMode>("off");
  const ownedNames = useMemo(() => ownedCardNames(collectionQuantities), [collectionQuantities]);
  // Only offered where a collection exists: signed in, and not in the Forge —
  // forge cards are unknown to the shop/collection, the same reason
  // enableShopping gates the other collection features.
  const collectionFilterAvailable = !!user && config.features?.enableShopping !== false;
  // The filter can outlive its availability (a shared ?owned= link opened
  // signed-out). Gate at the point of use rather than resetting state, so the
  // async auth load doesn't race the URL-restored value back off.
  const activeOwnedMode: OwnedFilterMode = collectionFilterAvailable ? ownedMode : "off";

  // Refs for input fields to enable auto-focus
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Helper functions for managing multiple queries
  const updateQuery = (index: number, text: string) => {
    const newQueries = [...queries];
    newQueries[index] = { ...newQueries[index], text };
    setQueries(newQueries);
  };

  const updateQueryField = (index: number, field: string) => {
    const newQueries = [...queries];
    newQueries[index] = { ...newQueries[index], field };
    setQueries(newQueries);
    
    // Auto-focus the input field after changing the field dropdown
    setTimeout(() => {
      inputRefs.current[index]?.focus();
    }, 0);
  };

  const updateQueryOperator = (index: number, operator: QueryOperator) => {
    const newQueries = [...queries];
    newQueries[index] = { ...newQueries[index], operator };
    setQueries(newQueries);
  };

  const addNewQuery = () => {
    setQueries([...queries, {text: "", field: "everything", operator: "AND"}]);
  };

  const removeQuery = (index: number) => {
    if (queries.length > 1) {
      const newQueries = queries.filter((_, i) => i !== index);
      setQueries(newQueries);
    }
  };

  // Function to update URL with current filter state
  // Two modes: deck editing (deckId in URL, no filter params) vs browse (filter params in URL)
  const updateURL = React.useCallback((filters: Record<string, any>) => {
    // Hosts that aren't the public route (the Forge) disable URL sync — these
    // router.replace()s would navigate the user off their route.
    if (config.features?.syncFiltersToUrl === false) return;
    // Mode 1: Deck editing - keep only deckId in the URL, filters are ephemeral
    if (deck.id) {
      router.replace(`/decklist/card-search?deckId=${deck.id}`, { scroll: false });
      return;
    }

    // Mode 2: Browse/search mode - write filter state to URL
    const params = new URLSearchParams();

    // Only add non-default values to URL
    const activeQueries = filters.queries?.filter(q => q.text.trim()) || [];
    if (activeQueries.length > 0) {
      params.set('q', activeQueries[0].text); // For now, only save first query to URL
      if (activeQueries[0].field !== 'everything') params.set('field', activeQueries[0].field);
    }
    if (filters.legalityMode !== 'Limited') params.set('legality', filters.legalityMode);
    if (filters.iconFilterMode !== 'AND') params.set('iconMode', filters.iconFilterMode);
    if (filters.selectedIconFilters.length > 0) {
      // Save icon filters with their operators as JSON
      params.set('icons', JSON.stringify(filters.selectedIconFilters));
    }
    if (filters.selectedAlignmentFilters.length > 0) params.set('alignment', filters.selectedAlignmentFilters.join(','));
    if (filters.selectedRarityFilters.length > 0) params.set('rarity', filters.selectedRarityFilters.join(','));
    if (filters.selectedTestaments.length > 0) {
      params.set('testaments', filters.selectedTestaments.join(','));
      const negatedTestaments = filters.selectedTestaments.filter((t: string) => filters.testamentNots?.[t]);
      if (negatedTestaments.length > 0) params.set('testamentNots', negatedTestaments.join(','));
    }
    if (filters.isGospel) {
      params.set('gospel', 'true');
      if (filters.gospelNot) params.set('gospelNot', 'true');
    }
    if (filters.strengthFilter !== null) {
      params.set('strength', filters.strengthFilter.toString());
      params.set('strengthOp', filters.strengthOp);
    }
    if (filters.toughnessFilter !== null) {
      params.set('toughness', filters.toughnessFilter.toString());
      params.set('toughnessOp', filters.toughnessOp);
    }
    const ownedParam = ownedModeParam(filters.ownedMode);
    if (ownedParam) params.set('owned', ownedParam);
    if (filters.altArtMode !== 'hide') params.set('showAltArt', filters.altArtMode);
    if (!filters.noFirstPrint) params.set('showFirstPrint', 'true');
    if (filters.nativityOnly) {
      params.set('nativity', 'true');
      if (filters.nativityNot) params.set('nativityNot', 'true');
    }
    if (filters.hasStarOnly) {
      params.set('hasStar', 'true');
      if (filters.hasStarNot) params.set('hasStarNot', 'true');
    }
    if (filters.cloudOnly) {
      params.set('cloud', 'true');
      if (filters.cloudNot) params.set('cloudNot', 'true');
    }
    if (filters.angelOnly) {
      params.set('angel', 'true');
      if (filters.angelNot) params.set('angelNot', 'true');
    }
    if (filters.demonOnly) {
      params.set('demon', 'true');
      if (filters.demonNot) params.set('demonNot', 'true');
    }
    if (filters.danielOnly) {
      params.set('daniel', 'true');
      if (filters.danielNot) params.set('danielNot', 'true');
    }
    if (filters.postexilicOnly) {
      params.set('postexilic', 'true');
      if (filters.postexilicNot) params.set('postexilicNot', 'true');
    }
    if (mode === 'spotlight') params.set('mode', 'spotlight');

    const url = params.toString() ? `?${params.toString()}` : '';
    router.replace(`/decklist/card-search${url}`, { scroll: false });
  }, [router, deck.id, mode]);

  // Check user authentication on mount
  useEffect(() => {
    const getUser = async () => {
      const currentUser = await getUserSafe(supabase);
      setUser(currentUser);
      setAuthChecked(true);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthChecked(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Load state from URL on mount (only once)
  // Skip filter loading when in deck editing mode (deckId present)
  useEffect(() => {
    if (searchParams && !isInitialized) {
      // In deck editing mode, don't load filters from URL — they're ephemeral
      if (searchParams.get('deckId')) {
        setIsInitialized(true);
        return;
      }
      const urlQuery = searchParams.get('q') || '';
      const urlField = searchParams.get('field') || 'everything';
      setQueries(urlQuery ? [{text: urlQuery, field: urlField, operator: "AND"}] : [{text: "", field: "everything", operator: "AND"}]);
      setLegalityMode(normalizeLegalityMode(searchParams.get('legality')));
      setIconFilterMode((searchParams.get('iconMode') as any) || 'AND');
      
      // Load icon filters from URL (try JSON first for new format, fall back to CSV for old format)
      const iconsParam = searchParams.get('icons');
      if (iconsParam) {
        try {
          const parsed = JSON.parse(iconsParam);
          if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
            setSelectedIconFilters(parsed);
          } else {
            // Old format: just strings, convert to new format
            const iconNames = iconsParam.split(',').filter(Boolean);
            setSelectedIconFilters(iconNames.map(icon => ({ icon, operator: 'AND' })));
          }
        } catch {
          // Old format: CSV of icon names
          const iconNames = iconsParam.split(',').filter(Boolean);
          setSelectedIconFilters(iconNames.map(icon => ({ icon, operator: 'AND' })));
        }
      }
      
      setSelectedAlignmentFilters(searchParams.get('alignment')?.split(',').filter(Boolean) || []);
      setSelectedRarityFilters(searchParams.get('rarity')?.split(',').filter(Boolean) || []);
      setSelectedTestaments(searchParams.get('testaments')?.split(',').filter(Boolean) || []);
      const testamentNotsParam = searchParams.get('testamentNots');
      if (testamentNotsParam) {
        const negated = testamentNotsParam.split(',').filter(Boolean);
        setTestamentNots(Object.fromEntries(negated.map(t => [t, true])));
      }
      setIsGospel(searchParams.get('gospel') === 'true');
      setGospelNot(searchParams.get('gospelNot') === 'true');

      const strengthParam = searchParams.get('strength');
      if (strengthParam) {
        setStrengthFilter(parseInt(strengthParam, 10));
        setStrengthOp(searchParams.get('strengthOp') || 'eq');
      }

      const toughnessParam = searchParams.get('toughness');
      if (toughnessParam) {
        setToughnessFilter(parseInt(toughnessParam, 10));
        setToughnessOp(searchParams.get('toughnessOp') || 'eq');
      }

      // Explicit shared-link intent overrides the sticky default; otherwise the
      // values keep their initial state seeded from the saved per-device
      // preference (see the useState initializers above). Legacy shared links
      // used showAltArt=true to mean "show all".
      const showAltArtParam = searchParams.get('showAltArt');
      if (showAltArtParam === 'prefer') {
        setAltArtMode('prefer');
      } else if (showAltArtParam === 'all' || showAltArtParam === 'true') {
        setAltArtMode('all');
      }
      if (searchParams.get('showFirstPrint') === 'true') {
        setnoFirstPrint(false);
      }
      // Entry point from /collection ("Build a deck"). Personal to whoever
      // opens the link — it means "cards I own", not "cards they own".
      setOwnedMode(parseOwnedMode(searchParams.get('owned')));
      setNativityOnly(searchParams.get('nativity') === 'true');
      setNativityNot(searchParams.get('nativityNot') === 'true');
      setHasStarOnly(searchParams.get('hasStar') === 'true');
      setHasStarNot(searchParams.get('hasStarNot') === 'true');
      setCloudOnly(searchParams.get('cloud') === 'true');
      setCloudNot(searchParams.get('cloudNot') === 'true');
      setAngelOnly(searchParams.get('angel') === 'true');
      setAngelNot(searchParams.get('angelNot') === 'true');
      setDemonOnly(searchParams.get('demon') === 'true');
      setDemonNot(searchParams.get('demonNot') === 'true');
      setDanielOnly(searchParams.get('daniel') === 'true');
      setDanielNot(searchParams.get('danielNot') === 'true');
      setPostexilicOnly(searchParams.get('postexilic') === 'true');
      setPostexilicNot(searchParams.get('postexilicNot') === 'true');
      
      // Spotlight mode from URL (desktop only)
      if (searchParams.get('mode') === 'spotlight' && !window.matchMedia("(max-width: 767px)").matches) {
        setMode('spotlight');
      }

      setIsInitialized(true);
    }
  }, [searchParams, isInitialized]);

  // Persist the two print/art filters as per-device defaults so the user's
  // choice sticks across sessions (public builder and the Forge alike). Skipped
  // until initialized so we don't clobber the saved value with the mount default
  // before any shared-link URL params have been applied.
  useEffect(() => {
    if (!isInitialized) return;
    writeStickyFilters({ altArt: altArtMode, noFirstPrint });
  }, [altArtMode, noFirstPrint, isInitialized]);

  // Update URL whenever filters change
  useEffect(() => {
    const filters = {
      queries,
      legalityMode,
      iconFilterMode,
      selectedIconFilters,
      selectedAlignmentFilters,
      selectedRarityFilters,
      selectedTestaments,
      testamentNots,
      isGospel,
      gospelNot,
      strengthFilter,
      strengthOp,
      toughnessFilter,
      toughnessOp,
      ownedMode,
      altArtMode,
      noFirstPrint,
      nativityOnly,
      nativityNot,
      hasStarOnly,
      hasStarNot,
      cloudOnly,
      cloudNot,
      angelOnly,
      angelNot,
      demonOnly,
      demonNot,
      danielOnly,
      danielNot,
      postexilicOnly,
      postexilicNot,
    };

    updateURL(filters);
  }, [
    queries, legalityMode, iconFilterMode, selectedIconFilters,
    selectedAlignmentFilters, selectedRarityFilters, selectedTestaments, testamentNots,
    isGospel, gospelNot, strengthFilter,
    strengthOp, toughnessFilter, toughnessOp, ownedMode, altArtMode, noFirstPrint,
    nativityOnly, nativityNot, hasStarOnly, hasStarNot, cloudOnly, cloudNot,
    angelOnly, angelNot, demonOnly, demonNot, danielOnly, danielNot,
    postexilicOnly, postexilicNot, updateURL, mode
  ]);

  // Warn before a reload/close only for a cloud-backed deck with unsaved edits:
  // remounting with ?deckId= in the URL reloads the cloud copy over them. A
  // draft without an id does survive a reload via localStorage, so it gets no
  // prompt. In-app deck switches are covered by the unsaved-changes modal.
  useEffect(() => {
    if (!hasUnsavedChanges || !deck.id) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges, deck.id]);

  // A ?deckId= open that would replace an unsaved draft on this device is held
  // by useDeckState; ask before loading it over the draft. Waits for the auth
  // check so the modal opens in its signed-in or anonymous form, not both.
  useEffect(() => {
    if (!deferredDeckId || !authChecked) return;
    setPendingDeckAction(() => () => openDeckById(deferredDeckId));
    setShowUnsavedChangesModal(true);
  }, [deferredDeckId, authChecked]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl (Windows/Linux) or Cmd (Mac)
      const modKey = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // "/" resets all filters and focuses the first search input — power-user "start fresh" gesture.
      if (!modKey && e.key === '/' && !isTyping && !modalCard) {
        e.preventDefault();
        handleResetFilters();
        inputRefs.current[0]?.focus();
        return;
      }

      // Esc: if focused on a search input — first press clears, second press blurs.
      if (!modKey && e.key === 'Escape' && isTyping && target.tagName === 'INPUT') {
        const inputIdx = inputRefs.current.findIndex(el => el === target);
        if (inputIdx !== -1) {
          const inputEl = target as HTMLInputElement;
          if (inputEl.value !== '') {
            e.preventDefault();
            setQueries(prev => prev.map((q, i) => i === inputIdx ? { ...q, text: '' } : q));
          } else {
            inputEl.blur();
          }
          return;
        }
      }

      // Arrow key navigation for panel visibility (without modifier keys)
      if (!modKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (isTyping) return;
        if (modalCard) return;
        
        e.preventDefault();
        
        // Left arrow: Show fullscreen (hide search to show only deck builder)
        if (e.key === 'ArrowLeft') {
          if (!showDeckBuilder) {
            setShowDeckBuilder(true);
          } else if (showSearch) {
            setShowSearch(false);
          }
        }
        
        // Right arrow: Close fullscreen (show search, hide deck builder if both are visible)
        else if (e.key === 'ArrowRight') {
          if (!showSearch) {
            setShowSearch(true);
          } else if (showDeckBuilder) {
            setShowDeckBuilder(false);
          }
        }
        
        return;
      }
      
      if (!modKey) return;

      // Ctrl+S / Cmd+S to save
      if (e.key === 's') {
        e.preventDefault();
        const stats = getDeckStats();
        if (user && !syncStatus?.isSaving && (stats.mainDeckCount + stats.reserveCount) > 0) {
          saveDeckToCloud().then((result) => {
            if (result?.deckCheckResult) {
              setDeckCheckResult(result.deckCheckResult);
            }
          });
        }
      }
      
      // Ctrl+E / Cmd+E to export
      else if (e.key === 'e') {
        if (config.features?.enableImportExport === false) return;
        e.preventDefault();
        handleExportDeck();
      }

      // Ctrl+I / Cmd+I to import
      else if (e.key === 'i') {
        if (config.features?.enableImportExport === false) return;
        e.preventDefault();
        setShowImportModal(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [user, syncStatus?.isSaving, saveDeckToCloud, handleExportDeck, showSearch, showDeckBuilder, modalCard, getDeckStats]);

  // Card data is built once at module load from the generated CARDS artifact.
  useEffect(() => {
    setCards(config.pool);
  }, [config.pool]);

  // Quick icon filters for type-based icons (reordered) and color-coded brigades
  const colorIcons = [
    "Black",
    "Blue",
    "Brown",
    "Clay",
    "Crimson",
    "Gold",
    "Gray",
    "Green",
    "Orange",
    "Pale Green",
    "Purple",
    "Silver",
    "White",
    "Red",
    "Teal",
  ];

  const filtered = useMemo(
    () =>
      cards
        // Collection filter runs first: a Set lookup, and it shrinks the pool
        // the much heavier text matching below has to walk.
        .filter((c) => {
          if (activeOwnedMode === 'off') return true;
          const owned = ownedNames.has(c.name);
          return activeOwnedMode === 'owned' ? owned : !owned;
        })
        .filter((c) => {
          // Handle multiple queries with operators - similar to icon filter logic
          const activeQueries = queries.filter(q => q.text.trim());
          if (activeQueries.length === 0) return true;
          
          // Start with the first query's result
          let result: boolean;
          const firstQuery = activeQueries[0];
          const norm = (s: string) => s.toLowerCase().replace(/[\u2018\u2019\u201B\u2032\u0060]/g, "'");
          const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          // A query wrapped in double quotes (straight "..." or smart curly quotes)
          // switches from substring matching to whole-word matching on word
          // boundaries. e.g. "Angel" matches "Angel" / "Angel of the Lord" but
          // not "Angela" or "Evangelist".
          const fieldMatches = (value: string, queryObj: QueryWithOp): boolean => {
            const raw = queryObj.text.trim();
            const quoted = raw.length >= 2 && /^["“]/.test(raw) && /["”]$/.test(raw);
            if (quoted) {
              const phrase = norm(raw.slice(1, -1).trim());
              if (!phrase) return true;
              return new RegExp(`\\b${escapeRegExp(phrase)}\\b`).test(norm(value));
            }
            return norm(value).includes(norm(queryObj.text));
          };
          const firstMatches = (queryObj: QueryWithOp): boolean => {
            const searchField = queryObj.field;
            switch (searchField) {
              case 'name':
                return fieldMatches(c.name, queryObj);
              case 'type':
                return fieldMatches(c.type, queryObj);
              case 'brigade':
                return fieldMatches(c.brigade, queryObj);
              case 'specialAbility':
                return fieldMatches(c.specialAbility, queryObj);
              case 'setName':
                return fieldMatches(c.officialSet, queryObj) || fieldMatches(c.set, queryObj);
              case 'identifier':
                return fieldMatches(searchableIdentifier(c), queryObj);
              case 'reference':
                return fieldMatches(c.reference, queryObj);
              default:
                return fieldMatches(`${Object.values(c).join(" ")} ${searchableIdentifier(c)}`, queryObj);
            }
          };
          
          // First query - check if it has a NOT operator (unary negation)
          const firstQueryMatches = firstMatches(firstQuery);
          result = firstQuery.operator === 'NOT' ? !firstQueryMatches : firstQueryMatches;
          
          // Apply each subsequent query with its own operator
          for (let i = 1; i < activeQueries.length; i++) {
            const query = activeQueries[i];
            const matches = firstMatches(query);
            
            // Each query's operator defines how IT combines with the previous result
            const currentOperator = query.operator;
            
            if (currentOperator === 'AND') {
              result = result && matches;
            } else if (currentOperator === 'OR') {
              result = result || matches;
            } else if (currentOperator === 'AND NOT') {
              result = result && !matches;
            } else if (currentOperator === 'NOT') {
              // NOT without AND means AND NOT
              result = result && !matches;
            }
          }
          
          return result;
        })
        // Filter out specific unwanted cards
        .filter((c) => {
          // Exclude Lost Soul Token OT [2024 - Nationals]
          return c.name !== "Lost Soul Token OT [2024 - Nationals]";
        })
        // Legality mode filter
        .filter((c) => {
          if (legalityMode === 'Unlimited') return true;
          if (legalityMode === 'Limited') return c.legality === 'Rotation';
          // Banned is answered per format, not by the card's own flag: DBR 2.0
          // gave each category its own ban list, so what counts as banned
          // depends on the deck being built.
          if (legalityMode === 'Banned') return isBannedInFormat(c, normalizeFormat(deck.format));
          if (legalityMode === 'Scrolls') return c.legality !== 'Rotation' && c.legality !== 'Banned';
          if (legalityMode === 'Paragon') {
            // Paragon format: exclude Lost Souls (not allowed in Paragon)
            if (c.type.toLowerCase().includes('lost soul')) {
              return false;
            }
            // Paragon format: exclude non-legal sets (easier to maintain than include list)
            return !PARAGON_EXCLUDED_SETS.has(c.officialSet);
          }
          return false;
        })
        // Alignment filters (OR across selected filters)
        .filter((c) => {
          if (selectedAlignmentFilters.length === 0) return true;
          return selectedAlignmentFilters.some((mode) => {
            if (mode === 'Neutral') {
              // Neutral includes cards with "Good/Evil" alignment or cards with no Good/Evil alignment
              return c.alignment.includes('Good/Evil') || (!c.alignment.includes('Good') && !c.alignment.includes('Evil'));
            }
            // For Good or Evil filters, exclude cards with "Good/Evil" alignment (they're neutral)
            // Only match cards that are purely Good or purely Evil
            if (c.alignment.includes('Good/Evil')) return false;
            return c.alignment.includes(mode);
          });
        })
        // Rarity filters (OR across selected filters)
        .filter((c) => {
          if (selectedRarityFilters.length === 0) return true;
          const cardRarityCategory = categorizeRarity(c.rarity, c.officialSet);
          return selectedRarityFilters.includes(cardRarityCategory);
        })
        .filter((c) => {
          if (selectedIconFilters.length === 0) return true;
          
          // New logic: evaluate each filter with its operator
          // Start with the first filter's result
          let result: boolean;
          const firstFilter = selectedIconFilters[0];
          const pred = iconPredicates[firstFilter.icon];
          const matches = pred ? pred(c) : c.brigade.split("/").some((b) => b.toLowerCase() === firstFilter.icon.toLowerCase());
          
          // First filter is always evaluated positively
          result = matches;
          
          // Now apply each subsequent filter with its operator
          for (let i = 1; i < selectedIconFilters.length; i++) {
            const filter = selectedIconFilters[i];
            const filterPred = iconPredicates[filter.icon];
            const filterMatches = filterPred ? filterPred(c) : c.brigade.split("/").some((b) => b.toLowerCase() === filter.icon.toLowerCase());
            
            // Get the operator from the PREVIOUS filter (operator between prev and current)
            const prevOperator = selectedIconFilters[i - 1].operator;
            
            if (prevOperator === 'AND') {
              result = result && filterMatches;
            } else if (prevOperator === 'OR') {
              result = result || filterMatches;
            } else if (prevOperator === 'AND NOT') {
              result = result && !filterMatches;
            }
          }
          
          return result;
        })
        // Testament filters
        .filter((c) => {
          if (selectedTestaments.length === 0) return true;
          // Helper to check if testament contains NT or OT
          const hasTestament = (testament, test) => {
            if (Array.isArray(testament)) return testament.includes(test);
            if (typeof testament === 'string') return testament === test || testament.includes(test);
            return false;
          };
          // Check each testament with its NOT state
          return selectedTestaments.every(test => {
            const cardHasTestament = hasTestament(c.testament, test) || (test === 'OT' && c.identifier && c.identifier.includes('O.T.'));
            const isNot = testamentNots[test] || false;
            // If NOT is set, card should NOT have this testament
            // If NOT is not set, card should have this testament
            return isNot ? !cardHasTestament : cardHasTestament;
          });
        })
        // IsGospel filter
        .filter((c) => {
          if (!isGospel) return true;
          const cardIsGospel = c.isGospel;
          // If gospelNot is true, exclude gospel cards; otherwise include only gospel cards
          return gospelNot ? !cardIsGospel : cardIsGospel;
        })
        // Strength filter
        .filter((c) => {
          if (strengthFilter === null) return true;
          const val = parseInt(c.strength, 10);
          if (isNaN(val)) return false;
          switch (strengthOp) {
            case 'lt': return val < strengthFilter;
            case 'lte': return val <= strengthFilter;
            case 'eq': return val === strengthFilter;
            case 'gt': return val > strengthFilter;
            case 'gte': return val >= strengthFilter;
            default: return true;
          }
        })
        // Toughness filter
        .filter((c) => {
          if (toughnessFilter === null) return true;
          const val = parseInt(c.toughness, 10);
          if (isNaN(val)) return false;
          switch (toughnessOp) {
            case 'lt': return val < toughnessFilter;
            case 'lte': return val <= toughnessFilter;
            case 'eq': return val === toughnessFilter;
            case 'gt': return val > toughnessFilter;
            case 'gte': return val >= toughnessFilter;
            default: return true;
          }
        })
        // Misc filters (AB display mode, hide 1st Print K/L Starters)
        .filter((c) => {
          const isAB = c.set.includes("AB");
          if (altArtMode === 'hide') return !isAB;      // hide all AB versions
          if (altArtMode === 'all') return true;         // show AB alongside originals
          // 'prefer': keep every AB card; hide the one original that has an AB twin
          return isAB || !hasAbReprint(c.name, c.set);
        })
        .filter((c) => !noFirstPrint || (
          !c.set.includes("K1P") && !c.set.includes("L1P")
        ))
        .filter((c) => {
          if (!nativityOnly) return true;
          const matches = isNativityReference(c.reference);
          return nativityNot ? !matches : matches;
        })
        .filter((c) => {
          if (!cloudOnly) return true;
          const matches = c.class.toLowerCase().includes("cloud");
          return cloudNot ? !matches : matches;
        })
        .filter((c) => {
          if (!hasStarOnly) return true;
          const matches = c.specialAbility.toLowerCase().includes("star:") || c.specialAbility.toLowerCase().includes("(star)");
          return hasStarNot ? !matches : matches;
        })
        .filter((c) => {
          if (!angelOnly) return true;
          const matches = c.type.includes("Hero") && c.brigade.includes("Silver") && !c.identifier.includes("Human") && !c.identifier.includes("Genderless") && c.name !== "Moses in Glory (GoC)" && c.name !== "Noah, the Righteous / Noah (Rest and Comfort) (LoC)" && c.name !== "Daniel (Promo)";
          return angelNot ? !matches : matches;
        })
        .filter((c) => {
          if (!demonOnly) return true;
          const matches = c.type.includes("Evil Character") && (c.brigade.includes("Orange") || c.name.toLowerCase().includes("demon") || c.name.toLowerCase().includes("obsidian minion") || c.name === "Foul Spirit (E)" || c.name === "Lying Spirit" || c.name === "Spirit of Doubt" || c.name === "Unclean Spirit (E)" || c.name === "Wandering Spirit (Ap)") && c.name !== "Babylon The Harlot (RoJ)" && c.brigade !== "Black/Brown/Crimson/Evil Gold/Gray/Orange/Pale Green" && !c.identifier.includes("Symbolic") && !c.identifier.includes("Animal") && c.name !== "Sabbath Breaker [Gray/Orange]" && c.name !== "The Divining Damsel (Promo)" && c.name !== "The False Prophet (EC)" && c.name !== "The False Prophet (RoJ)" && c.name !== "The False Prophet (RoJ AB)" && c.name !== "Damsel with Spirit of Divination (TxP)" && c.name !== "Saul/Paul" && c.name !== "Judas Iscariot / Judas, the Betrayer (GoC)";
          return demonNot ? !matches : matches;
        })
        .filter((c) => {
          if (!danielOnly) return true;
          const matches = c.reference.toLowerCase().includes("daniel");
          return danielNot ? !matches : matches;
        })
        .filter((c) => {
          if (!postexilicOnly) return true;
          // Check if name contains "postexilic"
          if (c.identifier.toLowerCase().includes("postexilic")) {
            const matches = true;
            return postexilicNot ? !matches : matches;
          }
          // Check if it's one of the specific postexilic cards
          const postexilicCards = [
            "Nehemiah",
            "Eliashib the High Priest",
            "Ezra",
            "Haggai",
            "Haggai (PoC)",
            "Joiada, Son of Eliashib",
            "Joiakim, Son of Joshua",
            "Jonathan, son of Joiada",
            "Joshua the High Priest (PoC)",
            "Joshua the High Priest",
            "Malachi (PoC)",
            "Malachi, the Loved",
            "Malachi",
            "Shelemiah the Priest",
            "Zechariah (Pi)",
            "Zechariah (Pr)",
            "Zechariah (RoA)",
            "Zechariah, the Renewer",
            "Zerubbabel",
            "Foolish Shepherd",
            "Unfaithful Priests"
          ];
          const matches = postexilicCards.includes(c.name);
          return postexilicNot ? !matches : matches;
        }),
    [cards, activeOwnedMode, ownedNames, queries, selectedIconFilters, legalityMode, selectedAlignmentFilters, selectedRarityFilters, selectedTestaments, isGospel, altArtMode, noFirstPrint, nativityOnly, hasStarOnly, cloudOnly, angelOnly, demonOnly, danielOnly, postexilicOnly, strengthFilter, strengthOp, toughnessFilter, toughnessOp, iconFilterMode, nativityNot, hasStarNot, cloudNot, angelNot, demonNot, danielNot, postexilicNot, testamentNots, gospelNot]
  );

  // Effect to show all cards when any filter is applied
  useEffect(() => {
    // If any meaningful filters are active, show all filtered cards, otherwise show none
    // Note: searchField change alone shouldn't trigger showing cards without a query
    const hasActiveQueries = queries.some(q => q.text.trim());
    const hasActiveFilters = hasActiveQueries || 
      activeOwnedMode !== 'off' ||
      selectedIconFilters.length > 0 || 
      selectedAlignmentFilters.length > 0 || 
      selectedRarityFilters.length > 0 || 
      selectedTestaments.length > 0 || 
      isGospel || 
      strengthFilter !== null || 
      toughnessFilter !== null || 
      altArtMode !== 'hide' ||
      !noFirstPrint || 
      nativityOnly || 
      hasStarOnly || 
      cloudOnly || 
      angelOnly || 
      demonOnly || 
      danielOnly || 
      postexilicOnly ||
      legalityMode !== 'Limited';
    
    if (hasActiveFilters) {
      setVisibleCount(BATCH_SIZE);
    } else {
      setVisibleCount(0);
    }
  }, [filtered.length, activeOwnedMode, queries, legalityMode, selectedIconFilters, selectedAlignmentFilters, selectedRarityFilters, selectedTestaments, isGospel, strengthFilter, toughnessFilter, altArtMode, noFirstPrint, nativityOnly, hasStarOnly, cloudOnly, angelOnly, demonOnly, danielOnly, postexilicOnly, testamentNots, gospelNot]);

  const sortedFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'set':
          return a.officialSet.localeCompare(b.officialSet) || a.name.localeCompare(b.name);
        case 'strength': {
          const aStr = parseInt(a.strength) || 0;
          const bStr = parseInt(b.strength) || 0;
          return bStr - aStr || a.name.localeCompare(b.name);
        }
        case 'toughness': {
          const aTgh = parseInt(a.toughness) || 0;
          const bTgh = parseInt(b.toughness) || 0;
          return bTgh - aTgh || a.name.localeCompare(b.name);
        }
        case 'type':
          return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
        case 'brigade':
          return a.brigade.localeCompare(b.brigade) || a.name.localeCompare(b.name);
        case 'name':
          return a.name.localeCompare(b.name);
        case 'price-asc': {
          const aP = getPrice(`${a.name}|${a.set}|${a.imgFile}`)?.price;
          const bP = getPrice(`${b.name}|${b.set}|${b.imgFile}`)?.price;
          if (aP == null && bP == null) return a.name.localeCompare(b.name);
          if (aP == null) return 1;
          if (bP == null) return -1;
          return aP - bP || a.name.localeCompare(b.name);
        }
        case 'price-desc': {
          const aP = getPrice(`${a.name}|${a.set}|${a.imgFile}`)?.price;
          const bP = getPrice(`${b.name}|${b.set}|${b.imgFile}`)?.price;
          if (aP == null && bP == null) return a.name.localeCompare(b.name);
          if (aP == null) return 1;
          if (bP == null) return -1;
          return bP - aP || a.name.localeCompare(b.name);
        }
        case 'default':
        default:
          return compareCardsDefault(a, b);
      }
    });
  }, [filtered, sortBy, prices]);

  const visibleCards = useMemo(
    () => sortedFiltered.slice(0, visibleCount),
    [sortedFiltered, visibleCount]
  );

  // Whether any filter pills should be shown in the summary bar
  const hasActiveFilters = queries.some(q => q.text.trim()) ||
    activeOwnedMode !== 'off' ||
    legalityMode !== 'Limited' ||
    selectedAlignmentFilters.length > 0 ||
    selectedRarityFilters.length > 0 ||
    selectedIconFilters.length > 0 ||
    selectedTestaments.length > 0 ||
    isGospel ||
    strengthFilter !== null ||
    toughnessFilter !== null ||
    altArtMode !== 'hide' ||
    !noFirstPrint ||
    nativityOnly ||
    hasStarOnly ||
    cloudOnly ||
    angelOnly ||
    demonOnly ||
    danielOnly ||
    postexilicOnly;


  // Infinite scroll: load more cards when sentinel comes into view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= filtered.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + BATCH_SIZE, filtered.length));
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, filtered.length]);

  // Toggler for icon filters
  function toggleIconFilter(value: string) {
    setSelectedIconFilters((prev) => {
      const exists = prev.find(f => f.icon === value);
      if (exists) {
        // Remove the filter
        return prev.filter((v) => v.icon !== value);
      } else {
        // Add the filter with default operator (AND)
        return [...prev, { icon: value, operator: 'AND' }];
      }
    });
  }
  
  // Update operator for a specific icon filter
  function updateIconFilterOperator(icon: string, operator: IconFilterOperator) {
    setSelectedIconFilters((prev) => 
      prev.map(f => f.icon === icon ? { ...f, operator } : f)
    );
  }

  // Update operator for ALL icon filters (used by Icon Filter Mode button)
  function updateAllIconFilterOperators(operator: IconFilterOperator) {
    setSelectedIconFilters((prev) => 
      prev.map(filter => ({ ...filter, operator }))
    );
  }

  // Toggler for alignment filters
  function toggleAlignmentFilter(value: string) {
    setSelectedAlignmentFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }
  
  // Toggler for rarity filters
  function toggleRarityFilter(value: string) {
    setSelectedRarityFilters((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  // Brigade normalization helpers - now imported from utils

  // Handle deck format change - also update legality mode filter
  function handleDeckFormatChange(format: string) {
    setDeckFormat(format);
    const canonical = normalizeFormat(format);
    if (canonical === 'Paragon') {
      setLegalityMode('Paragon');
    } else if (canonical === 'Unlimited') {
      setLegalityMode('Unlimited');
    } else {
      setLegalityMode('Limited');
    }
  }

  // Reset filters handler
  function handleResetFilters() {
    setQueries([{text: "", field: "everything", operator: "AND"}]);
    setSelectedIconFilters([]);
    // Keep current legality mode when resetting (don't reset to Limited)
    // setLegalityMode('Limited');
    setIconFilterMode('AND');
    setSelectedAlignmentFilters([]);
    setSelectedRarityFilters([]);
    setSelectedTestaments([]);
    setIsGospel(false);
    setOwnedMode('off');
    // Keep the sticky print/art preferences on reset (don't force "hide" back
    // on) — they mirror the persisted per-device default, like legalityMode above.
    setNativityOnly(false);
    setHasStarOnly(false);
    setCloudOnly(false);
    setAngelOnly(false);
    setDemonOnly(false);
    setDanielOnly(false);
    setPostexilicOnly(false);
    setStrengthFilter(null);
    setStrengthOp('eq');
    setToughnessFilter(null);
    setToughnessOp('eq');
    
    // Reset NOT states
    setNativityNot(false);
    setHasStarNot(false);
    setCloudNot(false);
    setAngelNot(false);
    setDemonNot(false);
    setDanielNot(false);
    setPostexilicNot(false);
    setTestamentNots({});
    setGospelNot(false);
    
    setVisibleCount(0); // Don't show any cards after reset

    // Clear URL (skip for hosts that disable URL sync, e.g. the Forge)
    if (config.features?.syncFiltersToUrl !== false) {
      router.replace('/decklist/card-search', { scroll: false });
    }
  }

  // Copy current search URL to clipboard
  function handleCopyLink() {
    const currentUrl = window.location.href;
    navigator.clipboard.writeText(currentUrl).then(() => {
      setCopyLinkNotification(true);
      setTimeout(() => setCopyLinkNotification(false), 2000); // Hide after 2 seconds
    }).catch(err => {
      console.error('Failed to copy link:', err);
    });
  }

  function handleExportCSV() {
    if (sortedFiltered.length === 0) return;
    const columns = [
      'name', 'set', 'officialSet', 'imgFile', 'type', 'brigade',
      'strength', 'toughness', 'class', 'identifier', 'specialAbility',
      'rarity', 'reference', 'alignment', 'legality',
    ] as const;
    const escape = (val: string) => {
      const s = val ?? '';
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [...columns, 'ytg_price'].join(',');
    const rows = sortedFiltered.map(card => {
      const priceInfo = getPrice(`${card.name}|${card.set}|${card.imgFile}`);
      const ytgPrice = priceInfo ? priceInfo.price.toFixed(2) : '';
      return [...columns.map(col => escape(String(card[col] ?? ''))), escape(ytgPrice)].join(',');
    });
    const csv = '﻿' + [header, ...rows].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const a = document.createElement('a');
    a.href = url;
    a.download = `redemption-cards-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Export deck to clipboard (with file download fallback)
  async function handleExportDeck() {
    try {
      await copyDeckToClipboard(deck);
      setExportNotification(true);
      setTimeout(() => setExportNotification(false), 2000);
    } catch (err) {
      console.error('Failed to copy deck to clipboard:', err);
      // Fallback to download if clipboard fails
      downloadDeckAsFile(deck);
    }
  }

  // Download deck as .txt file
  function handleDownloadDeck() {
    downloadDeckAsFile(deck);
  }

  function handleDownloadDeckBySet() {
    downloadDeckAsFileBySet(deck);
  }

  // Load a deck by id; on success let the active config sync external state
  // (the Forge rewrites /forge/play/decks/<id>).
  async function openDeckById(deckId: string) {
    const ok = await loadDeckFromCloud(deckId);
    if (ok) config.onDeckLoaded?.(deckId);
  }

  // Load a deck picked from the Load Deck modal (or a fresh duplicate). Loading
  // replaces the working deck in memory and in localStorage, so ask first when
  // it holds unsaved cards. Same "has cards" gate as handleNewDeck: a blank
  // deck reads as unsaved right after New Deck and must not nag.
  function handleLoadDeckById(deckId: string) {
    const stats = getDeckStats();
    if (hasUnsavedChanges && stats.mainDeckCount + stats.reserveCount > 0) {
      setPendingDeckAction(() => () => openDeckById(deckId));
      setShowUnsavedChangesModal(true);
      return;
    }
    void openDeckById(deckId);
  }

  // Import deck from text
  async function handleImportDeck(text: string) {
    const result = parseDeckText(text, cards);

    if (result.errors.length > 0) {
      setImportErrors(result.errors);
    } else {
      setImportErrors([]);
    }

    if (!result.deck) return;

    // Filename (from .txt upload) wins over the existing deck name; fall back to parser default
    const importedName = importFilename || deck.name || result.deck.name;
    const importedDeck = {
      ...result.deck,
      name: importedName,
    };

    loadDeck(importedDeck);
    setShowImportModal(false);
    setImportText("");
    setImportFilename(null);

    // Auto-save the imported deck so it persists without an extra click
    if (user) {
      try {
        const saveResult = await saveDeckToCloud(undefined, importedDeck);
        if (saveResult?.success) {
          if (saveResult.deckCheckResult) {
            setDeckCheckResult(saveResult.deckCheckResult);
          }
          setNotification({ message: 'Deck imported and saved!', type: 'success' });
        } else {
          setNotification({ message: 'Imported, but failed to save', type: 'error' });
        }
      } catch {
        setNotification({ message: 'Imported, but failed to save', type: 'error' });
      }
      setTimeout(() => setNotification(null), 3000);
    }
  }

  // Handle new deck with confirmation
  function handleNewDeck(name?: string, folderId?: string | null, skipConfirmation?: boolean) {
    const stats = getDeckStats();
    const hasCards = stats.mainDeckCount + stats.reserveCount > 0;
    
    // If deck has cards and not skipping confirmation, show confirmation modal
    if (hasCards && !skipConfirmation) {
      setPendingNewDeckFolderId(folderId);
      setShowNewDeckModal(true);
      return;
    }
    
    // No cards or skipping confirmation, just create new deck
    clearUnsavedChanges();
    newDeck(name, folderId);
  }
  
  // Save on behalf of a confirmation modal. Resolves to null on success, or the
  // message to show. saveDeckToCloud reports failure as { success: false }
  // rather than throwing, so a try/catch alone would report success.
  async function trySaveForModal(newName?: string): Promise<string | null> {
    try {
      const result = await saveDeckToCloud(newName);
      if (result.success === false) return result.error || 'Failed to save deck';
      if (result.success && result.deckCheckResult) setDeckCheckResult(result.deckCheckResult);
      return null;
    } catch {
      return 'Failed to save deck';
    }
  }

  // Proceed with new deck creation after confirmation
  async function proceedWithNewDeck(shouldSave: boolean, newName?: string) {
    if (shouldSave && user) {
      // Pass a new name straight to save (state would be stale in this closure)
      const rename = newName && newName !== deck.name ? newName : undefined;
      if (rename) setDeckName(rename);
      const error = await trySaveForModal(rename);
      if (error) {
        // Keep the deck so the user can retry — replacing it now would lose it.
        setNotification({ message: error, type: 'error' });
        setTimeout(() => setNotification(null), 3000);
        setShowNewDeckModal(false);
        setPendingNewDeckFolderId(undefined);
        return;
      }
      setNotification({ message: 'Deck saved successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    }
    
    // Create new deck
    newDeck("Untitled Deck", pendingNewDeckFolderId);
    setShowNewDeckModal(false);
    setPendingNewDeckFolderId(undefined);
  }

  function closeUnsavedChangesModal() {
    setShowUnsavedChangesModal(false);
    setPendingDeckAction(null);
  }

  // "Save & continue": a failed save keeps the deck and never falls through to
  // the pending action, which would replace the deck the save failed to keep.
  async function saveThenRunPendingAction() {
    const action = pendingDeckAction;
    const error = await trySaveForModal();
    closeUnsavedChangesModal();
    if (error) {
      setNotification({ message: error, type: 'error' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    setNotification({ message: 'Deck saved successfully!', type: 'success' });
    setTimeout(() => setNotification(null), 3000);
    action?.();
  }

  function discardThenRunPendingAction() {
    const action = pendingDeckAction;
    clearUnsavedChanges();
    closeUnsavedChangesModal();
    action?.();
  }

  // Delete deck
  async function handleDeleteDeck() {
    // Hosts that disable delete (the Forge) never touch the public `decks` table;
    // "delete" just clears the working deck. Forge decks are removed from their list.
    if (config.features?.enableDeckDelete === false) {
      clearDeck();
      clearUnsavedChanges();
      return;
    }

    if (!deck.id) {
      // If deck hasn't been saved yet, just clear it
      clearDeck();
      clearUnsavedChanges();
      return;
    }

    if (!user) {
      setNotification({ message: 'Please sign in to delete decks.', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    // Host-provided delete backend (the Forge removes from forge_decks and then
    // navigates to its own deck list via onDeckDeleted). Falls through to the
    // public deleteDeckAction when no seam is provided.
    const deleteFromHost = config.persistence?.delete;
    if (deleteFromHost) {
      const res = await deleteFromHost(deck.id);
      if (res.success) {
        clearUnsavedChanges();
        clearDeck();
        config.onDeckDeleted?.(deck.id);
      } else {
        setNotification({ message: res.error || 'Failed to delete deck', type: 'error' });
        setTimeout(() => setNotification(null), 3000);
      }
      return;
    }

    const result = await deleteDeckAction(deck.id);
    if (result.success) {
      clearUnsavedChanges();
      clearDeck();
      // Clear the deckId from URL
      router.replace('/decklist/card-search?new=true', { scroll: false });
      setNotification({ message: 'Deck deleted successfully!', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } else {
      setNotification({ message: result.error || 'Failed to delete deck', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    }
  }

  // Replace good/evil half with cards from another deck
  async function handleReplaceHalf(alignment: "good" | "evil", sourceDeckId: string) {
    const result = await replaceHalf(alignment, sourceDeckId);
    if (result.success) {
      setNotification({
        message: `Replaced ${alignment} half: removed ${result.removed}, added ${result.added} from "${result.sourceName}".`,
        type: "success",
      });
    } else {
      setNotification({
        message: result.error || "Failed to replace deck half",
        type: "error",
      });
    }
    setTimeout(() => setNotification(null), 3000);
  }

  return (
    <BuilderConfigProvider config={config}>
      {/* Modal - Rendered outside main container to avoid z-index issues */}
      {modalCard && (
        <ModalWithClose
          modalCard={modalCard}
          setModalCard={setModalCard}
          visibleCards={!showSearch
            ? deck.cards
                .filter(dc => dc.zone === (fullDeckViewSection === 'reserve' ? 'reserve' : 'main'))
                .map(dc => dc.card)
                .sort((a, b) => {
                  // Sort by type first
                  const typeA = a.type || 'Unknown';
                  const typeB = b.type || 'Unknown';
                  if (typeA !== typeB) {
                    return typeA.localeCompare(typeB);
                  }
                  // Then by name
                  return a.name.localeCompare(b.name);
                })
            : sortedFiltered
          }
          onNavigateToIndex={showSearch ? (index) => {
            setVisibleCount((prev) => Math.max(prev, index + 1));
          } : undefined}
          onAddCard={addCard}
          onRemoveCard={removeCard}
          getCardQuantity={getCardQuantity}
          activeDeckTab={activeDeckTab}
          legalityFilter={legalityMode}
          legalityFormat={normalizeFormat(deck.format)}
          allCards={cards}
          collectionQuantities={collectionAvailable ? collectionQuantities : null}
          onAdjustCollection={collectionAvailable ? adjustCollectionQuantity : null}
          collectionSignedOut={!user}
        />
      )}
      
    <div ref={containerRef} className="flex w-full h-[calc(100dvh-4rem-1px)] overflow-hidden bg-background jayden-gradient-bg">
      {/* Left panel: Card search */}
      {showSearch && (
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="bg-background text-foreground transition-colors duration-200 flex-1 flex flex-col overflow-y-auto overflow-x-hidden md:overflow-hidden">
          <div className="p-1.5 md:p-2 flex flex-col items-center md:sticky md:top-0 z-40 bg-background text-foreground border-b border-border shadow-sm">
        <div className="relative w-full px-1 md:px-2 flex flex-col items-center justify-center gap-1.5 md:gap-2">
          <div className="w-full flex flex-col gap-1.5 md:gap-2 text-center">
            <div className="flex flex-col gap-1.5 md:gap-2 w-full">
              {queries.map((queryObj, index) => (
                <div key={index} className="flex items-center gap-1 min-w-0">
                  {/* Field dropdown */}
                  <select
                    value={queryObj.field}
                    onChange={e => updateQueryField(index, e.target.value)}
                    className="border rounded px-1 sm:px-2 h-9 sm:h-11 bg-muted text-foreground border-border shadow-sm focus:ring-2 focus:ring-ring text-center text-xs sm:text-sm min-w-0"
                  >
                    <option value="everything">All</option>
                    <option value="name">Name</option>
                    <option value="type">Type</option>
                    <option value="brigade">Brigade</option>
                    <option value="specialAbility">Special Ability</option>
                    <option value="setName">Set Name</option>
                    <option value="identifier">Identifier</option>
                    <option value="reference">Reference</option>
                  </select>
                  
                  {/* Operator dropdown - shown for all queries */}
                  <select
                    value={queryObj.operator}
                    onChange={e => updateQueryOperator(index, e.target.value as QueryOperator)}
                    className="border rounded px-1 sm:px-2 h-9 sm:h-11 bg-muted text-foreground border-border shadow-sm focus:ring-2 focus:ring-ring text-center text-xs sm:text-sm min-w-0"
                    title={index === 0 ? "Negate this query" : "How to combine this query with previous results"}
                  >
                    {index === 0 ? (
                      <>
                        <option value="AND">—</option>
                        <option value="NOT">NOT</option>
                      </>
                    ) : (
                      <>
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                        <option value="AND NOT">NOT</option>
                      </>
                    )}
                  </select>
                  
                  {/* Search input. The "/" hint appears on the first input when empty/unfocused, telling new
                      users about the global shortcut. Tab cycles between search inputs when there are 2+ queries. */}
                  <div className="relative flex-1 min-w-0">
                    <input
                      ref={el => { inputRefs.current[index] = el; }}
                      type="text"
                      placeholder={index === 0 ? "Search" : `Search ${index + 1}`}
                      className="peer w-full px-2 sm:px-3 h-9 sm:h-11 pr-9 border rounded text-base focus:outline-none focus:ring-2 focus:ring-ring text-foreground bg-card border-border"
                      value={queryObj.text}
                      onChange={(e) => updateQuery(index, e.target.value)}
                      onKeyDown={(e) => {
                        // Backspace on an empty, non-first query removes it and focuses the previous one.
                        // This is the symmetric inverse of "Tab to spawn" — the keyboard-only way to undo a query.
                        if (
                          e.key === 'Backspace' &&
                          !queryObj.text &&
                          queries.length > 1 &&
                          index > 0
                        ) {
                          e.preventDefault();
                          const prevIndex = index - 1;
                          removeQuery(index);
                          setTimeout(() => {
                            const prevEl = inputRefs.current[prevIndex];
                            if (prevEl) {
                              prevEl.focus();
                              // Park the cursor at the end of the previous query so the user can keep editing.
                              const len = prevEl.value.length;
                              prevEl.setSelectionRange(len, len);
                            }
                          }, 0);
                          return;
                        }
                        if (e.key !== 'Tab') return;
                        const isLast = index === queries.length - 1;
                        if (e.shiftKey) {
                          // Shift+Tab — cycle backward through existing queries; never create new ones.
                          if (queries.length > 1) {
                            e.preventDefault();
                            const prev = (index - 1 + queries.length) % queries.length;
                            inputRefs.current[prev]?.focus();
                            inputRefs.current[prev]?.select();
                          }
                          return;
                        }
                        // Tab forward: if not on the last query, jump to the next existing one.
                        if (!isLast) {
                          e.preventDefault();
                          inputRefs.current[index + 1]?.focus();
                          inputRefs.current[index + 1]?.select();
                          return;
                        }
                        // On the last query: if it has text, spawn a new query and focus it.
                        // If it's empty, wrap back to the first query (or do nothing if only one).
                        if (queryObj.text.trim()) {
                          e.preventDefault();
                          const newIndex = queries.length;
                          addNewQuery();
                          // The new input mounts on the next render — wait a tick before focusing.
                          setTimeout(() => {
                            inputRefs.current[newIndex]?.focus();
                          }, 0);
                        } else if (queries.length > 1) {
                          e.preventDefault();
                          inputRefs.current[0]?.focus();
                          inputRefs.current[0]?.select();
                        }
                      }}
                      maxLength={64}
                    />
                    {index === 0 && queryObj.text.length < 30 && (
                      <span
                        aria-hidden="true"
                        className="hidden sm:flex transition-opacity absolute right-2 top-1/2 -translate-y-1/2 items-center gap-1.5 text-xs text-muted-foreground pointer-events-none select-none"
                      >
                        <span>Type</span>
                        <kbd className="px-1 py-px text-[11px] font-mono leading-none text-foreground/80 bg-muted/60 rounded">/</kbd>
                        <span>to reset</span>
                      </span>
                    )}
                  </div>
                  
                  {/* Remove button - only show if more than one query */}
                  {queries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeQuery(index)}
                      className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center text-destructive/70 hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors text-lg font-bold"
                      title="Remove this query"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
            {/* Mobile: original layout */}
            <div className="flex sm:hidden flex-row flex-wrap gap-1.5 w-full justify-center">
            <button
              className="px-2.5 flex-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 border border-border transition font-medium shadow-sm text-center text-xs h-8"
              onClick={handleResetFilters}
            >
              <span className="flex items-center justify-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reset
              </span>
            </button>
            <button
              className="px-3 flex-1 shrink-0 rounded bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition font-medium shadow-sm text-center relative text-xs h-8"
              onClick={addNewQuery}
              title="Add new query"
            >
              +
            </button>
            </div>
            {/* Desktop: centered buttons with filters right-aligned */}
            <div className="hidden sm:flex flex-row flex-wrap gap-2 w-full items-center">
            {/* Result count — fills the left spacer so it stays visible without scrolling */}
            <div className="hidden md:flex flex-1 items-center">
              {visibleCards.length > 0 && (
                <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">
                  {filtered.length} {filtered.length === 1 ? 'card' : 'cards'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mx-auto md:mx-0">
            <button
              className="px-4 shrink-0 rounded bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition font-medium shadow-sm text-center relative h-9 sm:h-11"
              onClick={addNewQuery}
              title="Add new query"
            >
              +
            </button>
            <button
              className="px-4 rounded bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground border border-border transition font-medium shadow-sm text-center text-sm h-9 sm:h-11"
              onClick={handleResetFilters}
            >
              Reset Filters
            </button>
            {/* Copy-search-link shares a /decklist/card-search URL — a sharing
                affordance, so it follows the enableSharing gate. */}
            {config.features?.enableSharing !== false && (
            <button
              className={`px-4 rounded border transition font-medium shadow-sm text-center relative h-9 sm:h-11 ${
                queries.filter(q => q.text.trim()).length > 1
                  ? 'bg-muted text-muted-foreground/50 border-border cursor-not-allowed opacity-50'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground border-border'
              }`}
              onClick={queries.filter(q => q.text.trim()).length > 1 ? undefined : handleCopyLink}
              title={
                queries.filter(q => q.text.trim()).length > 1
                  ? 'Multiple query link sharing sadly not supported'
                  : copyLinkNotification ? 'Link copied!' : 'Copy search link'
              }
              disabled={queries.filter(q => q.text.trim()).length > 1}
            >
              {copyLinkNotification ? '✓' : '🔗'}
            </button>
            )}
            <button
              className="px-4 rounded bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground border border-border transition font-medium shadow-sm text-center h-9 sm:h-11"
              onClick={() => router.push('/decklist/card-search/random')}
              title="Random card"
              aria-label="Show a random card"
            >
              🎲
            </button>
            </div>
            {/* Sort + Filter collapse — desktop only, right-aligned via flex */}
            <div className="hidden md:flex flex-1 justify-end items-center gap-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor="card-sort" className="text-sm text-muted-foreground font-medium">Sort:</label>
              <select
                id="card-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="px-2 py-1.5 border rounded text-sm font-semibold bg-muted text-foreground border-border focus:outline-none h-9 sm:h-11"
              >
                <option value="default">Default</option>
                <option value="name">Name</option>
                <option value="set">Set</option>
                <option value="strength">Strength</option>
                <option value="toughness">Toughness</option>
                <option value="type">Type</option>
                <option value="brigade">Brigade</option>
                <option value="price-asc">Price (Low to High)</option>
                <option value="price-desc">Price (High to Low)</option>
              </select>
            </div>
            <button
              className={`flex px-3 shrink-0 rounded items-center justify-center gap-1.5 border transition font-medium shadow-sm text-sm h-9 sm:h-11 ${
                sortedFiltered.length === 0
                  ? 'bg-muted text-muted-foreground/50 border-border cursor-not-allowed opacity-50'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground border-border'
              }`}
              onClick={sortedFiltered.length === 0 ? undefined : handleExportCSV}
              disabled={sortedFiltered.length === 0}
              title={sortedFiltered.length === 0 ? 'No cards to export' : `Export ${sortedFiltered.length} cards as CSV`}
              aria-label="Export CSV"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
              </svg>
              CSV
            </button>
            <button
              aria-label="Toggle filter grid"
              aria-expanded={!filterGridCollapsed}
              className={`flex px-3 shrink-0 rounded items-center justify-center gap-1.5 border transition font-medium shadow-sm text-sm h-9 sm:h-11 ${
                !filterGridCollapsed
                  ? 'bg-primary/15 text-primary border-primary/40'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 border-border'
              }`}
              onClick={() => setFilterGridCollapsed(v => !v)}
              title={filterGridCollapsed ? 'Show filters' : 'Hide filters'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
              </svg>
              Filters
              <svg
                className={`w-3.5 h-3.5 transition-transform duration-200 ${filterGridCollapsed ? '' : 'rotate-180'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            </div>{/* end Sort + Filter collapse wrapper */}
            </div>
          </div>
        </div>
      </div>
      {/* Active Filters Summary Bar — always visible on desktop to prevent layout jump, hidden on mobile when empty */}
      <div className={`w-full transition-all duration-300 md:sticky md:top-[64px] z-30 bg-background text-foreground border-b border-border ${hasActiveFilters ? 'flex' : 'hidden md:flex'} items-center`}>
        {/* Scrollable pills area */}
        <div className="flex-1 overflow-x-auto flex flex-nowrap sm:flex-wrap gap-1 sm:gap-1.5 items-center sm:justify-center px-2 sm:px-4 py-1 sm:overflow-visible min-h-[28px]">
        {/* Query Pills */}
        {queries.map((queryObj, originalIndex) => {
          if (!queryObj.text.trim()) return null;
          
          // For first query, show its own operator if it's NOT
          // For subsequent queries, show the query's own operator (how it combines with previous)
          let operatorPrefix = '';
          if (originalIndex === 0 && queryObj.operator === 'NOT') {
            operatorPrefix = 'NOT ';
          } else if (originalIndex > 0) {
            const currentOperator = queryObj.operator;
            if (currentOperator === 'AND NOT' || currentOperator === 'NOT') {
              operatorPrefix = 'AND NOT ';
            } else {
              operatorPrefix = `${currentOperator} `;
            }
          }
          
          return (
            <span
              key={`${originalIndex}-${queryObj.field}-${queryObj.text}`}
              className={`${PILL_BASE} ${PILL_STYLES.query}`}
              onClick={() => updateQuery(originalIndex, "")}
              tabIndex={0}
              role="button"
              aria-label={`Remove Search filter ${originalIndex + 1}`}
            >
              {operatorPrefix && <span className="font-bold mr-1">{operatorPrefix}</span>}
              {queryObj.field === 'everything' && `"${queryObj.text}"`}
              {queryObj.field === 'name' && `Name: "${queryObj.text}"`}
              {queryObj.field === 'type' && `Type: "${queryObj.text}"`}
              {queryObj.field === 'brigade' && `Brigade: "${queryObj.text}"`}
              {queryObj.field === 'specialAbility' && `Ability: "${queryObj.text}"`}
              {queryObj.field === 'setName' && `Set: "${queryObj.text}"`}
              {queryObj.field === 'identifier' && `ID: "${queryObj.text}"`}
              {queryObj.field === 'reference' && `Ref: "${queryObj.text}"`}
              <span className="ml-1">×</span>
            </span>
          );
        })}
        {/* Legality */}
        {legalityMode !== 'Limited' && (
          <span className={`${PILL_BASE} ${PILL_STYLES.legality}`} onClick={() => setLegalityMode('Limited')} tabIndex={0} role="button" aria-label="Remove Legality filter">
            {legalityMode}
            <span className="ml-1">×</span>
          </span>
        )}
        {/* Collection */}
        {activeOwnedMode !== 'off' && (
          <span
            className={`${PILL_BASE} ${activeOwnedMode === 'owned' ? PILL_STYLES.collection : PILL_STYLES.collectionMissing}`}
            onClick={() => setOwnedMode('off')}
            tabIndex={0}
            role="button"
            aria-label={`Remove ${OWNED_MODE_LABELS[activeOwnedMode]} filter`}
          >
            {OWNED_MODE_LABELS[activeOwnedMode]}
            <span className="ml-1">×</span>
          </span>
        )}
        {/* Alignment — Good/Evil/Neutral tinted to match the alignment they represent. */}
        {selectedAlignmentFilters.map(mode => (
          <span
            key={mode}
            className={alignmentPillClass(mode)}
            onClick={() => setSelectedAlignmentFilters(selectedAlignmentFilters.filter(m => m !== mode))}
            tabIndex={0}
            role="button"
            aria-label={`Remove ${mode} alignment filter`}
          >
            {mode}
            <span className="ml-1">×</span>
          </span>
        ))}
        {/* Rarity */}
        {selectedRarityFilters.map(rarity => (
          <span
            key={rarity}
            className={`${PILL_BASE} ${PILL_STYLES.rarity}`}
            onClick={() => setSelectedRarityFilters(selectedRarityFilters.filter(r => r !== rarity))}
            tabIndex={0}
            role="button"
            aria-label={`Remove ${rarity} rarity filter`}
          >
            {rarity}
            <span className="ml-1">×</span>
          </span>
        ))}
        {/* Icon Filters — brigades use brigade-color tints; types use a neutral cyan. */}
        {selectedIconFilters.map((filter, idx) => {
          const pillClass = iconPillClass(filter.icon);
          return (
            <React.Fragment key={filter.icon}>
              <span className={pillClass} onClick={() => setSelectedIconFilters(selectedIconFilters.filter(f => f.icon !== filter.icon))} tabIndex={0} role="button" aria-label={`Remove ${filter.icon} filter`}>
                {filter.icon}
                <span className="ml-1">×</span>
              </span>
              {idx < selectedIconFilters.length - 1 && (
                <span 
                  className="animate-pill-enter mx-1 font-bold text-xs text-muted-foreground cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-2 py-1 rounded hover:bg-muted"
                  onClick={(e) => {
                    e.preventDefault();
                    // Left-click: cycle through AND → OR → AND NOT → AND
                    const currentOp = filter.operator;
                    if (currentOp === 'AND') {
                      updateIconFilterOperator(filter.icon, 'OR');
                    } else if (currentOp === 'OR') {
                      updateIconFilterOperator(filter.icon, 'AND NOT');
                    } else if (currentOp === 'AND NOT') {
                      updateIconFilterOperator(filter.icon, 'AND');
                    }
                  }}
                  title="Click to cycle: AND → OR → AND NOT"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      // Same as left-click
                      const currentOp = filter.operator;
                      if (currentOp === 'AND') {
                        updateIconFilterOperator(filter.icon, 'OR');
                      } else if (currentOp === 'OR') {
                        updateIconFilterOperator(filter.icon, 'AND NOT');
                      } else if (currentOp === 'AND NOT') {
                        updateIconFilterOperator(filter.icon, 'AND');
                      }
                    }
                  }}
                >
                  {filter.operator}
                </span>
              )}
            </React.Fragment>
          );
        })}
        {/* Testament */}
        {selectedTestaments.map(t => (
          <span key={t} className={`${PILL_BASE} ${PILL_STYLES.testament}`} onClick={() => { setSelectedTestaments(selectedTestaments.filter(x => x !== t)); setTestamentNots(prev => { const newNots = { ...prev }; delete newNots[t]; return newNots; }); }} tabIndex={0} role="button" aria-label={`Remove ${t} testament filter`}>
            {testamentNots[t] ? 'NOT ' : ''}{t}
            <span className="ml-1">×</span>
          </span>
        ))}
        {/* Gospel */}
        {isGospel && (
          <span className={`${PILL_BASE} ${PILL_STYLES.gospel}`} onClick={() => { setIsGospel(false); setGospelNot(false); }} tabIndex={0} role="button" aria-label="Remove Gospel filter">
            {gospelNot ? 'NOT ' : ''}Gospel
            <span className="ml-1">×</span>
          </span>
        )}
        {/* Strength */}
        {strengthFilter !== null && (
          <span className={`${PILL_BASE} ${PILL_STYLES.stat}`} onClick={() => setStrengthFilter(null)} tabIndex={0} role="button" aria-label="Remove Strength filter">
            Strength {strengthOp === 'eq' ? '=' : strengthOp === 'lt' ? '<' : strengthOp === 'lte' ? '≤' : strengthOp === 'gt' ? '>' : '≥'} {strengthFilter}
            <span className="ml-1">×</span>
          </span>
        )}
        {/* Toughness */}
        {toughnessFilter !== null && (
          <span className={`${PILL_BASE} ${PILL_STYLES.stat}`} onClick={() => setToughnessFilter(null)} tabIndex={0} role="button" aria-label="Remove Toughness filter">
            Toughness {toughnessOp === 'eq' ? '=' : toughnessOp === 'lt' ? '<' : toughnessOp === 'lte' ? '≤' : toughnessOp === 'gt' ? '>' : '≥'} {toughnessFilter}
            <span className="ml-1">×</span>
          </span>
        )}
        {/* Misc booleans */}
        {altArtMode !== 'hide' && (
          <span className={`${PILL_BASE} ${PILL_STYLES.misc}`} onClick={() => setAltArtMode('hide')} tabIndex={0} role="button" aria-label="Remove AB Versions filter">
            {altArtMode === 'prefer' ? 'Prefer AB' : 'Show AB'}
            <span className="ml-1">×</span>
          </span>
        )}
        {noFirstPrint === false && (
          <span className={`${PILL_BASE} ${PILL_STYLES.misc}`} onClick={() => setnoFirstPrint(true)} tabIndex={0} role="button" aria-label="Remove 1st Print K/L Starters filter">
            1st Print K/L Starters
            <span className="ml-1">×</span>
          </span>
        )}
        {nativityOnly && (
          <span className={`${PILL_BASE} ${PILL_STYLES.misc}`} onClick={() => { setNativityOnly(false); setNativityNot(false); }} tabIndex={0} role="button" aria-label="Remove Nativity filter">
            {nativityNot ? 'NOT ' : ''}Nativity
            <span className="ml-1">×</span>
          </span>
        )}
        {hasStarOnly && (
          <span className={`${PILL_BASE} ${PILL_STYLES.misc}`} onClick={() => { setHasStarOnly(false); setHasStarNot(false); }} tabIndex={0} role="button" aria-label="Remove Has Star filter">
            {hasStarNot ? 'NOT ' : ''}Has Star
            <span className="ml-1">×</span>
          </span>
        )}
        {cloudOnly && (
          <span className={`${PILL_BASE} ${PILL_STYLES.misc}`} onClick={() => { setCloudOnly(false); setCloudNot(false); }} tabIndex={0} role="button" aria-label="Remove Cloud filter">
            {cloudNot ? 'NOT ' : ''}Cloud
            <span className="ml-1">×</span>
          </span>
        )}
        {angelOnly && (
          <span className={`${PILL_BASE} ${PILL_STYLES.misc}`} onClick={() => { setAngelOnly(false); setAngelNot(false); }} tabIndex={0} role="button" aria-label="Remove Angel filter">
            {angelNot ? 'NOT ' : ''}Angel
            <span className="ml-1">×</span>
          </span>
        )}
        {demonOnly && (
          <span className={`${PILL_BASE} ${PILL_STYLES.misc}`} onClick={() => { setDemonOnly(false); setDemonNot(false); }} tabIndex={0} role="button" aria-label="Remove Demon filter">
            {demonNot ? 'NOT ' : ''}Demon
            <span className="ml-1">×</span>
          </span>
        )}
        {danielOnly && (
          <span className={`${PILL_BASE} ${PILL_STYLES.misc}`} onClick={() => { setDanielOnly(false); setDanielNot(false); }} tabIndex={0} role="button" aria-label="Remove Daniel filter">
            {danielNot ? 'NOT ' : ''}Daniel
            <span className="ml-1">×</span>
          </span>
        )}
        {postexilicOnly && (
          <span className={`${PILL_BASE} ${PILL_STYLES.misc}`} onClick={() => { setPostexilicOnly(false); setPostexilicNot(false); }} tabIndex={0} role="button" aria-label="Remove Postexilic filter">
            {postexilicNot ? 'NOT ' : ''}Postexilic
            <span className="ml-1">×</span>
          </span>
        )}
        </div>
        {/* Result count — mobile only; desktop shows it in the search header toolbar */}
        {visibleCards.length > 0 && (
          <span className="md:hidden shrink-0 pl-2 pr-3 text-xs font-medium text-muted-foreground whitespace-nowrap">
            {filtered.length} {filtered.length === 1 ? 'card' : 'cards'}
          </span>
        )}
      </div>
      {/* Collapse/Expand Filter Grid Button — mobile only (on desktop it's in the search header) */}
      <div className={`flex-shrink-0 ${!filterGridCollapsed ? 'sticky top-0 z-30' : ''} flex md:hidden flex-row flex-wrap items-center justify-between gap-y-1.5 px-3 py-1.5 bg-background border-b border-border`}>
        <div className="flex items-center gap-1.5">
          <label htmlFor="card-sort-mobile" className="text-xs text-muted-foreground font-medium">Sort:</label>
          <select
            id="card-sort-mobile"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-2 py-1 border rounded text-xs font-semibold bg-muted text-foreground border-border focus:outline-none"
          >
            <option value="default">Default</option>
            <option value="name">Name</option>
            <option value="set">Set</option>
            <option value="strength">Strength</option>
            <option value="toughness">Toughness</option>
            <option value="type">Type</option>
            <option value="brigade">Brigade</option>
            <option value="price-asc">Price (Low to High)</option>
            <option value="price-desc">Price (High to Low)</option>
          </select>
        </div>
        <div className="flex items-center gap-1.5">
        <button
          className={`flex items-center gap-1 px-3 py-1.5 rounded-full border text-xs font-semibold transition ${
            sortedFiltered.length === 0
              ? 'bg-muted text-muted-foreground/50 border-border cursor-not-allowed opacity-50'
              : 'bg-muted text-muted-foreground border-border'
          }`}
          onClick={sortedFiltered.length === 0 ? undefined : handleExportCSV}
          disabled={sortedFiltered.length === 0}
          aria-label="Export CSV"
          title={sortedFiltered.length === 0 ? 'No cards to export' : `Export ${sortedFiltered.length} cards as CSV`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
          </svg>
          CSV
        </button>
        <button
          aria-label="Toggle filter grid"
          aria-expanded={!filterGridCollapsed}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full border text-xs font-semibold transition ${
            !filterGridCollapsed
              ? 'bg-primary/15 text-primary border-primary/40'
              : 'bg-muted text-muted-foreground border-border'
          }`}
          onClick={() => setFilterGridCollapsed(v => !v)}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M6 12h12M10 20h4" />
          </svg>
          Filters
          <svg
            className={`w-3 h-3 transition-transform duration-200 ${filterGridCollapsed ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        </div>
      </div>
      <main className="p-2 pb-16 md:pb-2 md:overflow-auto md:flex-1 bg-background text-foreground transition-colors duration-200" style={{ scrollbarGutter: 'stable' }}>
        {/* Responsive grid for filters. We hide via CSS instead of conditionally unmounting because
            the FilterGrid has ~50 buttons and ~35 images — mount/unmount on every toggle was
            stalling the main thread on mobile and producing a perceptible collapse lag. */}
        <div className={filterGridCollapsed ? 'hidden' : ''}>
          <FilterGrid
            legalityMode={legalityMode}
            setLegalityMode={setLegalityMode}
            selectedAlignmentFilters={selectedAlignmentFilters}
            toggleAlignmentFilter={toggleAlignmentFilter}
            selectedRarityFilters={selectedRarityFilters}
            toggleRarityFilter={toggleRarityFilter}
            showOwnedFilter={collectionFilterAvailable}
            ownedMode={ownedMode}
            onCycleOwnedMode={() => setOwnedMode(cycleOwnedMode)}
            advancedOpen={advancedOpen}
            setAdvancedOpen={setAdvancedOpen}
            selectedTestaments={selectedTestaments}
            setSelectedTestaments={setSelectedTestaments}
            testamentNots={testamentNots}
            setTestamentNots={setTestamentNots}
            isGospel={isGospel}
            setIsGospel={setIsGospel}
            gospelNot={gospelNot}
            setGospelNot={setGospelNot}
            strengthFilter={strengthFilter}
            setStrengthFilter={setStrengthFilter}
            strengthOp={strengthOp}
            setStrengthOp={setStrengthOp}
            toughnessFilter={toughnessFilter}
            setToughnessFilter={setToughnessFilter}
            toughnessOp={toughnessOp}
            setToughnessOp={setToughnessOp}
            altArtMode={altArtMode}
            setAltArtMode={setAltArtMode}
            noFirstPrint={noFirstPrint}
            setnoFirstPrint={setnoFirstPrint}
            nativityOnly={nativityOnly}
            setNativityOnly={setNativityOnly}
            nativityNot={nativityNot}
            setNativityNot={setNativityNot}
            hasStarOnly={hasStarOnly}
            setHasStarOnly={setHasStarOnly}
            hasStarNot={hasStarNot}
            setHasStarNot={setHasStarNot}
            cloudOnly={cloudOnly}
            setCloudOnly={setCloudOnly}
            cloudNot={cloudNot}
            setCloudNot={setCloudNot}
            angelOnly={angelOnly}
            setAngelOnly={setAngelOnly}
            angelNot={angelNot}
            setAngelNot={setAngelNot}
            demonOnly={demonOnly}
            setDemonOnly={setDemonOnly}
            demonNot={demonNot}
            setDemonNot={setDemonNot}
            danielOnly={danielOnly}
            setDanielOnly={setDanielOnly}
            danielNot={danielNot}
            setDanielNot={setDanielNot}
            postexilicOnly={postexilicOnly}
            setPostexilicOnly={setPostexilicOnly}
            postexilicNot={postexilicNot}
            setPostexilicNot={setPostexilicNot}
            selectedIconFilters={selectedIconFilters}
            toggleIconFilter={toggleIconFilter}
            updateIconFilterOperator={updateIconFilterOperator}
            updateAllIconFilterOperators={updateAllIconFilterOperators}
            iconFilterMode={iconFilterMode}
            setIconFilterMode={setIconFilterMode}
          />
        </div>
        {/* Card grid */}
        {visibleCards.length > 0 ? (
          <>
          {/* Sort + count bar */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-4 mt-2 sm:mt-4">
            {visibleCards.map((c, cardIndex) => {
              const quantityInDeck = getCardQuantity(c.name, c.set, 'main');
              const quantityInReserve = getCardQuantity(c.name, c.set, 'reserve');
              const quantityInMaybeboard = getCardQuantity(c.name, c.set, 'maybeboard');
              const quantityInCollection = collectionAvailable
                ? collectionQuantities.get(c.dataLine) || 0
                : 0;
              const isMenuOpen = openSearchMenuCard === c.dataLine;
              return (
                <div
                  key={c.dataLine}
                  {...searchHoverPreview.hoverProps(c)}
                  draggable={!isSpotlight && !isMobile}
                  onDragStart={(e) => {
                    if (isSpotlight || isMobile) return;
                    // The tile keeps mouse-over while dragging, so the preview
                    // would otherwise hang next to the cursor for the whole drag.
                    searchHoverPreview.clear();
                    // Native HTML5 drag — picked up by `useExternalDropTarget`
                    // on the deck-panel zones. No @dnd-kit dependency, so this
                    // works across the search↔deck context boundary without
                    // lifting DndContext. Click-to-add via the inner buttons
                    // is unaffected (HTML5 drag only fires after press+move).
                    e.dataTransfer.setData(
                      "application/x-redemption-card",
                      JSON.stringify({ name: c.name, set: c.set }),
                    );
                    e.dataTransfer.effectAllowed = "copy";
                    // Intentionally NOT calling setDragImage — every browser
                    // (Chrome, Firefox, Safari) shows the source element as
                    // its default drag ghost, which is exactly the card tile
                    // the user grabbed. Custom off-screen ghosts via
                    // setDragImage have flaky behavior in Firefox (async
                    // snapshot timing, image-decode races, hidden-element
                    // rules). The default ghost is universally reliable and
                    // visually accurate — it shows precisely what's being
                    // dragged.
                  }}
                  className={`relative group rounded overflow-hidden transition-all duration-200 ${
                    isSpotlight
                      ? "cursor-pointer"
                      : "cursor-grab active:cursor-grabbing"
                  } ${
                    isSpotlight && spotlightCard?.dataLine === c.dataLine
                      ? "ring-2 ring-amber-500 dark:ring-amber-400"
                      : ""
                  }`}
                >
                  {/* Backdrop overlay when menu is open */}
                  {!isSpotlight && isMenuOpen && (
                    <div
                      className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30 rounded"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenSearchMenuCard(null);
                      }}
                    />
                  )}

                  {/* Menu items overlay.
                      Layout: 2×2 square when the card is already in main/reserve
                      (four actions: add-main, add-reserve, remove, bookmark);
                      triangle (top: add-main, add-reserve; bottom-center:
                      bookmark) when neither main nor reserve has it yet. The
                      remove button decrements from whichever zone has copies. */}
                  {!isSpotlight && isMenuOpen && (() => {
                    const hasInDeck = quantityInDeck > 0 || quantityInReserve > 0;
                    const addMain = (
                      <button
                        key="add-main"
                        onClick={(e) => {
                          e.stopPropagation();
                          addCard(c, 'main');
                          setOpenSearchMenuCard(null);
                        }}
                        className="w-10 h-10 hover:scale-110 bg-card rounded-lg shadow-xl border border-border flex items-center justify-center text-muted-foreground transition-all"
                        title="Add to deck"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    );
                    const addReserve = (
                      <button
                        key="add-reserve"
                        onClick={(e) => {
                          e.stopPropagation();
                          addCard(c, 'reserve');
                          setOpenSearchMenuCard(null);
                        }}
                        className="w-10 h-10 hover:scale-110 bg-card rounded-lg shadow-xl border border-border flex items-center justify-center text-muted-foreground transition-all"
                        title="Add to reserve"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      </button>
                    );
                    const addMaybeboard = (
                      <button
                        key="add-maybeboard"
                        onClick={(e) => {
                          e.stopPropagation();
                          addCard(c, 'maybeboard');
                          setOpenSearchMenuCard(null);
                        }}
                        className="w-10 h-10 hover:scale-110 bg-card rounded-lg shadow-xl border border-border flex items-center justify-center text-violet-600 dark:text-violet-400 transition-all"
                        title="Add to maybeboard"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                        </svg>
                      </button>
                    );
                    const removeFromBoth = (
                      <button
                        key="remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (quantityInDeck > 0) removeCard(c.name, c.set, 'main');
                          if (quantityInReserve > 0) removeCard(c.name, c.set, 'reserve');
                          setOpenSearchMenuCard(null);
                        }}
                        className="w-10 h-10 hover:scale-110 bg-card rounded-lg shadow-xl border border-border flex items-center justify-center text-red-600 dark:text-red-400 transition-all"
                        title="Remove from deck"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4" />
                        </svg>
                      </button>
                    );

                    return hasInDeck ? (
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid grid-cols-2 gap-1.5 z-40">
                        {addMain}
                        {addReserve}
                        {removeFromBoth}
                        {addMaybeboard}
                      </div>
                    ) : (
                      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid grid-cols-2 gap-1.5 z-40">
                        {addMain}
                        {addReserve}
                        <div className="col-span-2 flex justify-center">{addMaybeboard}</div>
                      </div>
                    );
                  })()}

                  {/* Card Image - Click to view modal (or spotlight in spotlight mode) */}
                  <div
                    className="relative overflow-hidden rounded"
                    onClick={() => isSpotlight ? setSpotlightCard(c) : setModalCard(c)}
                  >
                    {config.renderThumb(c, {
                      alt: c.name,
                      className: "rounded w-full",
                      sizes: "(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw",
                    })}

                    {/* Controls Overlay - Centered on Card */}
                    <div className="absolute inset-0 flex items-center justify-center transition-opacity duration-200">
                      {isSpotlight ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSpotlightCard(c);
                          }}
                          className="flex w-11 h-11 md:w-9 md:h-9 items-center justify-center rounded-lg bg-black/50 md:bg-black/30 md:hover:bg-black/50 backdrop-blur-md text-white transition-all border border-white/20 md:opacity-0 md:group-hover:opacity-100 md:pointer-events-none md:group-hover:pointer-events-auto"
                          aria-label="Spotlight this card"
                          title="Spotlight this card"
                        >
                          <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </button>
                      ) : (
                        <div className="flex items-center gap-3 md:gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeCard(c.name, c.set, activeDeckTab === "reserve" ? 'reserve' : activeDeckTab === "maybe" ? 'maybeboard' : 'main');
                            }}
                            className="flex w-11 h-11 md:w-9 md:h-9 items-center justify-center rounded-lg bg-black/50 md:bg-black/30 md:hover:bg-black/50 backdrop-blur-md text-white transition-all font-bold text-2xl md:text-xl border border-white/20 md:opacity-0 md:group-hover:opacity-100 md:pointer-events-none md:group-hover:pointer-events-auto"
                            aria-label="Remove card"
                            title="Remove card from deck"
                          >
                            −
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              addCard(c, activeDeckTab === "reserve" ? 'reserve' : activeDeckTab === "maybe" ? 'maybeboard' : 'main');
                            }}
                            className="flex w-11 h-11 md:w-9 md:h-9 items-center justify-center rounded-lg bg-black/50 md:bg-black/30 md:hover:bg-black/50 backdrop-blur-md text-white transition-all font-bold text-2xl md:text-xl border border-white/20 md:opacity-0 md:group-hover:opacity-100 md:pointer-events-none md:group-hover:pointer-events-auto"
                            aria-label="Add card"
                            title="Add card to deck"
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Menu Button - Bottom Left */}
                    {!isSpotlight && (
                    <div className="absolute bottom-0.5 left-0.5 z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenSearchMenuCard(isMenuOpen ? null : c.dataLine);
                        }}
                        className="w-9 h-9 md:w-7 md:h-7 flex items-center justify-center rounded-lg md:rounded-md bg-black/50 md:bg-black/30 hover:bg-black/50 backdrop-blur-md text-white transition-all border border-white/20 md:opacity-0 md:group-hover:opacity-100 md:pointer-events-none md:group-hover:pointer-events-auto"
                        aria-label="Card options"
                      >
                        <svg className="w-5 h-5 md:w-4 md:h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M6 10a2 2 0 11-4 0 2 2 0 014 0zM12 10a2 2 0 11-4 0 2 2 0 014 0zM16 12a2 2 0 100-4 2 2 0 000 4z" />
                        </svg>
                      </button>
                    </div>
                    )}


                    {/* Quantity Badge - Bottom Right, Always Visible. Color-coded so a glance tells you where the card already lives:
                        emerald = in main deck, amber = in reserve, violet = on the maybeboard, neutral C = in your collection. */}
                    {!isSpotlight && (quantityInDeck > 0 || quantityInReserve > 0 || quantityInMaybeboard > 0 || quantityInCollection > 0) && (
                      <div className="absolute bottom-1 right-1 flex flex-col items-end gap-0.5">
                        {quantityInDeck > 0 && (
                          <div key={`m${quantityInDeck}`} title={`${quantityInDeck} in main deck`} className="animate-qty-pop bg-emerald-500/90 backdrop-blur-sm text-white px-1.5 py-0.5 rounded font-bold text-xs shadow-lg ring-1 ring-black/20">
                            ×{quantityInDeck}
                          </div>
                        )}
                        {quantityInReserve > 0 && (
                          <div key={`r${quantityInReserve}`} title={`${quantityInReserve} in reserve`} className="animate-qty-pop bg-amber-500/90 backdrop-blur-sm text-white px-1.5 py-0.5 rounded font-bold text-xs shadow-lg ring-1 ring-black/20">
                            ×{quantityInReserve} R
                          </div>
                        )}
                        {quantityInMaybeboard > 0 && (
                          <div key={`mb${quantityInMaybeboard}`} title={`${quantityInMaybeboard} on maybeboard`} className="animate-qty-pop bg-violet-500/90 backdrop-blur-sm text-white px-1.5 py-0.5 rounded font-bold text-xs shadow-lg ring-1 ring-black/20">
                            ×{quantityInMaybeboard} M
                          </div>
                        )}
                        {quantityInCollection > 0 && (
                          <div key={`c${quantityInCollection}`} title={`${quantityInCollection} in your collection`} className="animate-qty-pop bg-zinc-800/80 backdrop-blur-sm text-zinc-100 px-1.5 py-0.5 rounded font-bold text-xs shadow-lg ring-1 ring-white/20">
                            ×{quantityInCollection} C
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="text-xs sm:text-sm mt-1 text-center truncate hidden sm:block">{c.name}</p>
                  {(() => {
                    const priceKey = `${c.name}|${c.set}|${c.imgFile}`;
                    const priceInfo = getPrice(priceKey);
                    return priceInfo ? (
                      <p className="text-xs sm:text-xs text-center text-muted-foreground font-medium">${priceInfo.price.toFixed(2)}</p>
                    ) : null;
                  })()}
                </div>
              );
            })}
          </div>
          {/* Card preview on hover — follows the deck panel's toggle */}
          {searchHoverPreview.overlay}
          <div className="py-3 text-center text-xs sm:text-sm text-muted-foreground">
            Showing {Math.min(visibleCount, filtered.length)} of {filtered.length}
          </div>
          {visibleCount < filtered.length && (
            <div ref={sentinelRef} className="h-8 flex items-center justify-center mt-2">
              <div className="text-sm text-muted-foreground">Loading more...</div>
            </div>
          )}
          </>
        ) : activeOwnedMode !== 'off' ? (
          <div className="flex items-center justify-center mt-16 mb-16">
            <div className="text-center">
              {!collectionAvailable ? (
                <p className="text-xl text-muted-foreground">Loading your collection…</p>
              ) : activeOwnedMode === 'owned' && ownedNames.size === 0 ? (
                <>
                  <p className="text-xl text-muted-foreground mb-2">Your collection is empty</p>
                  <p className="text-sm text-muted-foreground">
                    <a href="/collection" className="underline hover:text-foreground">Add cards to your collection</a>{" "}
                    to build a deck from it.
                  </p>
                </>
              ) : activeOwnedMode === 'owned' ? (
                <>
                  <p className="text-xl text-muted-foreground mb-2">No cards you own match these filters</p>
                  <p className="text-sm text-muted-foreground">Widen the filters, or turn off &ldquo;Cards I own&rdquo;.</p>
                </>
              ) : (
                <>
                  <p className="text-xl text-muted-foreground mb-2">You own every card matching these filters</p>
                  <p className="text-sm text-muted-foreground">Nothing left to hunt down here — widen the filters to find more.</p>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center mt-16 mb-16">
            <div className="text-center">
              <p className="text-xl text-muted-foreground mb-2">Ready to filter cards</p>
              <p className="text-sm text-muted-foreground">Use the search or filters above to find cards</p>
            </div>
          </div>
        )}
      </main>
        </div>
        </div>
      )}

      {/* Central Divider with Toggle Buttons */}
      {showSearch && showDeckBuilder && (
        <div
          className="hidden md:flex relative bg-gradient-to-b from-transparent via-border to-transparent hover:via-primary/50 items-center justify-center cursor-ew-resize select-none transition-colors flex-shrink-0 [.jayden_&]:via-primary/30 [.jayden_&]:hover:via-primary/60"
          style={{ width: '6px' }}
          onMouseDown={handleResizeStart}
          title="Drag to resize panels"
        >
          {/* Toggle buttons container - centered vertically */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-3 z-10">
            {/* Hide Search Button */}
            <button
              onClick={() => setShowSearch(false)}
              className="group relative w-7 h-7 bg-card border border-border rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 hover:border-primary flex items-center justify-center"
              title="Hide search panel"
            >
              <svg className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 19l-7-7 7-7" />
              </svg>
              {/* Tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-lg">
                Hide Search (right arrow key)
              </span>
            </button>
            
            {/* Hide Deck Button */}
            <button
              onClick={() => setShowDeckBuilder(false)}
              className="group relative w-7 h-7 bg-card border border-border rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 hover:border-primary flex items-center justify-center"
              title="Hide deck builder"
            >
              <svg className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 5l7 7-7 7" />
              </svg>
              {/* Tooltip */}
              <span className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-lg">
                Hide Deck (left arrow key)
              </span>
            </button>
          </div>
        </div>
      )}
      
      {/* Floating restore buttons (when panels are hidden) */}
      {!showSearch && (
        <button
          onClick={() => setShowSearch(true)}
          className="hidden md:flex fixed left-0 top-1/2 -translate-y-1/2 z-50 flex-col items-center gap-2 px-2 py-4 bg-primary rounded-r-xl shadow-2xl hover:shadow-primary/50 transition-all hover:pl-3 text-primary-foreground font-medium group border-r-4 border-primary/60"
          title="Show search panel"
        >
          <svg className="w-4 h-4 group-hover:scale-105 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="text-xs font-semibold whitespace-nowrap [writing-mode:vertical-lr] rotate-180 tracking-wider">SEARCH</span>
        </button>
      )}
      
      {!showDeckBuilder && (
        <button
          onClick={() => setShowDeckBuilder(true)}
          className="hidden md:flex fixed right-0 top-1/2 -translate-y-1/2 z-50 flex-col items-center gap-3 px-4 py-8 bg-accent rounded-l-2xl shadow-2xl hover:shadow-accent/50 transition-all hover:pr-6 text-accent-foreground font-medium group border-l-4 border-accent/60"
          title="Show deck builder"
        >
          <svg className="w-6 h-6 group-hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-xs font-semibold whitespace-nowrap [writing-mode:vertical-lr] rotate-180 tracking-wider">DECK</span>
        </button>
      )}
      
      {/* Right panel: Deck builder (hidden on mobile, toggleable on desktop) */}
      {showDeckBuilder && (
        <div
          className="hidden md:flex flex-col overflow-visible flex-shrink-0 min-h-0"
          style={{ width: showSearch ? `${deckPanelWidth}%` : '100%' }}
        >
          {isSpotlight ? (
            <SpotlightPanel
              card={spotlightCard}
              price={spotlightCard ? (getPrice(`${spotlightCard.name}|${spotlightCard.set}|${spotlightCard.imgFile}`)?.price ?? null) : null}
              onClear={() => setSpotlightCard(null)}
              player1Name={player1Name}
              player2Name={player2Name}
              player1Score={player1Score}
              player2Score={player2Score}
              onPlayer1NameChange={setPlayer1Name}
              onPlayer2NameChange={setPlayer2Name}
              onPlayer1ScoreChange={setPlayer1Score}
              onPlayer2ScoreChange={setPlayer2Score}
              onResetScoreboard={() => {
                setPlayer1Name("Player 1");
                setPlayer2Name("Player 2");
                setPlayer1Score(0);
                setPlayer2Score(0);
                if (typeof window !== 'undefined') {
                  localStorage.removeItem('spotlight-p1-name');
                  localStorage.removeItem('spotlight-p2-name');
                  localStorage.removeItem('spotlight-p1-score');
                  localStorage.removeItem('spotlight-p2-score');
                }
              }}
            />
          ) : isInitializing ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-background">
              <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin" />
              <div className="text-muted-foreground text-sm">Loading deck…</div>
            </div>
          ) : (
          <DeckBuilderPanel
            deck={deck}
            syncStatus={syncStatus}
            hasUnsavedChanges={hasUnsavedChanges}
            isAuthenticated={!!user}
            authChecked={authChecked}
            isExpanded={!showSearch}
            hoverPreviewEnabled={hoverPreviewEnabled}
            onHoverPreviewEnabledChange={setHoverPreviewEnabled}
            deckCheckResult={deckCheckResult}
            isDeckChecking={isDeckChecking}
            allCards={cards}
            collectionQuantities={collectionQuantities}
            collectionAvailable={collectionAvailable}
            collectionSyncError={collectionSyncError}
            onToggleExpand={() => setShowSearch(prev => !prev)}
            onDeckNameChange={setDeckName}
            onDeckFormatChange={handleDeckFormatChange}
            onParagonChange={setDeckParagon}
            onDeckPublicChange={setDeckPublic}
            onDeckVisibilityChange={setDeckVisibility}
            onSaveDeck={saveDeckToCloud}
            onAddCard={(cardName, cardSet, zone) => {
              // Find the card in the cards array
              const card = cards.find(c => c.name === cardName && c.set === cardSet);
              if (card) {
                addCard(card, zone);
              }
            }}
            onRemoveCard={(cardName, cardSet, zone) => {
              removeCard(cardName, cardSet, zone);
            }}
            onExport={handleExportDeck}
            onDownload={handleDownloadDeck}
            onDownloadBySet={handleDownloadDeckBySet}
            onImport={() => setShowImportModal(true)}
            onDelete={handleDeleteDeck}
            canShare={config.features?.enableSharing !== false}
            canDelete={config.features?.enableDeckDelete !== false}
            onDuplicate={() => {
              // Duplicate will be handled internally by DeckBuilderPanel
              // Just need to provide the callback for re-rendering
            }}
            onNewDeck={handleNewDeck}
            onLoadDeck={handleLoadDeckById}
            onReplaceGood={(sourceDeckId) => handleReplaceHalf("good", sourceDeckId)}
            onReplaceEvil={(sourceDeckId) => handleReplaceHalf("evil", sourceDeckId)}
            defaultTab={activeDeckTab}
            onActiveTabChange={setActiveDeckTab}
            onViewCard={(card, fromReserve) => {
              setFullDeckViewSection(fromReserve ? 'reserve' : 'main');
              setModalCard(card);
            }}
            onNotify={(message, type) => {
              setNotification({ message, type });
              setTimeout(() => setNotification(null), 3000);
            }}
            onPreviewCardsChange={setPreviewCards}
            onDescriptionChange={setDeckDescription}
            ignoreLegalityChecks={ignoreLegalityChecks}
            onIgnoreLegalityChecksChange={legalityChecksEnabled ? setIgnoreLegalityChecks : undefined}
            onSpotlightToggle={() => {
              setMode("spotlight");
              setShowDeckBuilder(true);
              setShowSearch(true);
            }}
          />
          )}
        </div>
      )}

      {/* Mobile Reserve Indicator - shows on Search tab when Reserve is active */}
      {!isMobileDeckDrawerOpen && activeDeckTab === "reserve" && (
        <div className="md:hidden fixed bottom-14 inset-x-0 z-50 flex justify-center pointer-events-none pb-[env(safe-area-inset-bottom)]">
          <div className="pointer-events-auto bg-amber-500 dark:bg-amber-600 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-lg flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            +/− adds to Reserve
          </div>
        </div>
      )}

      {/* Mobile Bottom Nav */}
      <MobileBottomNav
        isDeckOpen={isMobileDeckDrawerOpen}
        onToggleDeck={() => {
          setIsMobileDeckDrawerOpen(prev => {
            if (!prev) setModalCard(null); // Close card carousel when opening deck
            return !prev;
          });
        }}
        deckCardCount={getDeckStats().mainDeckCount + getDeckStats().reserveCount}
        onSaveDeck={saveDeckToCloud}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={syncStatus?.isSaving}
        isAuthenticated={!!user}
      />

      {/* Mobile Deck View (replaces search when Deck tab is active) */}
      {isMobileDeckDrawerOpen && (
        <div className="md:hidden fixed inset-x-0 top-[64px] bottom-[3.5rem] z-40 bg-background flex flex-col overflow-hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {isInitializing ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
              <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin" />
              <div className="text-muted-foreground text-sm">Loading deck…</div>
            </div>
          ) : (
            <DeckBuilderPanel
              deck={deck}
              syncStatus={syncStatus}
              hasUnsavedChanges={hasUnsavedChanges}
              isAuthenticated={!!user}
              authChecked={authChecked}
              isExpanded={false}
              forceDisableHoverPreview
              hoverPreviewEnabled={hoverPreviewEnabled}
              onHoverPreviewEnabledChange={setHoverPreviewEnabled}
              deckCheckResult={deckCheckResult}
              isDeckChecking={isDeckChecking}
              allCards={cards}
              collectionQuantities={collectionQuantities}
              collectionAvailable={collectionAvailable}
              collectionSyncError={collectionSyncError}
              onDeckNameChange={setDeckName}
              onDeckFormatChange={handleDeckFormatChange}
              onParagonChange={setDeckParagon}
              onDeckPublicChange={setDeckPublic}
            onDeckVisibilityChange={setDeckVisibility}
              onSaveDeck={saveDeckToCloud}
              onAddCard={(cardName, cardSet, zone) => {
                const card = cards.find(c => c.name === cardName && c.set === cardSet);
                if (card) {
                  addCard(card, zone);
                }
              }}
              onRemoveCard={(cardName, cardSet, zone) => {
                removeCard(cardName, cardSet, zone);
              }}
              onExport={handleExportDeck}
              onDownload={handleDownloadDeck}
              onDownloadBySet={handleDownloadDeckBySet}
              onImport={() => setShowImportModal(true)}
              onDelete={handleDeleteDeck}
              canShare={config.features?.enableSharing !== false}
              canDelete={config.features?.enableDeckDelete !== false}
              onDuplicate={() => {}}
              onNewDeck={handleNewDeck}
              onLoadDeck={handleLoadDeckById}
              onReplaceGood={(sourceDeckId) => handleReplaceHalf("good", sourceDeckId)}
              onReplaceEvil={(sourceDeckId) => handleReplaceHalf("evil", sourceDeckId)}
              defaultTab={activeDeckTab}
              onActiveTabChange={setActiveDeckTab}
              onViewCard={(card, fromReserve) => {
                setFullDeckViewSection(fromReserve ? 'reserve' : 'main');
                modalOpenedFromDeckRef.current = true;
                setModalCard(card);
                setIsMobileDeckDrawerOpen(false);
              }}
              onNotify={(message, type) => {
                setNotification({ message, type });
                setTimeout(() => setNotification(null), 3000);
              }}
              onPreviewCardsChange={setPreviewCards}
              onDescriptionChange={setDeckDescription}
              ignoreLegalityChecks={ignoreLegalityChecks}
              onIgnoreLegalityChecksChange={legalityChecksEnabled ? setIgnoreLegalityChecks : undefined}
            />
          )}
        </div>
      )}

      {/* Import modal */}
      {showImportModal && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            setShowImportModal(false);
            setImportText("");
            setImportErrors([]);
            setImportFilename(null);
          }}
        >
          <div
            className="bg-card rounded-lg shadow-xl max-w-2xl w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-semibold mb-4 text-foreground">
              Import Deck
            </h3>
            <div className="text-sm text-muted-foreground mb-4 space-y-2">
              <p>
                <strong>From Lackey CCG:</strong> Click the "Copy" button in your deck editor, then paste here.
              </p>
              <p>
                <strong>Format:</strong> Each line should be: <code className="px-1 py-0.5 bg-muted rounded text-xs">Quantity[TAB]Card Name</code>
              </p>
              <p className="text-xs">
                Add "Reserve:" on its own line to separate reserve cards.
              </p>
            </div>
            <textarea
              id="import-deck-textarea"
              className="w-full h-64 p-3 border border-border rounded bg-background text-foreground font-mono text-sm"
              placeholder={`1\tSon of God "Manger" (Promo)\n1\tThe Second Coming (CoW AB)\n1\tAngel of the Lord (2017 Promo)\n\nReserve:\n1\tGibeonite Trickery (Roots)\n1\tNot Among You`}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              autoFocus
            />
            {importErrors.length > 0 && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                <p className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">
                  Import Warnings:
                </p>
                <ul className="text-xs text-red-700 dark:text-red-400 list-disc list-inside space-y-1">
                  {importErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-6 flex gap-3 items-center">
              <label
                htmlFor="import-deck-file"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground bg-muted hover:bg-muted/80 rounded cursor-pointer transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                Upload .txt
              </label>
              <input
                id="import-deck-file"
                type="file"
                accept=".txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const text = event.target?.result as string;
                      setImportText(text);
                      setImportFilename(file.name.replace(/\.txt$/i, ""));
                    };
                    reader.readAsText(file);
                  }
                  e.target.value = "";
                }}
              />
              <div className="ml-auto flex gap-3">
              <button
                className="px-4 py-2 text-muted-foreground hover:bg-muted rounded transition-colors"
                onClick={() => {
                  setShowImportModal(false);
                  setImportText("");
                  setImportErrors([]);
                  setImportFilename(null);
                }}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => handleImportDeck(importText)}
                disabled={!importText.trim()}
              >
                Import
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved Changes Modal — before loading another deck over unsaved work */}
      {showUnsavedChangesModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
          onClick={closeUnsavedChangesModal}
        >
          <div
            className="bg-card text-card-foreground rounded-xl w-full max-w-md animate-in zoom-in-95 duration-200"
            style={{ boxShadow: '0 16px 40px rgba(0, 20, 80, 0.15)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">Unsaved changes</h3>

              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                {user ? (
                  <>Loading another deck will replace <strong className="text-foreground">{deck.name}</strong>. Save your changes first?</>
                ) : (
                  <><strong className="text-foreground">{deck.name}</strong> is only saved on this device, and loading another deck will replace it. Sign in to keep it in your account.</>
                )}
              </p>

              <div className="bg-muted/60 rounded-lg p-3.5">
                <div className="font-medium text-foreground text-sm">{deck.name}</div>
                <div className="text-xs text-muted-foreground">
                  {(() => { const n = getDeckStats().mainDeckCount + getDeckStats().reserveCount; return `${n} ${n === 1 ? 'card' : 'cards'}`; })()}
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-2.5">
                {user ? (
                  <button
                    onClick={saveThenRunPendingAction}
                    disabled={syncStatus?.isSaving}
                    className="w-full px-5 py-2.5 bg-primary/85 text-primary-foreground rounded-lg transition-all font-semibold text-sm hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncStatus?.isSaving ? 'Saving\u2026' : 'Save & continue'}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      closeUnsavedChangesModal();
                      router.push('/sign-in?redirectTo=/decklist/card-search');
                    }}
                    className="w-full px-5 py-2.5 bg-primary/85 text-primary-foreground rounded-lg transition-all font-semibold text-sm hover:bg-primary"
                  >
                    Sign in to save
                  </button>
                )}

                <button
                  onClick={discardThenRunPendingAction}
                  className="w-full px-5 py-2.5 rounded-lg transition-all text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {user ? 'Discard changes' : 'Discard & continue'}
                </button>

                <button
                  onClick={closeUnsavedChangesModal}
                  className="w-full px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* New Deck Confirmation Modal */}
      {showNewDeckModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-150"
          onClick={() => setShowNewDeckModal(false)}
        >
          <div
            className="bg-card text-card-foreground rounded-xl w-full max-w-md animate-in zoom-in-95 duration-200"
            style={{ boxShadow: '0 16px 40px rgba(0, 20, 80, 0.15)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">
                {!user ? 'Create New Deck?' : hasUnsavedChanges ? 'Unsaved Changes' : 'Create New Deck?'}
              </h3>

              {!user ? (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Your current deck will be lost — it&apos;s only saved locally on this device. Sign in to save multiple decks to the cloud.
                </p>
              ) : hasUnsavedChanges && deck.name === "Untitled Deck" ? (
                <NewDeckRenameForm
                  onSubmit={(newName) => proceedWithNewDeck(true, newName)}
                  onSkip={() => proceedWithNewDeck(true)}
                  onDiscard={() => proceedWithNewDeck(false)}
                  onCancel={() => setShowNewDeckModal(false)}
                />
              ) : hasUnsavedChanges ? (
                <>
                  <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                    Save changes to <strong className="text-foreground">{deck.name}</strong> before creating a new deck?
                  </p>
                  <div className="bg-muted/60 rounded-lg p-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-foreground text-sm">{deck.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {getDeckStats().mainDeckCount + getDeckStats().reserveCount} cards · {deck.format || "Type 1"}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Start a fresh deck?
                </p>
              )}

              {/* Actions */}
              {(!user || !hasUnsavedChanges || deck.name !== "Untitled Deck") && (
                <div className="mt-5 flex flex-col gap-2.5">
                  {user && hasUnsavedChanges && (
                    <button
                      onClick={() => proceedWithNewDeck(true)}
                      className="w-full px-5 py-2.5 bg-primary/85 text-primary-foreground rounded-lg transition-all font-semibold text-sm hover:bg-primary"
                    >
                      Save & Create New
                    </button>
                  )}

                  {!user && (
                    <button
                      onClick={() => {
                        setShowNewDeckModal(false);
                        router.push('/sign-in');
                      }}
                      className="w-full px-5 py-2.5 bg-primary/85 text-primary-foreground rounded-lg transition-all font-semibold text-sm hover:bg-primary"
                    >
                      Sign In to Save Decks
                    </button>
                  )}

                  <button
                    onClick={() => proceedWithNewDeck(false)}
                    className={`w-full px-5 py-2.5 rounded-lg transition-all text-sm ${
                      (user && hasUnsavedChanges) || !user
                        ? 'font-medium text-muted-foreground hover:bg-muted hover:text-foreground'
                        : 'bg-primary/85 text-primary-foreground font-semibold hover:bg-primary'
                    }`}
                  >
                    {user && hasUnsavedChanges ? "Don\u2019t Save" : !user ? "Discard & Start New" : "Create New Deck"}
                  </button>

                  <button
                    onClick={() => setShowNewDeckModal(false)}
                    className="w-full px-4 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* General notification */}
      {notification && (
        <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in ${
          notification.type === 'success' ? 'bg-green-600 text-white' :
          notification.type === 'error' ? 'bg-red-600 text-white' :
          'bg-green-700 text-white'
        }`}>
          {notification.message}
        </div>
      )}
      
      {/* Export notification */}
      {exportNotification && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in">
          Deck copied to clipboard!
        </div>
      )}
    </div>
    </BuilderConfigProvider>
  );
}