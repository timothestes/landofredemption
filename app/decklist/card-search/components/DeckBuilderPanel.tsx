import React, { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensors,
  useSensor,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Deck, DeckZone } from "../types/deck";
import { useShowPrices } from "../../../../hooks/useShowPrices";
import { SyncStatus } from "../hooks/useDeckState";
import DeckCardList from "./DeckCardList";
import FullDeckView from "./FullDeckView";
import DragGhost from "./DragGhost";
import { Switch } from "@headlessui/react";
import { Card, normalizeBrigadeField } from "../utils";
import { filterDeckCards } from "../utils/deckFilter";
import { DOCS } from "@/lib/resources";
import { compareCardsByType, compareCardsDefault, compareTypeGroups } from "@/lib/cards/defaultSort";
import { FormatId, FORMAT_IDS, FORMATS, normalizeFormat } from "@/lib/formats";
import { validateDeck } from "../utils/deckValidation";
import GeneratePDFModal from "./GeneratePDFModal";
import AodCountCard from "./AodCountCard";
import GenerateDeckImageModal from "./GenerateDeckImageModal";
import ClearDeckModal from "./ClearDeckModal";
import LoadDeckModal from "./LoadDeckModal";
import ShareDeckModal from "./ShareDeckModal";
import { duplicateDeckAction, setDeckVisibilityAction, loadGlobalTagsAction, updateDeckTagsAction, GlobalTag } from "../../actions";
import { DeckVisibility } from "../types/deck";
import { createGlobalTagAction } from "../../../admin/tags/actions";
import { HexColorPicker } from "react-colorful";
import { GoldfishButton } from "../../../goldfish/components/GoldfishButton";
import { useIsAdmin } from "../../../../hooks/useIsAdmin";
import UsernameModal from "../../my-decks/UsernameModal";
import { getParagonNames, getParagonByName } from "../data/paragons";
import { useCardPrices } from "../hooks/useCardPrices";
import ParagonRequirements from "./ParagonRequirements";
import { useCardImageUrl } from "../hooks/useCardImageUrl";
import { useBuilderConfig } from "../builderConfig";
import { CardThumb } from "./CardThumb";
import CardMentionTextarea from "@/components/ui/CardMentionTextarea";
import DeckDescription from "../../components/DeckDescription";
import BuyDeckModal, { BuyDeckCard } from "./BuyDeckModal";
import CollectionCheckModal from "./CollectionCheckModal";
import { aggregateOwnedByName } from "../utils/collectionCheck";
import { statCards, countBy } from "../utils/deckStats";
import DeckLegalityChecklist from "./DeckLegalityChecklist";
import type { DeckCheckResult } from "@/utils/deckcheck/types";
import { useBudgetPricing } from '../hooks/useBudgetPricing';
import type { BudgetCard } from '@/lib/pricing/budgetPricing';
import { useExternalDropTarget, useIsExternalDragActive, combineRefs, type SearchDragPayload } from '../hooks/useExternalDropTarget';

function getTagContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#1f2937" : "#ffffff";
}

// Active-state color for a format toggle button, by format family. Both
// Limited and Unlimited (family 'T1') share the old T1 accent color.
function formatActiveClass(family: 'T1' | 'T2' | 'Paragon'): string {
  if (family === 'T2') return 'bg-purple-600 dark:bg-purple-500 text-white';
  if (family === 'Paragon') return 'bg-amber-600 dark:bg-amber-500 text-white';
  return 'bg-accent text-accent-foreground';
}

export type TabType = "main" | "reserve" | "maybe" | "info" | "cover";

// Stable reference so DndContext doesn't re-init when drag is disabled on mobile.
const EMPTY_SENSORS: never[] = [];

/**
 * Wrapper that registers a @dnd-kit droppable. Must be used inside a DndContext —
 * which means it can render anywhere in the DeckBuilderPanel JSX tree (which IS
 * inside DndContext), but the same call from the parent function body would not
 * see the context.
 *
 * Also registers a native HTML5 drop target via `useExternalDropTarget` when
 * `onExternalDrop` is provided. This lets external sources (the search-results
 * column, which renders OUTSIDE this DndContext) drop cards onto the same
 * zones via native `draggable=true` + `dataTransfer` — no DndContext lift
 * required. The two systems coexist because dnd-kit listens to PointerEvents
 * and HTML5 listens to DragEvents.
 */
function Droppable({
  id,
  zone,
  children,
  className,
  onExternalDrop,
}: {
  id: string;
  zone: DeckZone;
  children: React.ReactNode;
  className: (isOver: boolean) => string;
  onExternalDrop?: (payload: SearchDragPayload) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { zone } });
  const { setRef: setExternalRef, isOver: isExternalOver } = useExternalDropTarget(onExternalDrop);
  const combinedRef = combineRefs<HTMLDivElement>(setNodeRef, setExternalRef);
  return (
    <div ref={combinedRef} className={className(isOver || isExternalOver)}>
      {children}
    </div>
  );
}

interface DeckBuilderPanelProps {
  /** Current deck state */
  deck: Deck;
  /** Cloud sync status */
  syncStatus?: SyncStatus;
  /** Whether there are unsaved changes */
  hasUnsavedChanges?: boolean;
  /** Whether the user is authenticated */
  isAuthenticated?: boolean;
  /** Whether the panel is expanded to full width */
  isExpanded?: boolean;
  /** Callback to toggle expanded/fullscreen mode */
  onToggleExpand?: () => void;
  /** Callback when deck name changes */
  onDeckNameChange: (name: string) => void;
  /** Callback when deck format changes */
  onDeckFormatChange?: (format: string) => void;
  /** Callback when Paragon changes */
  onParagonChange?: (paragon: string | undefined) => void;
  /** Callback when deck public status changes */
  onDeckPublicChange?: (isPublic: boolean) => void;
  /** Callback when deck three-state visibility changes */
  onDeckVisibilityChange?: (visibility: DeckVisibility) => void;
  /** Callback to save deck to cloud */
  onSaveDeck?: () => Promise<{ success: boolean; error?: string }>;
  /** Callback to add a card */
  onAddCard: (cardName: string, cardSet: string, zone: DeckZone) => void;
  /** Callback to remove a card */
  onRemoveCard: (cardName: string, cardSet: string, zone: DeckZone) => void;
  /** Callback to export deck (copy to clipboard) */
  onExport: () => void;
  /** Callback to download deck as .txt file */
  onDownload?: () => void;
  /** Callback to download deck as .txt file, grouped/sorted by set */
  onDownloadBySet?: () => void;
  /** Callback to import deck - parent handles UI */
  onImport: () => void;
  /** Callback to delete deck */
  onDelete: () => void;
  /** Whether the delete control is available (off for the Forge — its decks aren't in the public table). Default true. */
  canDelete?: boolean;
  /** Whether share/visibility + duplicate controls are available (off for the Forge — they'd write public data). Default true. */
  canShare?: boolean;
  /** Callback to duplicate current deck */
  onDuplicate?: () => void;
  /** Callback to load a deck from cloud by ID */
  onLoadDeck?: (deckId: string) => void;
  /** Replace the current deck's good half with another deck's good half (T2 only). */
  onReplaceGood?: (sourceDeckId: string) => void;
  /** Replace the current deck's evil half with another deck's evil half (T2 only). */
  onReplaceEvil?: (sourceDeckId: string) => void;
  /** Callback to create a new blank deck */
  onNewDeck?: (name?: string, folderId?: string | null, skipConfirmation?: boolean) => void;
  /** Callback when active tab changes */
  onActiveTabChange?: (tab: TabType) => void;
  /** Callback when user wants to view card details. Boolean kept for compat — true when viewing from reserve. */
  onViewCard?: (card: Card, fromReserve?: boolean) => void;
  /** Callback to show notifications */
  onNotify?: (message: string, type: 'success' | 'error' | 'info') => void;
  /** Callback when user changes cover card selections */
  onPreviewCardsChange?: (card1: string | null, card2: string | null) => void;
  /** Callback when user changes deck description */
  onDescriptionChange?: (description: string) => void;
  /** Force-disable hover previews (e.g. on mobile) */
  forceDisableHoverPreview?: boolean;
  /** Hover-preview preference. Owned by the parent so the search grid shares it. */
  hoverPreviewEnabled: boolean;
  /** Called when the user flips the hover-preview toggle in this panel. */
  onHoverPreviewEnabledChange: (enabled: boolean) => void;
  /** Default tab to show when panel mounts (persists across mobile drawer open/close) */
  defaultTab?: TabType;
  /** Server-side deck check result */
  deckCheckResult?: DeckCheckResult | null;
  /** Whether a deck check is currently in progress */
  isDeckChecking?: boolean;
  /** Full card catalog for budget pricing */
  allCards: BudgetCard[];
  /** User's collection quantities, keyed by `name|set|imgFile`. */
  collectionQuantities?: Map<string, number>;
  /** Whether the collection has loaded successfully. */
  collectionAvailable?: boolean;
  /** Non-null if the collection failed to load. */
  collectionSyncError?: string | null;
  /** Callback to enter spotlight mode */
  onSpotlightToggle?: () => void;
  /** Whether legality checks are currently suppressed */
  ignoreLegalityChecks?: boolean;
  /** Callback to toggle legality check suppression */
  onIgnoreLegalityChecksChange?: (value: boolean) => void;
}

/**
 * Right sidebar panel for deck building
 */
export default function DeckBuilderPanel({
  deck,
  syncStatus,
  hasUnsavedChanges = false,
  isAuthenticated = false,
  isExpanded = false,
  onToggleExpand,
  onDeckNameChange,
  onDeckFormatChange,
  onParagonChange,
  onDeckPublicChange,
  onDeckVisibilityChange,
  onSaveDeck,
  onAddCard,
  onRemoveCard,
  onExport,
  onDownload,
  onDownloadBySet,
  onImport,
  onDelete,
  canDelete = true,
  canShare = true,
  onDuplicate,
  onLoadDeck,
  onReplaceGood,
  onReplaceEvil,
  onNewDeck,
  onActiveTabChange,
  onViewCard,
  onNotify,
  onPreviewCardsChange,
  onDescriptionChange,
  forceDisableHoverPreview = false,
  hoverPreviewEnabled,
  onHoverPreviewEnabledChange,
  defaultTab,
  deckCheckResult,
  isDeckChecking,
  allCards,
  collectionQuantities,
  collectionAvailable = false,
  collectionSyncError = null,
  onSpotlightToggle,
  ignoreLegalityChecks = false,
  onIgnoreLegalityChecksChange,
}: DeckBuilderPanelProps) {
  // Feature gates from the active builder config (all default on; the Forge
  // turns off the tools that only make sense against the public catalog).
  const builderConfig = useBuilderConfig();
  const builderFeatures = builderConfig.features;
  const canImportExport = builderFeatures?.enableImportExport !== false;
  const canPrintExports = builderFeatures?.enablePrintExports !== false;
  const canShop = builderFeatures?.enableShopping !== false;
  const showDetailsTab = builderFeatures?.enableDetailsTab !== false;
  // LoadDeckModal lists the public `decks` table by default, so a custom
  // persistence hides Load Deck unless it supplies its own `listDecks`
  // (the Forge lists forge_decks).
  const canLoadDeckList = !builderConfig.persistence || !!builderConfig.persistence.listDecks;
  // A config-supplied share modal (the Forge's member-only share) surfaces the
  // Share controls even with the public share (`canShare`) off.
  const renderShareModal = builderConfig.renderShareModal;
  const canOpenShare = canShare || !!renderShareModal;

  const [activeTab, setActiveTab] = useState<TabType>(defaultTab ?? "main");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(deck.name);
  const [showMenu, setShowMenu] = useState(false);
  const [showGeneratePDFModal, setShowGeneratePDFModal] = useState(false);
  const [showGenerateImageModal, setShowGenerateImageModal] = useState(false);
  const [showDeleteDeckModal, setShowDeleteDeckModal] = useState(false);
  const [showLoadDeckModal, setShowLoadDeckModal] = useState(false);
  const [showReplaceGoodModal, setShowReplaceGoodModal] = useState(false);
  const [showReplaceEvilModal, setShowReplaceEvilModal] = useState(false);
  const [showBuyDeckModal, setShowBuyDeckModal] = useState(false);
  const [buyModalMode, setBuyModalMode] = useState<"exact" | "budget">("exact");
  const [showCollectionCheckModal, setShowCollectionCheckModal] = useState(false);
  // When set, the buy modal opens seeded with just these (missing) cards.
  const [buyCards, setBuyCards] = useState<BuyDeckCard[] | null>(null);
  const [showValidationTooltip, setShowValidationTooltip] = useState(false);
  const [showViewDropdown, setShowViewDropdown] = useState(false);
  // Two triggers (mobile / desktop) live in the header action group; whichever
  // one is currently visible (offsetParent != null) wins so the portal popover
  // anchors to the actual rendered button.
  const viewDropdownBtnRef = useRef<HTMLButtonElement>(null);
  const setViewDropdownTrigger = useCallback((el: HTMLButtonElement | null) => {
    if (el && el.offsetParent !== null) viewDropdownBtnRef.current = el;
  }, []);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<TabType, HTMLButtonElement | null>>({ main: null, reserve: null, maybe: null, info: null, cover: null });
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0 });
  const [showMobileFullDeckView, setShowMobileFullDeckView] = useState(false);
  const [fullViewPreviewCard, setFullViewPreviewCard] = useState<Card | null>(null);
  const [showParagonDropdown, setShowParagonDropdown] = useState(false);
  const [showParagonModal, setShowParagonModal] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  const currentVisibility: DeckVisibility =
    deck.visibility ?? (deck.isPublic ? "public" : "private");

  // Change the deck's three-state visibility. Used by the Share modal.
  const handleSelectVisibility = async (v: DeckVisibility) => {
    if (!deck.id || v === currentVisibility) return;
    const result = await setDeckVisibilityAction(deck.id, v);
    if (result.success) {
      onDeckVisibilityChange?.(v);
      onDeckPublicChange?.(v === "unlisted" || v === "public");
      onNotify?.((result as any).message || "Visibility updated", "success");
    } else if ((result as any).needsUsername) {
      setShowUsernameModal(true);
    } else {
      onNotify?.(result.error || "Failed to change visibility", "error");
    }
  };

  const { getImageUrl } = useCardImageUrl();

  // ── DnD state + sensors ──────────────────────────────────────────────
  const [activeDragCard, setActiveDragCard] = useState<Card | null>(null);
  // Drag-to-remove: drop a deck card to the LEFT of the deck panel (i.e., over
  // the search/filter column) to discard one copy. Tracks live pointer X so
  // the DragGhost can turn red while the pointer is in the remove zone.
  const panelRootRef = useRef<HTMLDivElement>(null);
  const lastPointerXRef = useRef(0);
  const [willRemoveOnDrop, setWillRemoveOnDrop] = useState(false);
  const isExternalDragActive = useIsExternalDragActive();
  // `isDragging` powers the "drop hint" UI on zone droppables. It now fires
  // for both in-deck @dnd-kit drags AND external HTML5 drags from the search
  // column, so users see drop affordances regardless of source.
  const isDragging = activeDragCard !== null || isExternalDragActive;
  // Drag-and-drop is disabled on mobile: touch drag is fiddly, fights scroll,
  // and the stepper/tap controls cover every action drag would. Sensors must be
  // created unconditionally (hooks rules); we drop them from DndContext below
  // when on mobile so no drag can ever activate.
  // Resolved ONCE at mount (never reactively): it gates only the sensors prop,
  // never markup, and DndContext spreads sensors into an internal effect dep
  // array — flipping between the 3-sensor and empty arrays mid-life trips
  // React's "dependency array changed size" warning.
  const [isMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const dndSensors = useSensors(
    // Mouse/pen: 10px movement before drag activates — gives twitchy hands
    // and precision trackpads more room before a click becomes a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 10 } }),
    // Touch: 200ms long-press + 5px tolerance — doesn't fight scroll.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor),
  );

  // Tab / zone droppables are declared via the <Droppable> wrapper component
  // (see bottom of file). They CANNOT be set up via useDroppable at the panel
  // level because the panel itself renders DndContext — its own hooks run
  // outside the context provider and never register with the manager.

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const card = event.active.data.current?.card as Card | undefined;
    if (card) setActiveDragCard(card);
  }, []);

  // Track pointer X during drag so handleDragEnd can decide "drag to remove"
  // and DragGhost can flip to its red state in the remove zone.
  useEffect(() => {
    if (!activeDragCard) {
      setWillRemoveOnDrop(false);
      return;
    }
    const handlePointerMove = (e: PointerEvent) => {
      lastPointerXRef.current = e.clientX;
      const rect = panelRootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setWillRemoveOnDrop(e.clientX < rect.left);
    };
    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [activeDragCard]);

  // Custom collision detection: prefer pointer-within for precision (small tab
  // triggers, the maybeboard strip), fall back to rectIntersection when the
  // pointer is in a gap. Default rectIntersection alone fails for the tab
  // triggers because the source draggable's rect doesn't translate during
  // drag — DragOverlay renders separately, so the active rect never overlaps
  // the tab bar above the card grid.
  const dndCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return rectIntersection(args);
  }, []);

  // No-op for tab targets — switching activeTab here would unmount the source
  // draggable (Main/Reserve are conditionally rendered) and abort the drag.
  // The tab trigger's `isOver` ring is sufficient feedback during the drag;
  // we switch activeTab after the drop completes (see handleDragEnd).
  const handleDragOver = useCallback((_event: DragOverEvent) => {}, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragCard(null);
  }, []);

  // Cover card picker: which slot is open (1, 2, or null)
  const [coverPickerSlot, setCoverPickerSlot] = useState<1 | 2 | null>(null);
  const [coverPickerSort, setCoverPickerSort] = useState<"default" | "name" | "type" | "brigade">("type");
  const [coverPickerSearch, setCoverPickerSearch] = useState("");

  // Measure active tab position for sliding indicator. Re-measures on
  // `activeTab` change AND whenever the tab bar resizes (e.g. user drags the
  // deck-panel splitter, window resize) — otherwise the indicator stays at the
  // stale pixel offset measured for the previous bar width.
  useEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const measure = () => {
      const tab = tabRefs.current[activeTab];
      if (!tab) return;
      const barRect = bar.getBoundingClientRect();
      const tabRect = tab.getBoundingClientRect();
      setTabIndicator({ left: tabRect.left - barRect.left, width: tabRect.width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [activeTab]);

  // Close cover picker on Escape
  useEffect(() => {
    if (coverPickerSlot === null) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCoverPickerSlot(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [coverPickerSlot]);

  // Description preview mode
  const [descriptionPreview, setDescriptionPreview] = useState(false);

  // Tags
  const { isAdmin, permissions } = useIsAdmin();
  const canManageTags = isAdmin && permissions.includes('manage_tags');
  const [deckTags, setDeckTags] = useState<GlobalTag[]>([]);
  const [allGlobalTags, setAllGlobalTags] = useState<GlobalTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [tagsBarContainer, setTagsBarContainer] = useState<HTMLDivElement | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#6366f1");
  const [createColorOpen, setCreateColorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadAllTags = useCallback(async () => {
    setTagsLoading(true);
    try {
      const { createClient } = await import("../../../../utils/supabase/client");
      const supabase = createClient();
      const { data, error } = await supabase
        .from("global_tags")
        .select("id, name, color")
        .order("name");
      if (!error && data) setAllGlobalTags(data as GlobalTag[]);
    } finally {
      setTagsLoading(false);
    }
  }, []);

  // Load global tags list when authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    loadAllTags();
  }, [isAuthenticated, loadAllTags]);

  // Retry loading tags when the picker opens and the list is empty (handles race/failure)
  useEffect(() => {
    if (tagPickerOpen && isAuthenticated && allGlobalTags.length === 0 && !tagsLoading) {
      loadAllTags();
    }
  }, [tagPickerOpen, isAuthenticated, allGlobalTags.length, tagsLoading, loadAllTags]);

  // Load this deck's current tags when the deck ID changes
  useEffect(() => {
    if (!deck.id || !isAuthenticated) { setDeckTags([]); return; }
    // Tags were already joined in loadPublicDeckAction/loadDeckByIdAction,
    // but in the builder we load them separately since we get the deck differently.
    import("../../actions").then(({ loadGlobalTagsAction: _ }) => {});
    // Fetch deck tags directly
    import("../../../../utils/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabase
        .from("deck_tags")
        .select("tag_id, global_tags(id, name, color)")
        .eq("deck_id", deck.id!)
        .then(({ data }) => {
          const tags = (data || []).map((r: any) => r.global_tags).filter(Boolean);
          setDeckTags(tags);
        });
    });
  }, [deck.id, isAuthenticated]);

  // Close tag picker on outside click
  useEffect(() => {
    if (!tagPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setTagPickerOpen(false);
        setTagFilter("");
        setCreateMode(false);
        setCreateError(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tagPickerOpen]);

  const toggleTag = useCallback(async (tag: GlobalTag) => {
    if (!deck.id) return;
    const isSelected = deckTags.some((t) => t.id === tag.id);
    const next = isSelected ? deckTags.filter((t) => t.id !== tag.id) : [...deckTags, tag];
    setDeckTags(next);
    setSavingTags(true);
    await updateDeckTagsAction(deck.id, next.map((t) => t.id));
    setSavingTags(false);
  }, [deckTags, deck.id]);

  const filteredGlobalTags = allGlobalTags.filter((t) =>
    t.name.toLowerCase().includes(tagFilter.toLowerCase())
  );

  async function handleCreateTagInBuilder(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim() || !deck.id) return;
    setCreateError(null);
    setCreating(true);
    const res = await createGlobalTagAction(createName.trim(), createColor);
    setCreating(false);
    if (!res.success) { setCreateError(res.error || "Failed to create tag"); return; }
    const newTag = res.tag as GlobalTag;
    setAllGlobalTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)));
    const next = [...deckTags, newTag];
    setDeckTags(next);
    setSavingTags(true);
    await updateDeckTagsAction(deck.id, next.map((t) => t.id));
    setSavingTags(false);
    setCreateMode(false);
    setCreateName("");
    setCreateColor("#6366f1");
    setCreateColorOpen(false);
    setCreateError(null);
    setTagFilter("");
  }

  // View options
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>('grid');
  // Text filter over the deck's own cards (the box under the zone tabs). Session-only.
  const [deckFilter, setDeckFilter] = useState("");
  // Shared app-wide preference (synced with the collection page)
  const [showPrices, setShowPrices] = useShowPrices();

  // Swipe-to-dismiss for mobile bottom sheet
  const sheetTouchRef = useRef<{ startY: number; currentY: number } | null>(null);
  const [sheetTranslateY, setSheetTranslateY] = useState(0);

  const [groupBy, setGroupBy] = useState<'type' | 'alignment'>('type');

  // Expanded (FullDeckView) view options
  const [expandedViewMode, setExpandedViewMode] = useState<'normal' | 'stacked'>('stacked');
  const [expandedGroupBy, setExpandedGroupBy] = useState<'none' | 'alignment' | 'type'>('type');
  // The preference lives in the parent (shared with the search grid); this panel
  // only renders the toggle and can force previews off regardless (mobile).
  const disableHoverPreview = forceDisableHoverPreview || !hoverPreviewEnabled;
  const toggleHoverPreview = () => onHoverPreviewEnabledChange(!hoverPreviewEnabled);
  
  // Initialize deck type based on deck.format
  const [deckType, setDeckType] = useState<FormatId>(() => normalizeFormat(deck.format));

  // Sync deckType with deck.format when deck changes (e.g., when loading a deck)
  useEffect(() => {
    setDeckType(normalizeFormat(deck.format));
  }, [deck.format]);

  // Calculate validation
  const validation = validateDeck(deck);

  // Helper function to get brigade color
  const getBrigadeColor = (brigade: string): string => {
    const brigadeColors: Record<string, string> = {
      'Red': '#DC2626',      // red-600
      'Blue': '#2b57a2',     // custom blue color
      'Green': '#02b65f',    // custom green color
      'Pale Green': '#bfdb9e', // pale green color
      'Purple': '#b75ba9',   // custom purple color
      'Gold': '#ffda5b',     // custom gold color
      'Good Gold': '#ffda5b', // good gold color
      'Evil Gold': '#ffda5b', // evil gold color
      'White': '#ffffff',    // custom white color
      'Black': '#020406',    // custom black color
      'Brown': '#a97b27',    // custom brown color
      'Teal': '#0D9488',     // teal-600
      'Crimson': '#f34088',  // custom crimson color
      'Orange': '#fcbb72',   // custom orange color
      'Silver': '#b5b8b9',   // custom silver color
      'Clay': '#e2b7b3',     // custom clay color
      'Gray': '#b3c0ba',     // custom gray color
    };
    return brigadeColors[brigade] || '#6B7280'; // default to gray-500
  };

  // Handle deck type change
  const handleDeckTypeChange = (newType: FormatId) => {
    setDeckType(newType);
    onDeckFormatChange?.(newType);
  };

  // Notify parent when tab changes
  const contentRef = useRef<HTMLDivElement>(null);
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    onActiveTabChange?.(tab);
    // Scroll content area to top when switching tabs
    contentRef.current?.scrollTo(0, 0);
  };

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = () => setShowMenu(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showMenu]);

  // Close view dropdown when clicking outside
  useEffect(() => {
    if (!showViewDropdown) return;
    const handleClick = () => setShowViewDropdown(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showViewDropdown]);

  // Close paragon dropdown when clicking outside
  useEffect(() => {
    if (!showParagonDropdown) return;
    const handleClick = () => setShowParagonDropdown(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showParagonDropdown]);

  // Close paragon modal with Escape key
  useEffect(() => {
    if (!showParagonModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowParagonModal(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showParagonModal]);

  // Calculate deck stats
  const mainDeckCards = deck.cards.filter((dc) => dc.zone === 'main');
  const reserveCards = deck.cards.filter((dc) => dc.zone === 'reserve');
  const maybeboardCards = deck.cards.filter((dc) => dc.zone === 'maybeboard');
  // What each zone tab actually lists. Tab counts stay unfiltered so the
  // deck totals never look wrong while a filter is typed.
  const visibleMainCards = filterDeckCards(mainDeckCards, deckFilter);
  const visibleReserveCards = filterDeckCards(reserveCards, deckFilter);
  const visibleMaybeboardCards = filterDeckCards(maybeboardCards, deckFilter);
  const mainDeckCount = mainDeckCards.reduce((sum, dc) => sum + dc.quantity, 0);
  const reserveCount = reserveCards.reduce((sum, dc) => sum + dc.quantity, 0);
  // Maybe tab badge shows unique-card count (matches the existing Main/Reserve
  // tab badge style which uses total quantity; here we deliberately use unique
  // count per the redesign brief, since maybeboard quantities are noisy).
  const maybeboardCount = maybeboardCards.length;
  const totalCards = mainDeckCount + reserveCount;

  // Calculate total deck price. A null price hides every price/buy affordance,
  // so the shopping gate simply forces null.
  const { getPrice } = useCardPrices();
  const totalDeckPrice = React.useMemo(() => {
    if (!canShop) return null;
    let total = 0;
    let hasAnyPrice = false;
    for (const dc of deck.cards) {
      // Maybeboard is a scratchpad — excluded from the deck's price total.
      if (dc.zone === 'maybeboard') continue;
      const priceKey = `${dc.card.name}|${dc.card.set}|${dc.card.imgFile}`;
      const priceInfo = getPrice(priceKey);
      if (priceInfo) {
        total += priceInfo.price * dc.quantity;
        hasAnyPrice = true;
      }
    }
    return hasAnyPrice ? total : null;
  }, [deck.cards, getPrice, canShop]);

  const { budgetTotal: rawBudgetTotal, savings: rawSavings } = useBudgetPricing(deck, allCards);
  const budgetTotal = canShop ? rawBudgetTotal : null;
  const savings = canShop ? rawSavings : null;

  const handleNameSubmit = () => {
    if (editedName.trim()) {
      onDeckNameChange(editedName.trim());
    } else {
      setEditedName(deck.name); // Reset if empty
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleNameSubmit();
    } else if (e.key === "Escape") {
      setEditedName(deck.name);
      setIsEditingName(false);
    }
  };

  // Handle moving card between zones
  const handleMoveCard = (cardName: string, cardSet: string, fromZone: DeckZone, toZone: DeckZone) => {
    const deckCard = deck.cards.find(
      (dc) => dc.card.name === cardName && dc.card.set === cardSet && dc.zone === fromZone
    );

    if (deckCard) {
      // Move one copy from current zone to target zone
      onRemoveCard(cardName, cardSet, fromZone);
      onAddCard(cardName, cardSet, toZone);
    }
  };

  // Resolve drag-end: source droppable's `data.fromZone` + target's id/data
  // tell us the move. tab:* targets map to the matching zone:* zone.
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const active = event.active;
      const over = event.over;
      setActiveDragCard(null);
      const fromZone = active.data.current?.fromZone as DeckZone | undefined;
      const card = active.data.current?.card as Card | undefined;
      if (!fromZone || !card) return;

      // Dropped outside any droppable: if released to the LEFT of the deck
      // panel (over the search/filter column) treat as "drag to remove" and
      // decrement one copy from the source zone. Anywhere else is a silent
      // no-op (treat like cancel).
      if (!over) {
        const rect = panelRootRef.current?.getBoundingClientRect();
        if (rect && lastPointerXRef.current < rect.left) {
          onRemoveCard(card.name, card.set, fromZone);
        }
        return;
      }

      // Resolve target zone. zone:* and tab:* both encode a target zone in
      // their data; fall back to parsing the id.
      const overId = String(over.id);
      const isTabDrop = overId.startsWith("tab:");
      let toZone = over.data.current?.zone as DeckZone | undefined;
      if (!toZone) {
        if (overId.startsWith("zone:")) toZone = overId.slice(5) as DeckZone;
        else if (isTabDrop) toZone = overId.slice(4) as DeckZone;
      }
      if (!toZone || toZone === fromZone) return; // same-zone drop: silent no-op
      handleMoveCard(card.name, card.set, fromZone, toZone);
    },
    // handleMoveCard is a stable closure over deck/onRemoveCard/onAddCard
    // captured each render; we don't memoize it, so this callback re-creates
    // each render too — acceptable, DndContext only reads it during a drag.
    [handleMoveCard, onRemoveCard]
  );

  // Group cards by type
  const groupCardsByType = (cards: typeof deck.cards) => {
    const grouped = cards.reduce((acc, deckCard) => {
      const type = deckCard.card.type || "Unknown";
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push(deckCard);
      return acc;
    }, {} as Record<string, typeof deck.cards>);

    // Order type buckets canonically (Dominants, Artifacts, Fortresses, …)
    return Object.keys(grouped)
      .sort(compareTypeGroups)
      .map((type) => ({
        type,
        // Sort cards within each type by alignment, brigade, then name
        cards: grouped[type].sort((a, b) => compareCardsByType(a.card, b.card)),
        count: grouped[type].reduce((sum, dc) => sum + dc.quantity, 0),
      }));
  };

  // Group cards by alignment
  const groupCardsByAlignment = (cards: typeof deck.cards) => {
    const grouped = cards.reduce((acc, deckCard) => {
      const alignment = deckCard.card.alignment || "Neutral";
      if (!acc[alignment]) {
        acc[alignment] = [];
      }
      acc[alignment].push(deckCard);
      return acc;
    }, {} as Record<string, typeof deck.cards>);

    // Sort alignments: Good, Evil, Neutral
    const alignmentOrder = ['Good', 'Evil', 'Neutral'];
    return Object.keys(grouped)
      .sort((a, b) => {
        const aIndex = alignmentOrder.indexOf(a);
        const bIndex = alignmentOrder.indexOf(b);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      })
      .map((alignment) => ({
        type: alignment,
        // Sort cards within each alignment by type, brigade, then name
        cards: grouped[alignment].sort((a, b) => compareCardsByType(a.card, b.card)),
        count: grouped[alignment].reduce((sum, dc) => sum + dc.quantity, 0),
      }));
  };

  // Group cards based on current groupBy setting
  const groupCards = (cards: typeof deck.cards) => {
    return groupBy === 'alignment' 
      ? groupCardsByAlignment(cards) 
      : groupCardsByType(cards);
  };

  // Prettify card type names
  const prettifyTypeName = (type: string): string => {
    const typeMap: Record<string, string> = {
      'GE': 'Good Enhancement',
      'EE': 'Evil Enhancement',
      'EC': 'Evil Character',
      'HC': 'Hero Character',
      'GC': 'Good Character',
      'LS': 'Lost Soul',
      'Dom': 'Dominant',
      'Cov': 'Covenant',
      'Cur': 'Curse',
      'Art': 'Artifact',
      'Fort': 'Fortress',
      'Site': 'Site',
    };
    return typeMap[type] || type;
  };

  // Get icon path for card type - returns single icon path or null for dual icons
  const getTypeIcon = (type: string): string | null => {
    // Only show icons for simple single types
    // Skip multi-type cards (those with "/" in the type)
    if (type.includes('/')) {
      return null;
    }
    
    // Return null for types that need dual icons
    if (type === 'Dominant' || type === 'Dom') {
      return null; // Will show both Good and Evil Dominant icons
    }
    
    // Map types to icon paths
    const iconMap: Record<string, string> = {
      'Artifact': '/filter-icons/Artifact.png',
      'Art': '/filter-icons/Artifact.png',
      'City': '/filter-icons/City.png',
      'Covenant': '/filter-icons/Covenant.png',
      'Cov': '/filter-icons/Covenant.png',
      'Curse': '/filter-icons/Curse.png',
      'Cur': '/filter-icons/Curse.png',
      'Evil Character': '/filter-icons/Evil Character.png',
      'EC': '/filter-icons/Evil Character.png',
      'Evil Enhancement': '/filter-icons/EE.png',
      'EE': '/filter-icons/EE.png',
      'Fortress': '/filter-icons/Good Fortress.png', // Just use Good version
      'Fort': '/filter-icons/Good Fortress.png',
      'Good Character': '/filter-icons/Hero.png',
      'GC': '/filter-icons/Hero.png',
      'Hero': '/filter-icons/Hero.png',
      'HC': '/filter-icons/Hero.png',
      'Good Enhancement': '/filter-icons/GE.png',
      'GE': '/filter-icons/GE.png',
      'Lost Soul': '/filter-icons/Lost Soul.png',
      'LS': '/filter-icons/Lost Soul.png',
      'Site': '/filter-icons/Site.png',
    };
    return iconMap[type] || null;
  };

  // Check if a type should show dual icons
  const shouldShowDualIcons = (type: string): boolean => {
    return type === 'Dominant' || type === 'Dom' || type === 'GE/EE' || type === 'EE/GE';
  };

  // Get dual icon configuration for a type
  const getDualIconConfig = (type: string): { icon1: string; alt1: string; icon2: string; alt2: string } | null => {
    if (type === 'Dominant' || type === 'Dom') {
      return {
        icon1: '/filter-icons/Good Dominant.png',
        alt1: 'Good Dominant',
        icon2: '/filter-icons/Evil Dominant.png',
        alt2: 'Evil Dominant'
      };
    }
    if (type === 'GE/EE' || type === 'EE/GE') {
      return {
        icon1: '/filter-icons/GE.png',
        alt1: 'Good Enhancement',
        icon2: '/filter-icons/EE.png',
        alt2: 'Evil Enhancement'
      };
    }
    return null;
  };

  // Shown when the deck filter narrows a zone to nothing. The zone itself has
  // cards, so the "No cards yet" empty state would be misleading here.
  const noFilterMatches = (
    <div className="text-center py-12">
      <p className="text-muted-foreground text-sm">
        No cards match &ldquo;{deckFilter.trim()}&rdquo;
      </p>
      <button
        type="button"
        onClick={() => setDeckFilter("")}
        className="mt-3 text-xs font-medium text-foreground underline underline-offset-2 hover:text-primary"
      >
        Clear filter
      </button>
    </div>
  );

  return (
    <DndContext
      sensors={isMobile ? EMPTY_SENSORS : dndSensors}
      collisionDetection={dndCollisionDetection}
      autoScroll={false}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "To pick up a card, press Space or Enter. Use the arrow keys to move between drop targets. Press Space or Enter again to drop, or Escape to cancel.",
        },
      }}
    >
    <div ref={panelRootRef} className="w-full h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-2 md:p-4 border-b border-border/60 overflow-visible relative z-30">
        {/* Deck Name + Counts Row */}
        {isEditingName ? (
          <input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            className="w-full text-lg md:text-xl font-semibold px-2 py-1 rounded border border-ring bg-card text-card-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <h2
              className="text-lg md:text-xl font-semibold text-foreground cursor-pointer hover:text-primary transition-colors truncate min-w-0 flex-shrink"
              onClick={() => {
                setIsEditingName(true);
                setEditedName(deck.name);
              }}
              title="Click to edit deck name"
              suppressHydrationWarning
            >
              {deck.name}
            </h2>
            {deck.id && (() => {
              const vis = deck.visibility ?? (deck.isPublic ? "public" : "private");
              const styles =
                vis === "public"
                  ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                  : vis === "unlisted"
                    ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                    : "bg-muted text-muted-foreground";
              const label = vis === "public" ? "Public" : vis === "unlisted" ? "Unlisted" : "Private";
              return (
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${styles}`}>
                  {label}
                </span>
              );
            })()}
            {totalDeckPrice !== null && (
              <button
                onClick={() => { setBuyModalMode("exact"); setShowBuyDeckModal(true); }}
                className="md:hidden flex-shrink-0 text-sm font-semibold text-green-600 dark:text-green-400 flex items-center gap-1 hover:underline"
                title="Buy deck on YTG"
              >
                <img src="/sponsors/ytg-dark.png" alt="" className="h-3.5 w-3.5 object-contain hidden dark:block" />
                <img src="/sponsors/ytg-light.png" alt="" className="h-3.5 w-3.5 object-contain dark:hidden" />
                ${totalDeckPrice.toFixed(2)}
              </button>
            )}
            {savings !== null && budgetTotal !== null && (
              <button
                onClick={() => { setBuyModalMode("budget"); setShowBuyDeckModal(true); }}
                className="md:hidden flex-shrink-0 text-xs text-muted-foreground hover:underline"
                title={`Save $${savings.toFixed(2)} with cheapest versions`}
              >
                Min: <span className="text-green-600 dark:text-green-400">${budgetTotal.toFixed(2)}</span>
              </button>
            )}
            <span className="hidden md:flex items-center gap-1 text-xs whitespace-nowrap ml-auto flex-shrink-0" suppressHydrationWarning>
              <span className="text-muted-foreground">{mainDeckCount}</span>
              {reserveCount > 0 && (
                <>
                  <span className="text-muted-foreground/60">/</span>
                  <span className="text-muted-foreground">{reserveCount}</span>
                </>
              )}
              <span className="text-muted-foreground/60">=</span>
              <span className="font-semibold text-foreground">{totalCards}</span>
              {totalDeckPrice !== null && (
                <>
                  <span className="text-muted-foreground/60 ml-1">·</span>
                  <button
                    onClick={() => { setBuyModalMode("exact"); setShowBuyDeckModal(true); }}
                    className="text-green-600 dark:text-green-400 font-medium hover:underline inline-flex items-center gap-0.5"
                    title="Buy deck on YTG"
                  >
                    <img src="/sponsors/ytg-dark.png" alt="" className="h-3 w-3 object-contain hidden dark:block" />
                    <img src="/sponsors/ytg-light.png" alt="" className="h-3 w-3 object-contain dark:hidden" />
                    ${totalDeckPrice.toFixed(2)}
                  </button>
                </>
              )}
              {savings !== null && budgetTotal !== null && (
                <>
                  <span className="text-muted-foreground/60 ml-0.5">·</span>
                  <button
                    onClick={() => { setBuyModalMode("budget"); setShowBuyDeckModal(true); }}
                    className="text-xs text-muted-foreground whitespace-nowrap hover:underline"
                    title={`Save $${savings.toFixed(2)} with cheapest versions`}
                  >
                    Min: <span className="text-green-600 dark:text-green-400">${budgetTotal.toFixed(2)}</span>
                  </button>
                </>
              )}
            </span>
          </div>
        )}

        {/* Mobile: Unified toolbar — format selector left, actions right */}
        <div className="md:hidden mt-1.5 flex items-center gap-1.5">
          {/* Format Selector (L/U/T2/P) */}
          <div className="flex items-center bg-muted rounded-full p-0.5">
            {FORMAT_IDS.map((id) => {
              const def = FORMATS[id];
              return (
                <button
                  key={id}
                  onClick={() => handleDeckTypeChange(id)}
                  title={def.label}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    deckType === id
                      ? formatActiveClass(def.family)
                      : 'text-muted-foreground cursor-pointer'
                  }`}
                >
                  {def.badge}
                </button>
              );
            })}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Action icons — tight row */}
          <div className="flex items-center gap-1">
            {/* Save */}
            {onSaveDeck && isAuthenticated && (
              <button
                onClick={async () => {
                  const result = await onSaveDeck();
                  if (!result.success && result.error) {
                    onNotify?.(result.error, 'error');
                  }
                }}
                disabled={syncStatus?.isSaving || !isAuthenticated}
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                  syncStatus?.isSaving
                    ? 'text-muted-foreground'
                    : hasUnsavedChanges
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
                title={hasUnsavedChanges ? 'Save deck' : 'All changes saved'}
              >
                {syncStatus?.isSaving ? (
                  <svg className="w-4.5 h-4.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : hasUnsavedChanges ? (
                  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                ) : (
                  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )}

            {/* New Deck */}
            {onNewDeck && (
              <button
                onClick={() => onNewDeck(undefined, deck.folderId)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 transition-colors"
                title="New deck"
              >
                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}

            {/* Practice */}
            {deck.id && (
              <GoldfishButton deckId={deck.id} deckName={deck.name} format={deck.format} iconOnly />
            )}

            {/* View (mobile) — sliders icon */}
            <button
              ref={setViewDropdownTrigger}
              onClick={(e) => {
                e.stopPropagation();
                setShowViewDropdown(!showViewDropdown);
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground transition-colors"
              title="View options"
              aria-label="View options"
            >
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>

            {/* Share button (opens the share/visibility modal) */}
            {canOpenShare && isAuthenticated && deck.id && (
              <button
                onClick={() => setShowShareModal(true)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                title="Share deck"
                aria-label="Share deck"
              >
                <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
            )}

            {/* More menu */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground transition-colors"
                title="More options"
              >
                <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
              {showMenu && (
                <>
                  <div className="fixed inset-0 z-[40]" onClick={() => setShowMenu(false)} />
                  <div
                    className="absolute top-full right-0 mt-1 z-[50] bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[180px] max-h-[70vh] overflow-y-auto"
                  >
                  {canImportExport && (
                    <>
                      <button
                        onClick={() => { onImport(); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                      >
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Import
                      </button>
                      <button
                        onClick={() => { onExport(); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                      >
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                        </svg>
                        Copy to Clipboard
                      </button>
                      {onDownload && (
                        <button
                          onClick={() => { onDownload(); setShowMenu(false); }}
                          className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                        >
                          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download .txt
                        </button>
                      )}
                      {onDownloadBySet && (
                        <button
                          onClick={() => { onDownloadBySet(); setShowMenu(false); }}
                          className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                        >
                          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Download .txt (by set)
                        </button>
                      )}
                      <div className="border-t border-border my-1" />
                    </>
                  )}
                  {canShare && onDuplicate && isAuthenticated && deck.id && (
                    <button
                      onClick={async () => {
                        setShowMenu(false);
                        const result = await duplicateDeckAction(deck.id!);
                        if (result.success) {
                          onNotify?.('Deck duplicated successfully!', 'success');
                          if (onLoadDeck && result.deckId) onLoadDeck(result.deckId);
                        } else {
                          onNotify?.(result.error || 'Failed to duplicate deck', 'error');
                        }
                      }}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                    >
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Duplicate
                    </button>
                  )}
                  {canLoadDeckList && onLoadDeck && isAuthenticated && (
                    <button
                      onClick={() => { setShowLoadDeckModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                    >
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Load Deck
                    </button>
                  )}
                  {onReplaceGood && isAuthenticated && deckType === 'T2' && (
                    <button
                      onClick={() => { setShowReplaceGoodModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                    >
                      <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Replace Good…
                    </button>
                  )}
                  {onReplaceEvil && isAuthenticated && deckType === 'T2' && (
                    <button
                      onClick={() => { setShowReplaceEvilModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                    >
                      <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Replace Evil…
                    </button>
                  )}
                  {canOpenShare && isAuthenticated && deck.id && (
                    <button
                      onClick={() => { setShowShareModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                    >
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                      </svg>
                      Share…
                    </button>
                  )}
                  {canPrintExports && (
                    <>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => { setShowGeneratePDFModal(true); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                      >
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        Generate PDF
                      </button>
                      <button
                        onClick={() => { setShowGenerateImageModal(true); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                      >
                        <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Generate Image
                      </button>
                    </>
                  )}
                  <div className="border-t border-border my-1" />
                  {totalDeckPrice !== null && (
                    <button
                      onClick={() => { setBuyModalMode("exact"); setShowBuyDeckModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                    >
                      <img src="/sponsors/ytg-dark.png" alt="" className="w-4 h-4 object-contain hidden dark:block" />
                      <img src="/sponsors/ytg-light.png" alt="" className="w-4 h-4 object-contain dark:hidden" />
                      Buy on YTG
                    </button>
                  )}
                  {canShop && isAuthenticated && (
                    <button
                      onClick={() => { setShowCollectionCheckModal(true); setShowMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                    >
                      <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Check my collection
                    </button>
                  )}
                  {canDelete && isAuthenticated && (
                    <>
                      <div className="border-t border-border my-1" />
                      <button
                        onClick={() => { setShowDeleteDeckModal(true); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-red-600 dark:text-red-400 text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete Deck
                      </button>
                    </>
                  )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile: Paragon selector — second row when Paragon format active */}
        {deckType === 'Paragon' && (
          <div className="md:hidden mt-1 relative">
            <button
              onClick={() => setShowParagonDropdown(!showParagonDropdown)}
              className="w-full text-xs px-2.5 py-1.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg text-amber-900 dark:text-amber-100 font-medium flex items-center gap-1.5 justify-between"
            >
              {deck.paragon ? (
                <span className="flex items-center gap-1.5">
                  {(() => {
                    const paragonData = getParagonByName(deck.paragon);
                    if (paragonData) {
                      return (
                        <>
                          <span className="flex gap-0.5">
                            <span
                              className="w-3 h-3 rounded-sm border border-black"
                              style={{ backgroundColor: getBrigadeColor(paragonData.goodBrigade) }}
                            />
                            <span
                              className="w-3 h-3 rounded-sm border border-black"
                              style={{ backgroundColor: getBrigadeColor(paragonData.evilBrigade) }}
                            />
                          </span>
                          <span>{deck.paragon}</span>
                        </>
                      );
                    }
                    return <span>{deck.paragon}</span>;
                  })()}
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-300">Choose Paragon...</span>
              )}
              <svg className={`w-3 h-3 transition-transform ${showParagonDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showParagonDropdown && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-popover border border-border rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
                <button
                  onClick={() => {
                    onParagonChange?.(undefined);
                    setShowParagonDropdown(false);
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted transition-colors"
                >
                  Choose a Paragon...
                </button>
                {getParagonNames().map((name) => {
                  const paragonData = getParagonByName(name);
                  return (
                    <button
                      key={name}
                      onClick={() => {
                        onParagonChange?.(name);
                        setShowParagonDropdown(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors flex items-center gap-2 ${
                        deck.paragon === name ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100' : 'text-foreground'
                      }`}
                    >
                      {paragonData && (
                        <span className="flex gap-0.5 flex-shrink-0">
                          <span
                            className="w-3 h-3 rounded-sm border border-black"
                            style={{ backgroundColor: getBrigadeColor(paragonData.goodBrigade) }}
                          />
                          <span
                            className="w-3 h-3 rounded-sm border border-black"
                            style={{ backgroundColor: getBrigadeColor(paragonData.evilBrigade) }}
                          />
                        </span>
                      )}
                      <span className="font-medium">{name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Card Count and Menu Button Row — desktop only */}
        <div className="deck-header-row hidden md:flex mt-2 flex-col md:flex-row md:flex-wrap md:items-center md:justify-between gap-3 min-w-0">
          <div className="flex items-center gap-2 md:gap-3 text-sm flex-wrap min-w-0" suppressHydrationWarning>
            {/* Desktop: Format Selector (L/U/T2/P) */}
            <div className="hidden md:flex items-center gap-1 bg-muted rounded-full p-0.5">
              {FORMAT_IDS.map((id) => {
                const def = FORMATS[id];
                return (
                  <button
                    key={id}
                    onClick={() => handleDeckTypeChange(id)}
                    title={def.label}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                      deckType === id
                        ? formatActiveClass(def.family)
                        : 'text-muted-foreground hover:text-foreground cursor-pointer'
                    }`}
                  >
                    {def.badge}
                  </button>
                );
              })}
            </div>

            {/* Desktop: Paragon Selector (only show for Paragon format) */}
            {deckType === 'Paragon' && (
              <div className="hidden md:flex relative items-center gap-1">
                <span className="text-muted-foreground text-xs">Paragon:</span>
                <button
                    onClick={() => setShowParagonDropdown(!showParagonDropdown)}
                    className="text-xs px-2 py-0.5 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded text-amber-900 dark:text-amber-100 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 flex items-center gap-1.5 min-w-[180px] justify-between"
                  >
                    {deck.paragon ? (
                      <span className="flex items-center gap-1.5">
                        {(() => {
                          const paragonData = getParagonByName(deck.paragon);
                          if (paragonData) {
                            return (
                              <>
                                <span className="flex gap-0.5">
                                  <span
                                    className="w-3 h-3 rounded-sm border border-black"
                                    style={{ backgroundColor: getBrigadeColor(paragonData.goodBrigade) }}
                                    title={`${paragonData.goodBrigade} (Good)`}
                                  />
                                  <span
                                    className="w-3 h-3 rounded-sm border border-black"
                                    style={{ backgroundColor: getBrigadeColor(paragonData.evilBrigade) }}
                                    title={`${paragonData.evilBrigade} (Evil)`}
                                  />
                                </span>
                                <span>{deck.paragon}</span>
                              </>
                            );
                          }
                          return <span>{deck.paragon}</span>;
                        })()}
                      </span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-300">Choose a Paragon...</span>
                    )}
                    <svg className={`w-3 h-3 transition-transform ${showParagonDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Custom Dropdown Menu */}
                  {showParagonDropdown && (
                    <div className="absolute top-full mt-1 left-0 bg-popover border border-border rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto min-w-[240px]">
                      <button
                        onClick={() => {
                          onParagonChange?.(undefined);
                          setShowParagonDropdown(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted transition-colors"
                      >
                        Choose a Paragon...
                      </button>
                      {getParagonNames().map((name) => {
                        const paragonData = getParagonByName(name);
                        return (
                          <button
                            key={name}
                            onClick={() => {
                              onParagonChange?.(name);
                              setShowParagonDropdown(false);
                            }}
                            className={`w-full px-3 py-2 text-left text-xs hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors flex items-center gap-2 ${
                              deck.paragon === name ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-100' : 'text-foreground'
                            }`}
                          >
                            {paragonData && (
                              <span className="flex gap-0.5 flex-shrink-0">
                                <span
                                  className="w-3 h-3 rounded-sm border border-black"
                                  style={{ backgroundColor: getBrigadeColor(paragonData.goodBrigade) }}
                                  title={`${paragonData.goodBrigade} (Good)`}
                                />
                                <span
                                  className="w-3 h-3 rounded-sm border border-black"
                                  style={{ backgroundColor: getBrigadeColor(paragonData.evilBrigade) }}
                                  title={`${paragonData.evilBrigade} (Evil)`}
                                />
                              </span>
                            )}
                            <span className="font-medium">{name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
            )}
          </div>

          {/* Action Buttons — desktop only (mobile has unified toolbar) */}
          <div className="hidden md:flex items-center gap-2 flex-shrink-0 flex-wrap">
            {/* Save Button - desktop only (mobile save is in the format selector row) */}
            {onSaveDeck && isAuthenticated && (
              <button
                onClick={async () => {
                  if (!isAuthenticated) {
                    onNotify?.('Please sign in to save your deck to the cloud.', 'error');
                    return;
                  }
                  const result = await onSaveDeck();
                  if (!result.success && result.error) {
                    onNotify?.(result.error, 'error');
                  }
                }}
                disabled={syncStatus?.isSaving || !isAuthenticated}
                aria-label="Save deck"
                className={`hidden md:flex px-3 py-1.5 rounded border transition-all items-center justify-center ${
                  syncStatus?.isSaving || !isAuthenticated
                    ? 'border-border bg-muted text-muted-foreground cursor-not-allowed'
                    : hasUnsavedChanges
                    ? 'border-primary bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm'
                    : 'border-border bg-card hover:bg-muted text-muted-foreground'
                }`}
                title={
                  !isAuthenticated
                    ? 'Only signed in users may save decks'
                    : syncStatus?.isSaving
                    ? 'Saving...'
                    : hasUnsavedChanges
                    ? 'You have unsaved changes - Click to save to cloud (Ctrl+S / Cmd+S)'
                    : syncStatus?.lastSavedAt
                    ? `All changes saved - Last saved ${new Date(syncStatus.lastSavedAt).toLocaleTimeString()} (Ctrl+S / Cmd+S)`
                    : 'No changes to save (Ctrl+S / Cmd+S)'
                }
              >
                {syncStatus?.isSaving ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : hasUnsavedChanges ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            )}

            {/* New Deck Button */}
            {onNewDeck && (
              <button
                onClick={() => onNewDeck(undefined, deck.folderId)}
                className="px-3 py-1.5 text-sm font-medium rounded border border-primary bg-primary/10 hover:bg-primary/20 text-primary transition-colors flex items-center gap-2 flex-shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="new-deck-label-long">New Deck</span>
              </button>
            )}

            {/* Practice Button */}
            {deck.id && (
              <GoldfishButton deckId={deck.id} deckName={deck.name} format={deck.format} iconOnly />
            )}

            {/* View Button (desktop) — sliders icon, icon-only to match neighbors */}
            <button
              ref={setViewDropdownTrigger}
              onClick={(e) => {
                e.stopPropagation();
                setShowViewDropdown(!showViewDropdown);
              }}
              className="px-3 py-1.5 text-sm font-medium rounded border border-border bg-card hover:bg-muted text-muted-foreground transition-colors flex items-center gap-2"
              title="View options"
              aria-label="View options"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>

            {/* Share button (opens the share/visibility modal) */}
            {canOpenShare && isAuthenticated && deck.id && (
              <button
                onClick={() => setShowShareModal(true)}
                className="px-3 py-1.5 rounded border border-border bg-card hover:bg-muted text-muted-foreground transition-colors flex items-center"
                title="Share deck"
                aria-label="Share deck"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
            )}

            {/* Menu Dropdown */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="px-3 py-1.5 text-sm font-medium rounded border border-border bg-card hover:bg-muted text-muted-foreground transition-colors flex items-center gap-2"
              >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
            {showMenu && (
              <div className="absolute top-full mt-1 right-0 bg-popover border border-border rounded-lg shadow-lg py-1 z-50 min-w-[160px] max-h-[70vh] overflow-y-auto">
              {/* Import/Export Section */}
              {canImportExport && (
              <>
              <button
                onClick={() => {
                  onImport();
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
                title="Import deck from clipboard (Ctrl+I / Cmd+I)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Import (Ctrl+I)
              </button>
              <button
                onClick={() => {
                  onExport();
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
                title="Copy deck to clipboard (Ctrl+E / Cmd+E)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy to Clipboard
              </button>
              {onDownload && (
                <button
                  onClick={() => {
                    onDownload();
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
                  title="Download deck as .txt file"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download .txt
                </button>
              )}
              {onDownloadBySet && (
                <button
                  onClick={() => {
                    onDownloadBySet();
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
                  title="Download deck as .txt file, sorted by set"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download .txt (by set)
                </button>
              )}
              <div className="border-t border-border my-1"></div>
              </>
              )}

              {/* Duplicate/Load Section */}
              {canShare && onDuplicate && isAuthenticated && deck.id && (
                <button
                  onClick={async () => {
                    setShowMenu(false);
                    const result = await duplicateDeckAction(deck.id!);
                    if (result.success) {
                      onNotify?.('Deck duplicated successfully!', 'success');
                      // Optionally reload or navigate to the duplicated deck
                      if (onLoadDeck && result.deckId) {
                        onLoadDeck(result.deckId);
                      }
                    } else {
                      onNotify?.(result.error || 'Failed to duplicate deck', 'error');
                    }
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
                  title="Create a copy of this deck"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Duplicate
                </button>
              )}
              {canLoadDeckList && onLoadDeck && isAuthenticated && (
                <button
                  onClick={() => {
                    setShowLoadDeckModal(true);
                    setShowMenu(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
                  title="Load a saved deck from the cloud"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Load Deck
                </button>
              )}
              {onReplaceGood && isAuthenticated && deckType === 'T2' && (
                <button
                  onClick={() => { setShowReplaceGoodModal(true); setShowMenu(false); }}
                  className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                >
                  <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Replace Good…
                </button>
              )}
              {onReplaceEvil && isAuthenticated && deckType === 'T2' && (
                <button
                  onClick={() => { setShowReplaceEvilModal(true); setShowMenu(false); }}
                  className="w-full px-4 py-2.5 text-left hover:bg-muted flex items-center gap-2.5 text-foreground text-sm"
                >
                  <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Replace Evil…
                </button>
              )}

              {/* Sharing Section */}
              {canOpenShare && isAuthenticated && deck.id && (
                <button
                  onClick={() => { setShowShareModal(true); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
                >
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share…
                </button>
              )}

              <div className="border-t border-border my-1"></div>

              {/* Generate Section */}
              {canPrintExports && (
              <>
              <button
                onClick={() => {
                  setShowGeneratePDFModal(true);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Generate PDF
              </button>
              <button
                onClick={() => {
                  setShowGenerateImageModal(true);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Generate Image
              </button>
              <div className="border-t border-border my-1"></div>
              </>
              )}
              {totalDeckPrice !== null && (
                <button
                  onClick={() => { setBuyModalMode("exact"); setShowBuyDeckModal(true); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
                >
                  <img src="/sponsors/ytg-dark.png" alt="" className="w-4 h-4 object-contain hidden dark:block" />
                  <img src="/sponsors/ytg-light.png" alt="" className="w-4 h-4 object-contain dark:hidden" />
                  Buy on YTG
                </button>
              )}
              {canShop && isAuthenticated && (
                <button
                  onClick={() => { setShowCollectionCheckModal(true); setShowMenu(false); }}
                  className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-foreground text-sm"
                >
                  <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Check my collection
                </button>
              )}

              {canDelete && isAuthenticated && (
                <>
                  <div className="border-t border-border my-1"></div>
                  <button
                    onClick={() => {
                      setShowDeleteDeckModal(true);
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-muted flex items-center gap-2 text-red-600 dark:text-red-400 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete Deck
                  </button>
                </>
              )}
            </div>
          )}
          </div>
          </div>
        </div>
      </div>

      {/* ...existing code... */}
      {/* Tabs - Hide when expanded (full screen view) */}
      {!isExpanded && (
      <div ref={tabBarRef} className="deck-tabbar flex-shrink-0 flex items-center border-b border-border bg-card relative z-20">
        {/* Sliding tab indicator */}
        <div
          className="absolute bottom-0 h-0.5 bg-primary transition-all duration-200"
          style={{
            transitionTimingFunction: 'var(--ease-out-quart)',
            width: tabIndicator.width,
            transform: `translateX(${tabIndicator.left}px)`,
          }}
        />
        <Droppable
          id="tab:main"
          zone="main"
          onExternalDrop={(payload) => {
            onAddCard(payload.name, payload.set, "main");
            setActiveTab("main");
          }}
          className={(isOver) =>
            `flex-1 min-w-0 rounded transition-colors ${
              isOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""
            }`
          }
        >
          <button
            ref={(el) => { tabRefs.current.main = el; }}
            onClick={() => handleTabChange("main")}
            className={`w-full overflow-hidden px-1.5 md:px-3 py-3 text-xs md:text-sm font-medium transition-colors duration-200 whitespace-nowrap text-center ${
              activeTab === "main"
                ? "text-blue-600 dark:text-blue-400"
                : "text-muted-foreground hover:text-foreground"
            } ${isDragging ? "bg-primary/5" : ""}`}
          >
            <span className="tab-label-short">Main <span className="text-[10px] opacity-75">{mainDeckCount}</span></span>
            <span className="tab-label-long">Main ({mainDeckCount})</span>
          </button>
        </Droppable>
        <Droppable
          id="tab:reserve"
          zone="reserve"
          onExternalDrop={(payload) => {
            onAddCard(payload.name, payload.set, "reserve");
            setActiveTab("reserve");
          }}
          className={(isOver) =>
            `flex-1 min-w-0 rounded transition-colors ${
              isOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""
            }`
          }
        >
          <button
            ref={(el) => { tabRefs.current.reserve = el; }}
            onClick={() => handleTabChange("reserve")}
            className={`w-full overflow-hidden px-1.5 md:px-3 py-3 text-xs md:text-sm font-medium transition-colors duration-200 whitespace-nowrap text-center ${
              activeTab === "reserve"
                ? "text-blue-600 dark:text-blue-400"
                : "text-muted-foreground hover:text-foreground"
            } ${isDragging ? "bg-primary/5" : ""}`}
          >
            <span className="tab-label-short">Res <span className="text-[10px] opacity-75">{reserveCount}</span></span>
            <span className="tab-label-long">Reserve ({reserveCount})</span>
          </button>
        </Droppable>
        <Droppable
          id="tab:maybe"
          zone="maybeboard"
          onExternalDrop={(payload) => {
            onAddCard(payload.name, payload.set, "maybeboard");
            setActiveTab("maybe");
          }}
          className={(isOver) =>
            `flex-1 min-w-0 rounded transition-colors ${
              isOver ? "bg-primary/10 ring-1 ring-inset ring-primary/40" : ""
            }`
          }
        >
          <button
            ref={(el) => { tabRefs.current.maybe = el; }}
            onClick={() => handleTabChange("maybe")}
            className={`w-full overflow-hidden px-1.5 md:px-3 py-3 text-xs md:text-sm font-medium transition-colors duration-200 whitespace-nowrap text-center ${
              activeTab === "maybe"
                ? "text-blue-600 dark:text-blue-400"
                : "text-muted-foreground hover:text-foreground"
            } ${isDragging ? "bg-primary/5" : ""}`}
          >
            <span className="tab-label-short">Maybe <span className="text-[10px] opacity-75">{maybeboardCount}</span></span>
            <span className="tab-label-long">Maybe ({maybeboardCount})</span>
          </button>
        </Droppable>
        <button
          ref={(el) => { tabRefs.current.info = el; }}
          onClick={() => handleTabChange("info")}
          onMouseEnter={() => setShowValidationTooltip(true)}
          onMouseLeave={() => setShowValidationTooltip(false)}
          aria-disabled={isDragging || undefined}
          className={`relative flex-1 min-w-0 overflow-hidden px-1.5 md:px-3 py-3 text-xs md:text-sm font-medium transition-colors duration-200 whitespace-nowrap text-center ${
            isDragging ? "opacity-40 pointer-events-none" : ""
          } ${
            activeTab === "info"
              ? "text-blue-600 dark:text-blue-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex items-center justify-center gap-1.5">
            Stats
            {validation.stats.totalCards > 0 && !ignoreLegalityChecks && (
              isDeckChecking ? (
                <>
                  <span className="tab-badge items-center justify-center w-4 h-4 rounded-full bg-gray-500">
                    <svg className="w-2.5 h-2.5 text-white animate-spin" viewBox="0 0 12 12" fill="none">
                      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
                      <path d="M11 6a5 5 0 00-5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="tab-dot w-1.5 h-1.5 rounded-full bg-gray-500" />
                </>
              ) : (
                <>
                  <span
                    className={`tab-badge items-center justify-center w-4 h-4 text-xs rounded-full ${
                      (deckCheckResult?.valid ?? validation.isValid)
                        ? "bg-green-500 text-white"
                        : "bg-red-500 text-white"
                    }`}
                  >
                    {(deckCheckResult?.valid ?? validation.isValid) ? "✓" : "!"}
                  </span>
                  <span
                    className={`tab-dot w-1.5 h-1.5 rounded-full ${
                      (deckCheckResult?.valid ?? validation.isValid)
                        ? "bg-green-500"
                        : "bg-red-500"
                    }`}
                  />
                </>
              )
            )}
          </span>

          {/* Validation Tooltip — compact pill, details live in Stats tab */}
          {showValidationTooltip && !ignoreLegalityChecks && validation.stats.totalCards > 0 && (() => {
            const valid = deckCheckResult?.valid ?? validation.isValid;
            const errCount = deckCheckResult
              ? deckCheckResult.issues.filter(i => i.type === "error").length
              : validation.issues.filter(i => i.type === "error").length;
            const isT2Fmt = deckType === 'T2';
            const label = valid
              ? "Tournament Legal"
              : `${errCount} issue${errCount !== 1 ? "s" : ""} found`;
            const bg = isDeckChecking
              ? "bg-gray-800 text-gray-300 border-b-gray-800"
              : valid
                ? "bg-green-950 text-green-300 border-b-green-950"
                : "bg-red-950 text-red-300 border-b-red-950";

            // For T2: compute good/evil balance counts for the tooltip
            let balanceLine: string | null = null;
            if (isT2Fmt && !isDeckChecking) {
              const counts = { mainGood: 0, mainEvil: 0, resGood: 0, resEvil: 0 };
              for (const dc of deck.cards) {
                if (dc.zone === 'maybeboard') continue;
                const a = dc.card.alignment || "";
                let side: "good" | "evil" | null = null;
                if (a.includes("Good") && a.includes("Evil")) side = null; // neutral
                else if (a.includes("Good") && a.includes("Neutral")) side = "good";
                else if (a.includes("Evil") && a.includes("Neutral")) side = "evil";
                else if (a.includes("Good")) side = "good";
                else if (a.includes("Evil")) side = "evil";
                if (!side) continue;
                if (dc.zone === 'reserve') {
                  if (side === "good") counts.resGood += dc.quantity;
                  else counts.resEvil += dc.quantity;
                } else {
                  if (side === "good") counts.mainGood += dc.quantity;
                  else counts.mainEvil += dc.quantity;
                }
              }
              const resCount = deck.cards.filter(c => c.zone === 'reserve').reduce((s, c) => s + c.quantity, 0);
              balanceLine = `Main: ${counts.mainGood}G · ${counts.mainEvil}E`;
              if (resCount > 0) {
                balanceLine += `  |  Res: ${counts.resGood}G · ${counts.resEvil}E`;
              }
            }

            return (
              <div className={`hidden md:block absolute left-1/2 -translate-x-1/2 top-full mt-1.5 px-3 py-1.5 rounded-md shadow-lg z-50 pointer-events-none text-center text-xs font-medium whitespace-nowrap ${bg.split(" ").slice(0, 2).join(" ")}`}>
                <div className={`absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-[5px] border-r-[5px] border-b-[5px] border-l-transparent border-r-transparent ${bg.split(" ")[2]}`} />
                {label}
                {balanceLine && (
                  <div className="text-[10px] opacity-70 mt-0.5">{balanceLine}</div>
                )}
              </div>
            );
          })()}
        </button>

        {/* Details Tab (Cover Cards + Description) — hidden when the backend
            has nowhere to persist cover/tags/description (the Forge). */}
        {showDetailsTab && (
        <button
          ref={(el) => { tabRefs.current.cover = el; }}
          onClick={() => handleTabChange("cover")}
          aria-disabled={isDragging || undefined}
          className={`flex-1 min-w-0 overflow-hidden px-1.5 md:px-3 py-3 text-xs md:text-sm font-medium transition-colors duration-200 whitespace-nowrap text-center ${
            isDragging ? "opacity-40 pointer-events-none" : ""
          } ${
            activeTab === "cover"
              ? "text-blue-600 dark:text-blue-400"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Details
        </button>
        )}
      </div>
      )}

      {/* Deck filter — narrows the active zone's list to cards whose text
          matches (name, type, brigade, ability, …). Hidden on the Stats and
          Details tabs, and in the expanded full deck view. */}
      {!isExpanded && (activeTab === "main" || activeTab === "reserve" || activeTab === "maybe") && (
      <div className="flex-shrink-0 px-4 pt-3">
        <div className="relative">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={deckFilter}
            onChange={(e) => setDeckFilter(e.target.value)}
            onKeyDown={(e) => {
              // Esc: first press clears, second press blurs — same as the catalog search.
              if (e.key !== "Escape") return;
              e.preventDefault();
              if (deckFilter) setDeckFilter("");
              else e.currentTarget.blur();
            }}
            placeholder="Filter deck…"
            aria-label="Filter cards in this deck"
            className="w-full h-11 md:h-9 pl-9 pr-11 md:pr-9 rounded border border-border bg-card text-base md:text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
          />
          {deckFilter && (
            <button
              type="button"
              onClick={() => setDeckFilter("")}
              aria-label="Clear deck filter"
              className="absolute right-0 top-0 h-11 w-11 md:h-9 md:w-9 rounded-r flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
      )}

      {/* View dropdown trigger lives in the deck-panel header's right action
          group (Practice / View / ⋯). The popover is rendered outside the
          (collapsed-only) tab bar so it also works in the expanded full deck
          view; it portals to document.body in either case. */}
      {showViewDropdown && createPortal(
            <>
              {/* Backdrop — mobile: visible overlay, desktop: transparent click-catcher */}
              <div
                className="fixed inset-0 md:bg-transparent bg-black/40 z-[60]"
                onClick={() => setShowViewDropdown(false)}
              />
              {/* Mobile: bottom sheet */}
              <div
                className="
                  md:hidden
                  fixed bottom-14 left-0 right-0 pb-[env(safe-area-inset-bottom)] rounded-t-2xl max-h-[70vh] overflow-y-auto
                  bg-popover border border-border shadow-xl py-2 z-[70]
                "
                style={{
                  transform: sheetTranslateY > 0 ? `translateY(${sheetTranslateY}px)` : undefined,
                  transition: sheetTranslateY === 0 ? 'transform 0.2s ease-out' : undefined,
                }}
                onTouchStart={(e) => {
                  sheetTouchRef.current = { startY: e.touches[0].clientY, currentY: e.touches[0].clientY };
                }}
                onTouchMove={(e) => {
                  if (!sheetTouchRef.current) return;
                  sheetTouchRef.current.currentY = e.touches[0].clientY;
                  const delta = sheetTouchRef.current.currentY - sheetTouchRef.current.startY;
                  if (delta > 0) {
                    setSheetTranslateY(delta);
                  }
                }}
                onTouchEnd={() => {
                  if (!sheetTouchRef.current) return;
                  const delta = sheetTouchRef.current.currentY - sheetTouchRef.current.startY;
                  if (delta > 80) {
                    setShowViewDropdown(false);
                  }
                  setSheetTranslateY(0);
                  sheetTouchRef.current = null;
                }}
              >
                {/* Drag handle */}
                <div className="flex justify-center py-2">
                  <div className="w-10 h-1 rounded-full bg-border" />
                </div>
                {/* Layout */}
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Layout</div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewLayout('grid'); }}
                      className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${
                        viewLayout === 'grid'
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                      title="Grid view"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                      <span className="text-xs font-medium">Grid</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewLayout('list'); }}
                      className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${
                        viewLayout === 'list'
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                      title="List view"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                      </svg>
                      <span className="text-xs font-medium">List</span>
                    </button>
                  </div>
                </div>
                <div className="border-t border-border my-2"></div>
                {/* Group By */}
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Group by</div>
                  <div className="space-y-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setGroupBy('type'); }}
                      className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                        groupBy === 'type'
                          ? 'bg-primary/15 text-primary font-medium'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <span>Type</span>
                      {groupBy === 'type' && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setGroupBy('alignment'); }}
                      className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                        groupBy === 'alignment'
                          ? 'bg-primary/15 text-primary font-medium'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <span>Alignment</span>
                      {groupBy === 'alignment' && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                  </div>
                </div>
                <div className="border-t border-border my-2"></div>
                {/* Show Prices — pointless when shopping/prices are disabled */}
                {canShop && (
                <div className="px-3 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowPrices(!showPrices); }}
                    className="w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between text-foreground hover:bg-muted"
                  >
                    <span>Show Prices</span>
                    {showPrices && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </button>
                </div>
                )}
                {/* Ignore Legality Checks — hidden when the config disables
                    legality checks outright (no handler is passed). */}
                {onIgnoreLegalityChecksChange && (
                <div className="px-3 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onIgnoreLegalityChecksChange(!ignoreLegalityChecks); }}
                    className="w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between text-foreground hover:bg-muted"
                  >
                    <span>Ignore Legality Checks</span>
                    {ignoreLegalityChecks && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </button>
                </div>
                )}
                {/* Spotlight Mode (desktop only) */}
                {onSpotlightToggle && (
                  <div className="hidden md:block px-3 py-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSpotlightToggle(); setShowViewDropdown(false); }}
                      className="w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center gap-2 text-foreground hover:bg-muted"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Spotlight
                    </button>
                  </div>
                )}
                {/* Full Deck View (mobile only) */}
                <div className="border-t border-border my-2"></div>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowMobileFullDeckView(true); setShowViewDropdown(false); }}
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                  Full Deck View
                </button>
                <div className="h-4" />
              </div>
              {/* Desktop: positioned dropdown below button */}
              <div
                className="hidden md:block fixed z-[70] rounded-lg min-w-[220px] max-h-[70vh] overflow-y-auto bg-popover border border-border shadow-xl py-2"
                style={(() => {
                  const rect = viewDropdownBtnRef.current?.getBoundingClientRect();
                  if (!rect) return {};
                  return { top: rect.bottom + 4, right: window.innerWidth - rect.right };
                })()}
              >
                {/* Layout */}
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Layout</div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewLayout('grid'); }}
                      className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${
                        viewLayout === 'grid'
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                      title="Grid view"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                      </svg>
                      <span className="text-xs font-medium">Grid</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setViewLayout('list'); }}
                      className={`flex-1 p-2 rounded flex flex-col items-center gap-1 transition-colors ${
                        viewLayout === 'list'
                          ? 'bg-primary/15 text-primary'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                      title="List view"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                      </svg>
                      <span className="text-xs font-medium">List</span>
                    </button>
                  </div>
                </div>
                <div className="border-t border-border my-2"></div>
                {/* Card Hover Preview Toggle */}
                <div className="flex px-3 py-2 items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Card Hover Preview</span>
                  <Switch
                    checked={!disableHoverPreview}
                    onChange={toggleHoverPreview}
                    className={`${!disableHoverPreview ? 'bg-primary' : 'bg-muted'} relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${!disableHoverPreview ? 'translate-x-5' : 'translate-x-1'}`}
                    />
                  </Switch>
                </div>
                <div className="border-t border-border my-2"></div>
                {/* Group By */}
                <div className="px-3 py-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Group by</div>
                  <div className="space-y-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setGroupBy('type'); }}
                      className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                        groupBy === 'type'
                          ? 'bg-primary/15 text-primary font-medium'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <span>Type</span>
                      {groupBy === 'type' && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setGroupBy('alignment'); }}
                      className={`w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between ${
                        groupBy === 'alignment'
                          ? 'bg-primary/15 text-primary font-medium'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      <span>Alignment</span>
                      {groupBy === 'alignment' && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                    </button>
                  </div>
                </div>
                <div className="border-t border-border my-2"></div>
                {/* Show Prices — pointless when shopping/prices are disabled */}
                {canShop && (
                <div className="px-3 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowPrices(!showPrices); }}
                    className="w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between text-foreground hover:bg-muted"
                  >
                    <span>Show Prices</span>
                    {showPrices && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </button>
                </div>
                )}
                {/* Ignore Legality Checks — hidden when the config disables
                    legality checks outright (no handler is passed). */}
                {onIgnoreLegalityChecksChange && (
                <div className="px-3 py-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onIgnoreLegalityChecksChange(!ignoreLegalityChecks); }}
                    className="w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center justify-between text-foreground hover:bg-muted"
                  >
                    <span>Ignore Legality Checks</span>
                    {ignoreLegalityChecks && <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                  </button>
                </div>
                )}
                {/* Spotlight Mode */}
                {onSpotlightToggle && (
                  <div className="px-3 py-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSpotlightToggle(); setShowViewDropdown(false); }}
                      className="w-full px-3 py-2 text-left text-sm rounded transition-colors flex items-center gap-2 text-foreground hover:bg-muted"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Spotlight
                    </button>
                  </div>
                )}
                {/* Full Deck View */}
                <div className="border-t border-border my-2"></div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onToggleExpand) {
                      onToggleExpand();
                    }
                    setShowViewDropdown(false);
                  }}
                  className="w-full px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={isExpanded
                      ? "M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
                      : "M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                    } />
                  </svg>
                  {isExpanded ? 'Exit Full View' : 'Full Deck View'}
                </button>
              </div>
            </>,
            document.body
          )}

      {/* Content */}
      <div ref={contentRef} className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col ${isExpanded ? '' : 'p-4'}`} data-deck-grid>
        {/* Paragon Requirements (only show for Paragon format with a selected Paragon) */}
        {deckType === 'Paragon' && deck.paragon && validation.paragonStats && (activeTab === 'main' || activeTab === 'reserve') && (
          <div className="mb-4">
            <div className="p-3 md:p-4 bg-gradient-to-r from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-2 border-purple-300 dark:border-purple-600 rounded-xl shadow-md overflow-hidden">
              {/* Mobile: stack vertically. Desktop: side by side */}
              <div className="flex flex-col md:flex-row md:items-start gap-3 md:gap-4">
                {/* Paragon Card Artwork - Click to Expand */}
                <div className="flex items-center gap-3 md:block">
                  <div
                    className="relative group w-20 h-28 md:w-32 md:h-40 rounded-lg shadow-xl flex-shrink-0 cursor-pointer hover:scale-105 hover:shadow-2xl transition-transform overflow-hidden bg-muted border-2 border-border"
                    onClick={() => setShowParagonModal(true)}
                    title="Click to view full card"
                  >
                    <Image
                      src={`/paragons/Paragon ${deck.paragon}.png`}
                      alt={deck.paragon}
                      width={128}
                      height={180}
                      className="w-full h-full object-cover object-[1%_center]"
                      unoptimized
                    />
                    {/* Click Indicator Icon - Bottom Left */}
                    <div className="absolute bottom-1 left-1 md:bottom-2 md:left-2 bg-white/90 dark:bg-purple-600/90 rounded-full p-1 md:p-1.5 shadow-lg">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 text-purple-600 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                      </svg>
                    </div>
                  </div>
                  {/* Mobile: show paragon name + note inline next to image */}
                  <div className="md:hidden flex-1 min-w-0">
                    <span className="text-sm font-semibold text-purple-900 dark:text-purple-100">{deck.paragon} Requirements</span>
                    <p className="mt-1 text-xs text-purple-700 dark:text-purple-300">No Lost Souls. 40 Main, 10 Reserve. Max 7 Dominants.</p>
                  </div>
                </div>

                {/* Paragon Requirements */}
                <div className="flex-1 min-w-0">
                  <ParagonRequirements
                    paragonName={deck.paragon}
                    stats={validation.paragonStats}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Show Full Deck View when expanded */}
        {isExpanded ? (
          <div className="flex flex-col h-full">
            {/* View Controls */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border bg-card">
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setExpandedViewMode('stacked')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedViewMode === 'stacked'
                      ? 'bg-card text-card-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                >
                  Stacked
                </button>
                <button
                  onClick={() => setExpandedViewMode('normal')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedViewMode === 'normal'
                      ? 'bg-card text-card-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                >
                  Normal
                </button>
              </div>
              <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setExpandedGroupBy('type')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedGroupBy === 'type'
                      ? 'bg-card text-card-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                >
                  Type
                </button>
                <button
                  onClick={() => setExpandedGroupBy('alignment')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedGroupBy === 'alignment'
                      ? 'bg-card text-card-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                >
                  Align
                </button>
                <button
                  onClick={() => setExpandedGroupBy('none')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    expandedGroupBy === 'none'
                      ? 'bg-card text-card-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                >
                  None
                </button>
              </div>
              {/* Preview sidebar toggle */}
              <div className="hidden lg:block ml-auto">
                <button
                  onClick={toggleHoverPreview}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    !disableHoverPreview
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  title={disableHoverPreview ? 'Show card preview' : 'Hide card preview'}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {!disableHoverPreview ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M15.12 15.12L21 21" />
                    )}
                  </svg>
                  Preview
                </button>
              </div>
            </div>
            <div ref={setTagsBarContainer} className="relative z-10" />
            <div className="flex-1 overflow-auto">
              <FullDeckView
                deck={deck}
                onViewCard={onViewCard}
                isAuthenticated={isAuthenticated}
                viewMode={expandedViewMode}
                groupBy={expandedGroupBy}
                showPreview={!disableHoverPreview && !isDragging}
                tagsBarContainer={tagsBarContainer}
              />
            </div>
          </div>
        ) : (
          <>
        {activeTab === "main" ? (
          <Droppable
            id="zone:main"
            zone="main"
            onExternalDrop={(payload) => onAddCard(payload.name, payload.set, "main")}
            className={(isOver) =>
              `space-y-4 rounded transition-colors flex-1 min-h-[240px] ${
                isDragging ? "md:border-2 md:border-dashed md:border-border/40 md:-m-0.5" : ""
              } ${
                isOver ? "border-primary bg-primary/5" : ""
              }`
            }
          >
            {visibleMainCards.length > 0 ? (
              groupCards(visibleMainCards).map(({ type, cards, count }) => {
                const typeIcon = groupBy === 'type' ? getTypeIcon(type) : null;
                const dualIconConfig = groupBy === 'type' ? getDualIconConfig(type) : null;
                return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    {dualIconConfig ? (
                      <div className="flex gap-0.5 flex-shrink-0">
                        <img 
                          src={dualIconConfig.icon1} 
                          alt={dualIconConfig.alt1}
                          className="w-6 h-6 object-contain"
                        />
                        <img 
                          src={dualIconConfig.icon2} 
                          alt={dualIconConfig.alt2}
                          className="w-6 h-6 object-contain"
                        />
                      </div>
                    ) : typeIcon && (
                      <img 
                        src={typeIcon} 
                        alt={type}
                        className="w-6 h-6 object-contain flex-shrink-0"
                      />
                    )}
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {groupBy === 'type' ? prettifyTypeName(type) : type} ({count})
                    </h4>
                  </div>
                  <DeckCardList
                    cards={cards}
                    onIncrement={(name, set, zone) => onAddCard(name, set, zone)}
                    onDecrement={(name, set, zone) => onRemoveCard(name, set, zone)}
                    onRemove={(name, set, zone) => {
                      // Remove all copies
                      const card = deck.cards.find(
                        (dc) => dc.card.name === name && dc.card.set === set && dc.zone === zone
                      );
                      if (card) {
                        for (let i = 0; i < card.quantity; i++) {
                          onRemoveCard(name, set, zone);
                        }
                      }
                    }}
                    filterZone="main"
                    onViewCard={onViewCard}
                    onMoveCard={handleMoveCard}
                    showTypeIcons={false}
                    viewLayout={viewLayout}
                    showPrices={showPrices}
                    disableHoverPreview={disableHoverPreview || isDragging}
                  />
                </div>
              );
              })
            ) : mainDeckCards.length > 0 ? (
              noFilterMatches
            ) : (
              <div className="text-center py-12">
                <svg className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="text-muted-foreground text-sm">
                  No cards in main deck yet
                </p>
                <p className="text-muted-foreground text-xs mt-2 mb-4">
                  Search for cards and add them to your deck
                </p>
                {canImportExport && (
                <button
                  onClick={() => {
                    onImport();
                    // Focus the textarea after the modal opens
                    setTimeout(() => {
                      const textarea = document.getElementById('import-deck-textarea') as HTMLTextAreaElement;
                      if (textarea) {
                        textarea.focus();
                        textarea.select();
                      }
                    }, 150);
                  }}
                  className="px-4 py-2 border-2 border-primary bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Import or Paste from Clipboard
                </button>
                )}
              </div>
            )}
          </Droppable>
        ) : activeTab === "reserve" ? (
          <Droppable
            id="zone:reserve"
            zone="reserve"
            onExternalDrop={(payload) => onAddCard(payload.name, payload.set, "reserve")}
            className={(isOver) =>
              `space-y-4 rounded transition-colors flex-1 min-h-[240px] ${
                isDragging ? "md:border-2 md:border-dashed md:border-border/40 md:-m-0.5" : ""
              } ${
                isOver ? "border-primary bg-primary/5" : ""
              }`
            }
          >
            {visibleReserveCards.length > 0 ? (
              groupCards(visibleReserveCards).map(({ type, cards, count }) => {
                const typeIcon = groupBy === 'type' ? getTypeIcon(type) : null;
                const dualIconConfig = groupBy === 'type' ? getDualIconConfig(type) : null;
                return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    {dualIconConfig ? (
                      <div className="flex gap-0.5 flex-shrink-0">
                        <img 
                          src={dualIconConfig.icon1} 
                          alt={dualIconConfig.alt1}
                          className="w-6 h-6 object-contain"
                        />
                        <img 
                          src={dualIconConfig.icon2} 
                          alt={dualIconConfig.alt2}
                          className="w-6 h-6 object-contain"
                        />
                      </div>
                    ) : typeIcon && (
                      <img 
                        src={typeIcon} 
                        alt={type}
                        className="w-6 h-6 object-contain flex-shrink-0"
                      />
                    )}
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {groupBy === 'type' ? prettifyTypeName(type) : type} ({count})
                    </h4>
                  </div>
                  <DeckCardList
                    cards={cards}
                    onIncrement={(name, set, zone) => onAddCard(name, set, zone)}
                    onDecrement={(name, set, zone) => onRemoveCard(name, set, zone)}
                    onRemove={(name, set, zone) => {
                      // Remove all copies
                      const card = deck.cards.find(
                        (dc) => dc.card.name === name && dc.card.set === set && dc.zone === zone
                      );
                      if (card) {
                        for (let i = 0; i < card.quantity; i++) {
                          onRemoveCard(name, set, zone);
                        }
                      }
                    }}
                    filterZone="reserve"
                    onViewCard={onViewCard}
                    onMoveCard={handleMoveCard}
                    showTypeIcons={false}
                    viewLayout={viewLayout}
                    showPrices={showPrices}
                    disableHoverPreview={disableHoverPreview || isDragging}
                  />
                </div>
              );
              })
            ) : reserveCards.length > 0 ? (
              noFilterMatches
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground text-sm">
                  No cards in reserve yet
                </p>
                <p className="text-muted-foreground text-xs mt-2">
                  Use the <span className="font-medium">...</span> menu on cards to add to reserve
                </p>
              </div>
            )}
          </Droppable>
        ) : activeTab === "maybe" ? (
          <Droppable
            id="zone:maybeboard"
            zone="maybeboard"
            onExternalDrop={(payload) => onAddCard(payload.name, payload.set, "maybeboard")}
            className={(isOver) =>
              `space-y-4 rounded transition-colors flex-1 min-h-[240px] ${
                isDragging ? "md:border-2 md:border-dashed md:border-border/40 md:-m-0.5" : ""
              } ${
                isOver ? "border-primary bg-primary/5" : ""
              }`
            }
          >
            {visibleMaybeboardCards.length > 0 ? (
              groupCards(visibleMaybeboardCards).map(({ type, cards, count }) => {
                const typeIcon = groupBy === 'type' ? getTypeIcon(type) : null;
                const dualIconConfig = groupBy === 'type' ? getDualIconConfig(type) : null;
                return (
                <div key={type}>
                  <div className="flex items-center gap-2 mb-2">
                    {dualIconConfig ? (
                      <div className="flex gap-0.5 flex-shrink-0">
                        <img
                          src={dualIconConfig.icon1}
                          alt={dualIconConfig.alt1}
                          className="w-6 h-6 object-contain"
                        />
                        <img
                          src={dualIconConfig.icon2}
                          alt={dualIconConfig.alt2}
                          className="w-6 h-6 object-contain"
                        />
                      </div>
                    ) : typeIcon && (
                      <img
                        src={typeIcon}
                        alt={type}
                        className="w-6 h-6 object-contain flex-shrink-0"
                      />
                    )}
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {groupBy === 'type' ? prettifyTypeName(type) : type} ({count})
                    </h4>
                  </div>
                  <DeckCardList
                    cards={cards}
                    onIncrement={(name, set, zone) => onAddCard(name, set, zone)}
                    onDecrement={(name, set, zone) => onRemoveCard(name, set, zone)}
                    onRemove={(name, set, zone) => {
                      const card = deck.cards.find(
                        (dc) => dc.card.name === name && dc.card.set === set && dc.zone === zone
                      );
                      if (card) {
                        for (let i = 0; i < card.quantity; i++) {
                          onRemoveCard(name, set, zone);
                        }
                      }
                    }}
                    filterZone="maybeboard"
                    onViewCard={onViewCard}
                    onMoveCard={handleMoveCard}
                    showTypeIcons={false}
                    viewLayout={viewLayout}
                    showPrices={showPrices}
                    disableHoverPreview={disableHoverPreview || isDragging}
                  />
                </div>
              );
              })
            ) : maybeboardCards.length > 0 ? (
              noFilterMatches
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground text-sm">
                  No cards on the maybeboard yet
                </p>
                <p className="text-muted-foreground text-xs mt-2">
                  Drag cards here, or use the menu on a deck card to move it here.
                  The maybeboard is a scratchpad — it&apos;s excluded from legality, totals, and play.
                </p>
              </div>
            )}
          </Droppable>
        ) : activeTab === "cover" ? (
          // Details Tab (Cover Cards + Description)
          <div className="space-y-4 text-sm">
            <div>
              <h3 className="font-semibold text-foreground mb-2">Cover Cards</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Choose the two cards shown as the thumbnail on the community page.
              </p>
              <div className="flex gap-3 mb-3 justify-center">
                {([1, 2] as const).map((slot) => {
                  const imgFile = slot === 1 ? deck.previewCard1 : deck.previewCard2;
                  const imgUrl = imgFile ? getImageUrl(imgFile) : null;
                  return (
                    <div key={slot} className="flex flex-col items-center gap-1.5 w-36">
                      <button
                        onClick={() => setCoverPickerSlot(coverPickerSlot === slot ? null : slot)}
                        className={`relative w-full aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 transition-all ${
                          coverPickerSlot === slot
                            ? 'border-primary ring-2 ring-ring'
                            : 'border-border hover:border-primary/50'
                        } bg-muted`}
                        title={`Pick cover card ${slot}`}
                      >
                        {imgUrl ? (
                          <img src={imgUrl} alt={`Cover ${slot}`} className="w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                            <svg className="w-6 h-6 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                            </svg>
                            <span className="text-xs">Card {slot}</span>
                          </div>
                        )}
                      </button>
                      {imgFile && (
                        <button
                          onClick={() => setCoverPickerSlot(slot)}
                          className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-400"
                        >
                          Replace
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Card picker grid */}
              {coverPickerSlot !== null && (() => {
                const mainCards = deck.cards.filter(dc => dc.zone === 'main' && dc.quantity > 0);
                const filteredPickerCards = coverPickerSearch.trim()
                  ? mainCards.filter(dc => dc.card.name.toLowerCase().includes(coverPickerSearch.trim().toLowerCase()))
                  : mainCards;
                const sortedPickerCards = [...filteredPickerCards].sort((a, b) => {
                  switch (coverPickerSort) {
                    case "name":
                      return a.card.name.localeCompare(b.card.name);
                    case "type":
                      return (a.card.type || "").localeCompare(b.card.type || "") || a.card.name.localeCompare(b.card.name);
                    case "brigade":
                      return (a.card.brigade || "").localeCompare(b.card.brigade || "") || a.card.name.localeCompare(b.card.name);
                    default:
                      return compareCardsDefault(a.card, b.card);
                  }
                });
                return (
                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted border-b border-border flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Select card for slot {coverPickerSlot}
                      </span>
                      <div className="flex items-center gap-2">
                        <select
                          value={coverPickerSort}
                          onChange={(e) => setCoverPickerSort(e.target.value as any)}
                          className="text-xs px-1.5 py-0.5 border border-border rounded bg-card text-muted-foreground"
                        >
                          <option value="default">Default</option>
                          <option value="name">Name</option>
                          <option value="type">Type</option>
                          <option value="brigade">Brigade</option>
                        </select>
                        <button onClick={() => setCoverPickerSlot(null)} className="text-muted-foreground hover:text-foreground">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="px-3 py-2 border-b border-border">
                      <div className="relative">
                        <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                          type="text"
                          placeholder="Search cards..."
                          value={coverPickerSearch}
                          onChange={(e) => setCoverPickerSearch(e.target.value)}
                          className="w-full pl-7 pr-7 py-1 text-xs border border-border rounded bg-card focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                        {coverPickerSearch && (
                          <button onClick={() => setCoverPickerSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="p-2 grid grid-cols-4 gap-1.5">
                      {sortedPickerCards.map((dc) => (
                        <button
                          key={`${dc.card.name}|${dc.card.set}`}
                          onClick={() => {
                            const imgFile = dc.card.imgFile;
                            const c1 = coverPickerSlot === 1 ? imgFile : (deck.previewCard1 ?? null);
                            const c2 = coverPickerSlot === 2 ? imgFile : (deck.previewCard2 ?? null);
                            onPreviewCardsChange?.(c1, c2);
                            setCoverPickerSlot(null);
                          }}
                          className="relative aspect-[2.5/3.5] rounded overflow-hidden border border-border hover:border-blue-500 hover:scale-105 transition-all"
                          title={dc.card.name}
                        >
                          <CardThumb
                            card={dc.card}
                            alt={dc.card.name}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Tags Section */}
            {isAuthenticated && (
              <div className="mt-6 pt-4 border-t border-border">
                <h3 className="font-semibold text-foreground mb-2">Tags</h3>

                {!deck.id ? (
                  <p className="text-xs text-muted-foreground italic">Save your deck first to add tags.</p>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Current tag pills */}
                    {deckTags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => toggleTag(tag)}
                        className="group flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium transition-opacity"
                        style={{ backgroundColor: tag.color, color: getTagContrastColor(tag.color) }}
                        title={`Remove "${tag.name}"`}
                      >
                        {tag.name}
                        <svg
                          className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ))}

                    {/* Picker trigger */}
                    <div className="relative" ref={tagPickerRef}>
                      <button
                        onClick={() => { setTagPickerOpen((o) => !o); setTagFilter(""); setCreateMode(false); }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-border text-xs text-muted-foreground hover:border-foreground/60 hover:text-foreground transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {deckTags.length === 0 ? "Add tags" : "Edit"}
                        {savingTags && <span className="ml-1 opacity-60">·</span>}
                      </button>

                      {tagPickerOpen && (
                        <div className="absolute z-50 top-full mt-1.5 left-0 w-64 bg-popover border border-border rounded-xl shadow-xl">
                          {createMode ? (
                            <form onSubmit={handleCreateTagInBuilder} className="p-3 flex flex-col gap-3">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setCreateColorOpen((o) => !o)}
                                  className="w-7 h-7 rounded-md border-2 border-border shadow-sm flex-shrink-0 hover:scale-110 transition-transform"
                                  style={{ backgroundColor: createColor }}
                                />
                                <input
                                  autoFocus
                                  type="text"
                                  placeholder="Tag name"
                                  value={createName}
                                  onChange={(e) => setCreateName(e.target.value)}
                                  maxLength={50}
                                  className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                              </div>
                              {createColorOpen && (
                                <div className="flex flex-col items-center gap-1.5">
                                  <HexColorPicker color={createColor} onChange={setCreateColor} style={{ width: "100%" }} />
                                  <span className="font-mono text-xs text-muted-foreground">{createColor}</span>
                                </div>
                              )}
                              {createName.trim() && (
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">Preview:</span>
                                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: createColor, color: getTagContrastColor(createColor) }}>{createName}</span>
                                </div>
                              )}
                              {createError && <p className="text-xs text-red-500">{createError}</p>}
                              <div className="flex gap-2">
                                <button type="submit" disabled={creating || !createName.trim()} className="flex-1 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                  {creating ? "Creating…" : "Create tag"}
                                </button>
                                <button type="button" onClick={() => { setCreateMode(false); setCreateError(null); setCreateName(""); setCreateColorOpen(false); }} className="flex-1 py-1.5 border border-border text-sm rounded-lg hover:bg-muted">
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                              <div className="px-3 pt-3 pb-2 border-b border-border">
                                <input
                                  autoFocus
                                  type="text"
                                  placeholder="Filter tags…"
                                  value={tagFilter}
                                  onChange={(e) => setTagFilter(e.target.value)}
                                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                              </div>
                              <div className="max-h-52 overflow-y-auto">
                                {tagsLoading ? (
                                  <div className="flex justify-center py-4">
                                    <svg className="animate-spin w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                    </svg>
                                  </div>
                                ) : filteredGlobalTags.length === 0 ? (
                                  <p className="text-xs text-muted-foreground text-center py-4">
                                    {allGlobalTags.length === 0 ? "No tags available yet" : "No matches"}
                                  </p>
                                ) : (
                                  filteredGlobalTags.map((tag) => {
                                    const selected = deckTags.some((t) => t.id === tag.id);
                                    return (
                                      <button
                                        key={tag.id}
                                        onClick={() => toggleTag(tag)}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted transition-colors text-left"
                                      >
                                        <span className="w-4 flex-shrink-0 flex items-center justify-center">
                                          {selected && (
                                            <svg className="w-3.5 h-3.5 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                            </svg>
                                          )}
                                        </span>
                                        <span className="w-3 h-3 rounded-full flex-shrink-0 border border-black/10" style={{ backgroundColor: tag.color }} />
                                        <span className="text-sm text-popover-foreground">{tag.name}</span>
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                              {canManageTags && (
                                <div className="border-t border-border">
                                  <button
                                    onClick={() => { setCreateName(tagFilter); setCreateColor("#6366f1"); setCreateError(null); setCreateMode(true); }}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                  >
                                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    Create{tagFilter.trim() ? ` "${tagFilter.trim()}"` : " new tag"}
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Description Section */}
            <div className="mt-6 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-foreground">Description</h3>
                <div className="flex rounded-lg overflow-hidden border border-border">
                  <button
                    onClick={() => setDescriptionPreview(false)}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      !descriptionPreview
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDescriptionPreview(true)}
                    className={`px-3 py-1 text-xs font-medium transition-colors border-l border-border ${
                      descriptionPreview
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    Preview
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Add notes or strategy for your deck (supports Markdown). Type{" "}
                <kbd className="rounded bg-muted px-1 font-mono text-[11px] text-foreground">[[</kbd> to mention a card.
              </p>
              {descriptionPreview ? (
                <div className="w-full min-h-[16rem] p-3 text-sm border border-border rounded-lg bg-card text-card-foreground overflow-auto">
                  {deck.description ? (
                    /* draft: an author mid-edit should see which mentions found no card. */
                    <DeckDescription markdown={deck.description} draft />
                  ) : (
                    <p className="text-muted-foreground italic">No description yet</p>
                  )}
                </div>
              ) : (
                <CardMentionTextarea
                  textareaRef={descriptionRef}
                  value={deck.description || ""}
                  onChange={(v) => onDescriptionChange?.(v)}
                  placeholder="Deck strategy, card choices, matchup notes..."
                  className="w-full h-64 min-h-[16rem] p-3 text-sm border border-border rounded-lg bg-card text-card-foreground placeholder-muted-foreground resize-y focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
                />
              )}
            </div>
          </div>
        ) : (
          // Stats Tab
          <div className="space-y-4 text-sm">
            {/* Paragon Resources - Only show for Paragon format */}
            {deckType === 'Paragon' && (
              <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                <div className="flex items-start gap-2 mb-2">
                  <svg className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <div className="flex-1">
                    <h4 className="text-xs font-semibold text-purple-800 dark:text-purple-200 mb-2">
                      Paragon Format Resources
                    </h4>
                    <div className="space-y-1">
                      <a 
                        href={DOCS.paragonCards}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-purple-700 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 underline transition-colors"
                      >
                        Paragon Cards PDF
                      </a>
                      <a 
                        href={DOCS.paragonRules}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-purple-700 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 underline transition-colors"
                      >
                        Paragon Rules PDF
                      </a>
                      <a 
                        href={DOCS.paragonLostSoulsColor}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-purple-700 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 underline transition-colors"
                      >
                        Lost Souls (Color) PDF
                      </a>
                      <a 
                        href={DOCS.paragonLostSoulsBw}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-purple-700 dark:text-purple-300 hover:text-purple-600 dark:hover:text-purple-200 underline transition-colors"
                      >
                        Lost Souls (B&W) PDF
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            )}
            
            {/* Validation Status */}
            {ignoreLegalityChecks ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-sm text-muted-foreground">Legality checks disabled</p>
              </div>
            ) : (
              <DeckLegalityChecklist
                clientValidation={validation}
                serverResult={deckCheckResult ?? null}
                isChecking={isDeckChecking ?? false}
                totalCards={validation.stats.totalCards}
                format={deck.format}
              />
            )}

            {/* Alignment Breakdown */}
            <div>
              <h3 className="font-semibold text-foreground mb-3">
                Alignment Breakdown
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {(() => {
                  const isT2Format = deckType === 'T2';

                  // Calculate raw alignment counts. Maybeboard is a scratchpad
                  // and never rolls into deck composition.
                  const alignmentCounts = deck.cards.reduce((acc, deckCard) => {
                    if (deckCard.zone === 'maybeboard') return acc;
                    let alignment = deckCard.card.alignment || "Neutral";
                    if (alignment.includes("Good/Evil")) {
                      alignment = "Neutral";
                    }
                    if (!acc[alignment]) {
                      acc[alignment] = 0;
                    }
                    acc[alignment] += deckCard.quantity;
                    return acc;
                  }, {} as Record<string, number>);

                  // For T2: calculate deck-building balance counts (with dual-alignment resolution)
                  // to show as a subtitle when they differ from raw counts
                  let balanceGood = 0;
                  let balanceEvil = 0;
                  if (isT2Format) {
                    for (const dc of deck.cards.filter(c => c.zone === 'main')) {
                      const a = dc.card.alignment || "";
                      if (a.includes("Good") && a.includes("Evil")) continue; // Good/Evil = neutral
                      if (a.includes("Good") && a.includes("Neutral")) { balanceGood += dc.quantity; continue; }
                      if (a.includes("Evil") && a.includes("Neutral")) { balanceEvil += dc.quantity; continue; }
                      if (a.includes("Good")) balanceGood += dc.quantity;
                      else if (a.includes("Evil")) balanceEvil += dc.quantity;
                    }
                  }

                  const alignmentConfig = [
                    { name: 'Good', color: 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300' },
                    { name: 'Evil', color: 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300' },
                    { name: 'Neutral', color: 'bg-muted border-border text-foreground' },
                    { name: 'Dual', color: 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300' },
                  ];

                  return alignmentConfig.map(({ name, color }) => {
                    const count = alignmentCounts[name] || 0;
                    if (count === 0 && name === 'Dual') return null;

                    // Show deck-building count subtitle for T2 when it differs from raw count
                    const balanceCount = name === 'Good' ? balanceGood : name === 'Evil' ? balanceEvil : null;
                    const showBalance = isT2Format && balanceCount !== null && balanceCount !== count;

                    return (
                      <div
                        key={name}
                        className={`p-3 rounded-lg border-2 ${color}`}
                      >
                        <div className="text-xs font-semibold uppercase tracking-wide mb-1">
                          {name}
                        </div>
                        <div className="text-2xl font-bold">
                          {count}
                        </div>
                        {showBalance && (
                          <div className={`text-[10px] mt-0.5 ${balanceGood !== balanceEvil ? 'text-red-400' : 'opacity-60'}`}>
                            {balanceCount} in main deck
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
                <AodCountCard deck={deck} deckType={FORMATS[deckType].family} />
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-foreground mb-2">
                Deck Statistics
              </h3>
              <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Total Cards:</span>
                  <span className="font-medium">{totalCards}</span>
                </div>
                <div className="flex justify-between">
                  <span>Unique Cards:</span>
                  <span className="font-medium">{statCards(deck.cards).length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Main Deck:</span>
                  <span className="font-medium">{mainDeckCount}</span>
                </div>
                {reserveCount > 0 && (
                  <div className="flex justify-between">
                    <span>Reserve:</span>
                    <span className="font-medium">{reserveCount}</span>
                  </div>
                )}
                <div className="border-t border-border my-2 pt-2">
                  <div className="flex justify-between">
                    <span>Lost Souls:</span>
                    <span className={`font-medium ${
                      validation.stats.lostSoulCount < validation.stats.requiredLostSouls
                        ? "text-red-600 dark:text-red-400"
                        : validation.stats.lostSoulCount > validation.stats.requiredLostSouls
                        ? "text-red-600 dark:text-red-400"
                        : "text-green-600 dark:text-green-400"
                    }`}>
                      {validation.stats.lostSoulCount}/{validation.stats.requiredLostSouls}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dominants:</span>
                    <span className="font-medium">{validation.stats.dominantCount}</span>
                  </div>
                </div>

                {/* Deck Price */}
                {totalDeckPrice !== null && (
                  <div className="border-t border-border my-2 pt-2">
                    <button
                      onClick={() => { setBuyModalMode("exact"); setShowBuyDeckModal(true); }}
                      className="flex justify-between w-full text-left hover:bg-muted -mx-1 px-1 py-0.5 rounded transition-colors group"
                    >
                      <span className="flex items-center gap-1.5">
                        <img src="/sponsors/ytg-dark.png" alt="" className="h-3.5 w-3.5 object-contain hidden dark:block" />
                        <img src="/sponsors/ytg-light.png" alt="" className="h-3.5 w-3.5 object-contain dark:hidden" />
                        Est. Price:
                      </span>
                      <span className="font-medium text-green-600 dark:text-green-400 group-hover:underline">${totalDeckPrice.toFixed(2)}</span>
                    </button>
                  </div>
                )}
                {savings !== null && budgetTotal !== null && (
                  <button
                    onClick={() => { setBuyModalMode("budget"); setShowBuyDeckModal(true); }}
                    className="flex justify-between w-full text-left hover:bg-muted -mx-1 px-1 py-0.5 rounded transition-colors group -mt-1 mb-1"
                  >
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="w-3.5" />
                      Min:
                    </span>
                    <span className="text-xs">
                      <span className="text-green-600 dark:text-green-400 group-hover:underline">${budgetTotal.toFixed(2)}</span>
                      <span className="text-muted-foreground ml-1">(save ${savings.toFixed(2)})</span>
                    </span>
                  </button>
                )}

                {/* Card Type Breakdown */}
                <div className="border-t border-border my-2 pt-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Card Types
                  </div>
                  <div className="space-y-0.5">
                    {(() => {
                      // Calculate card type counts. Maybeboard is a scratchpad
                      // and never rolls into deck composition.
                      const typeCounts = deck.cards.reduce((acc, deckCard) => {
                        if (deckCard.zone === 'maybeboard') return acc;
                        const type = deckCard.card.type || "Unknown";
                        const prettyType = prettifyTypeName(type);
                        if (!acc[prettyType]) {
                          acc[prettyType] = 0;
                        }
                        acc[prettyType] += deckCard.quantity;
                        return acc;
                      }, {} as Record<string, number>);

                      // Sort by count (descending) then by name
                      const sortedTypes = Object.entries(typeCounts)
                        .sort(([nameA, countA], [nameB, countB]) => {
                          if (countB !== countA) return countB - countA;
                          return nameA.localeCompare(nameB);
                        });

                      return sortedTypes.map(([type, count]) => (
                        <div key={type} className="flex justify-between gap-2 text-sm">
                          <span className="flex-shrink-0">{type}:</span>
                          <span className="font-medium ml-auto">{count}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                {/* Brigade Breakdown */}
                <div className="border-t border-border my-2 pt-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Brigades
                  </div>
                  <div className="space-y-0.5">
                    {(() => {
                      const brigadeCounts = countBy(deck.cards, (deckCard) => {
                        const raw = deckCard.card.brigade;
                        if (!raw) return null;
                        try {
                          return normalizeBrigadeField(raw, deckCard.card.alignment || "", deckCard.card.name);
                        } catch {
                          // Fallback for cards that fail normalization
                          return raw;
                        }
                      });

                      const sorted = Object.entries(brigadeCounts)
                        .sort(([, a], [, b]) => b - a);

                      return sorted.map(([brigade, count]) => (
                        <div key={brigade} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-1.5 flex-shrink-0">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 border border-black/10 dark:border-white/20"
                              style={{ backgroundColor: getBrigadeColor(brigade) }}
                            />
                            {brigade}:
                          </span>
                          <span className="font-medium ml-auto">{count}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              <div>Created: {deck.createdAt.toLocaleDateString()}</div>
              <div>Updated: {deck.updatedAt.toLocaleString()}</div>
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {/* Generate PDF Modal */}
      {showGeneratePDFModal && (
        <GeneratePDFModal
          deck={deck}
          onClose={() => setShowGeneratePDFModal(false)}
          isLegal={ignoreLegalityChecks ? null : (deckCheckResult?.valid ?? null)}
        />
      )}

      {/* Generate Image Modal */}
      {showGenerateImageModal && (
        <GenerateDeckImageModal
          deck={deck}
          onClose={() => setShowGenerateImageModal(false)}
          isLegal={ignoreLegalityChecks ? null : (deckCheckResult?.valid ?? null)}
        />
      )}

      {/* Delete Deck Modal */}
      {showDeleteDeckModal && (
        <ClearDeckModal
          deckName={deck.name}
          onConfirm={() => {
            onDelete();
            setShowDeleteDeckModal(false);
          }}
          onClose={() => setShowDeleteDeckModal(false)}
        />
      )}

      {/* Buy Deck Modal */}
      {showBuyDeckModal && (
        <BuyDeckModal
          cards={buyCards ?? deck.cards.map(dc => ({
            card_name: dc.card.name,
            card_key: `${dc.card.name}|${dc.card.set}|${dc.card.imgFile}`,
            quantity: dc.quantity,
            zone: dc.zone,
          }))}
          onClose={() => { setShowBuyDeckModal(false); setBuyCards(null); }}
          initialMode={buyModalMode}
        />
      )}

      {showCollectionCheckModal && (
        <CollectionCheckModal
          cards={deck.cards.map(dc => ({
            card_name: dc.card.name,
            card_key: `${dc.card.name}|${dc.card.set}|${dc.card.imgFile}`,
            quantity: dc.quantity,
            zone: dc.zone,
          }))}
          ownedByName={aggregateOwnedByName(collectionQuantities ?? new Map())}
          collectionAvailable={collectionAvailable}
          collectionSyncError={collectionSyncError}
          onClose={() => setShowCollectionCheckModal(false)}
          onBuyMissing={(missing) => {
            setShowCollectionCheckModal(false);
            setBuyCards(missing);
            setBuyModalMode("exact");
            setShowBuyDeckModal(true);
          }}
        />
      )}

      {/* Load Deck Modal */}
      {showLoadDeckModal && onLoadDeck && (
        <LoadDeckModal
          onLoadDeck={onLoadDeck}
          onClose={() => setShowLoadDeckModal(false)}
          listDecks={builderConfig.persistence?.listDecks}
        />
      )}

      {showReplaceGoodModal && onReplaceGood && (
        <LoadDeckModal
          title="Replace Good"
          subtitle="Choose a deck to copy its good cards from"
          matchFormat={deck.format}
          onLoadDeck={(sourceDeckId) => onReplaceGood(sourceDeckId)}
          onClose={() => setShowReplaceGoodModal(false)}
        />
      )}

      {showReplaceEvilModal && onReplaceEvil && (
        <LoadDeckModal
          title="Replace Evil"
          subtitle="Choose a deck to copy its evil cards from"
          matchFormat={deck.format}
          onLoadDeck={(sourceDeckId) => onReplaceEvil(sourceDeckId)}
          onClose={() => setShowReplaceEvilModal(false)}
        />
      )}

      {/* Paragon Card Modal */}
      {showParagonModal && deck.paragon && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowParagonModal(false)}
        >
          <div 
            className="relative max-w-4xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setShowParagonModal(false)}
              className="absolute -top-4 -right-4 w-10 h-10 bg-card rounded-full shadow-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors z-10"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            {/* Paragon Card Image - Full Size */}
            <Image
              src={`/paragons/Paragon ${deck.paragon}.png`}
              alt={deck.paragon}
              width={800}
              height={1120}
              className="w-full h-auto rounded-lg shadow-2xl"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
        </div>
      )}

      {/* Share / visibility modal. A config-supplied modal (the Forge's
          member-only share) replaces the public one outright — the public
          modal writes public visibility, which Forge decks must never do. */}
      {renderShareModal && deck.id ? (
        renderShareModal({
          open: showShareModal,
          onOpenChange: setShowShareModal,
          deckId: deck.id,
          deckName: deck.name,
        })
      ) : canShare && deck.id ? (
        <ShareDeckModal
          open={showShareModal}
          onOpenChange={setShowShareModal}
          deckId={deck.id}
          deckName={deck.name}
          visibility={currentVisibility}
          onSetVisibility={handleSelectVisibility}
        />
      ) : null}

      {/* Username Modal */}
      {showUsernameModal && (
        <UsernameModal
          onSuccess={async () => {
            setShowUsernameModal(false);
            if (deck.id) {
              const result = await setDeckVisibilityAction(deck.id, "public");
              if (result.success) {
                onDeckVisibilityChange?.("public");
                onDeckPublicChange?.(true);
                onNotify?.('Deck is now public', 'success');
              } else {
                onNotify?.(result.error || 'Failed to change visibility', 'error');
              }
            }
          }}
          onClose={() => setShowUsernameModal(false)}
        />
      )}

      {/* Mobile Full Deck View Overlay — portaled to body to escape stacking contexts */}
      {showMobileFullDeckView && createPortal(
        <div className="md:hidden fixed inset-0 z-[100] bg-background flex flex-col pt-[env(safe-area-inset-top)]">
          {/* Header + View Controls — single compact row */}
          <div className="flex-shrink-0 flex items-center gap-1.5 px-2 py-2 border-b border-border bg-card">
            <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setExpandedViewMode('stacked')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedViewMode === 'stacked'
                    ? 'bg-card text-card-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                Stack
              </button>
              <button
                onClick={() => setExpandedViewMode('normal')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedViewMode === 'normal'
                    ? 'bg-card text-card-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                Normal
              </button>
            </div>
            <div className="flex items-center gap-0.5 bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setExpandedGroupBy('type')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedGroupBy === 'type'
                    ? 'bg-card text-card-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                Type
              </button>
              <button
                onClick={() => setExpandedGroupBy('alignment')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedGroupBy === 'alignment'
                    ? 'bg-card text-card-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                Align
              </button>
              <button
                onClick={() => setExpandedGroupBy('none')}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                  expandedGroupBy === 'none'
                    ? 'bg-card text-card-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                None
              </button>
            </div>
            <button
              onClick={() => { setShowMobileFullDeckView(false); setFullViewPreviewCard(null); }}
              className="ml-auto flex-shrink-0 w-8 h-8 flex items-center justify-center bg-red-600 hover:bg-red-700 rounded-full text-white"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {/* Deck Content */}
          <div className="flex-1 overflow-auto">
            <FullDeckView
              deck={deck}
              onViewCard={(card) => setFullViewPreviewCard(card)}
              isAuthenticated={isAuthenticated}
              viewMode={expandedViewMode}
              groupBy={expandedGroupBy}
            />
          </div>

          {/* Card Preview Overlay */}
          {fullViewPreviewCard && (
            <div
              className="absolute inset-0 z-10 bg-black/70 flex items-center justify-center p-6"
              onClick={() => setFullViewPreviewCard(null)}
            >
              <div className="relative max-w-[300px] w-full" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setFullViewPreviewCard(null)}
                  aria-label="Close card preview"
                  className="absolute -top-3 -right-3 z-10 w-8 h-8 rounded-full bg-gray-800 border border-gray-600 text-white flex items-center justify-center hover:bg-gray-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <CardThumb
                  card={fullViewPreviewCard}
                  alt={fullViewPreviewCard.name}
                  className="w-full rounded-lg shadow-2xl"
                />
              </div>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
    {/* DragOverlay: card ghost that follows the pointer during a drag.
        Default dropAnimation lets unresolved drops snap back to the source. */}
    <DragOverlay>
      {activeDragCard ? <DragGhost card={activeDragCard} willRemove={willRemoveOnDrop} /> : null}
    </DragOverlay>
    </DndContext>
  );
}
