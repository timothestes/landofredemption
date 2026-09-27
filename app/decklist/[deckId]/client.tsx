"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { copyPublicDeckAction, updateDeckPreviewCardsAction, renameDeckAction, updateDeckDescriptionAction, updateDeckTagsAction, loadGlobalTagsAction, recordDeckViewAction, GlobalTag, DeckCardData } from "../actions";
import { createGlobalTagAction } from "../../admin/tags/actions";
import { HexColorPicker } from "react-colorful";
import { useIsAdmin } from "../../../hooks/useIsAdmin";
import { Card } from "../card-search/utils";
import { CARD_BY_FULL_KEY } from "../card-search/data/cardIndex";
import ModalWithClose from "../card-search/ModalWithClose";
import { GoldfishButton } from "../../goldfish/components/GoldfishButton";
import { sanitizeImgFile, getCardImageUrl as getImageUrl } from '../../shared/utils/cardImageUrl';
import { useCardPrices } from "../card-search/hooks/useCardPrices";
import { useCollectionState } from "../../collection/hooks/useCollectionState";
import BuyDeckModal, { type BuyDeckCard } from "../card-search/components/BuyDeckModal";
import CollectionCheckModal from "../card-search/components/CollectionCheckModal";
import { aggregateOwnedByName } from "../card-search/utils/collectionCheck";
import { statCards, countBy, sumQuantity } from "../card-search/utils/deckStats";
import GeneratePDFModal from "../card-search/components/GeneratePDFModal";
import GenerateDeckImageModal from "../card-search/components/GenerateDeckImageModal";
import AodCountCard from "../card-search/components/AodCountCard";
import { Deck as DeckType } from "../card-search/types/deck";
import { generateDeckText } from "../card-search/utils/deckImportExport";
import CardTile from "@/components/ui/CardTile";
import CardMentionTextarea from "@/components/ui/CardMentionTextarea";
import DeckDescription from "../components/DeckDescription";
import { compareCardsByType, compareCardsDefault, compareTypeGroups, type SortableCard } from "@/lib/cards/defaultSort";
import { prettifyTypeName, getGroupKey, getGroupDisplayName } from "@/lib/decks/typeGroups";
import { getFormatDef } from "@/lib/formats";
import { TrophyIcon, getPlacementLabel } from "@/components/trophy-icon";
import type { DeckTournamentContext } from "../deckTournamentContext";

interface PublicDeckData {
  id: string;
  name: string;
  description?: string;
  format?: string;
  paragon?: string;
  is_public?: boolean;
  is_legal?: boolean | null;
  card_count?: number;
  view_count?: number;
  preview_card_1?: string | null;
  preview_card_2?: string | null;
  username?: string | null;
  created_at: string;
  updated_at: string;
  cards: DeckCardData[];
  tags?: GlobalTag[];
  total_price?: number | null;
  budget_price?: number | null;
  tournament?: DeckTournamentContext | null;
}

function formatEventDate(endedAt: string | null): string | null {
  if (!endedAt) return null;
  return new Date(endedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Same podium tones the community grid uses on its placement badge.
function getPlacementToneClass(place: number): string {
  if (place === 1) return "text-yellow-700 dark:text-yellow-300";
  if (place === 2) return "text-foreground";
  if (place === 3) return "text-orange-700 dark:text-orange-300";
  return "text-muted-foreground";
}

function BreadcrumbChevron() {
  return (
    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#1f2937" : "#ffffff";
}

interface Props {
  deck: PublicDeckData;
  isOwner: boolean;
  isLoggedIn: boolean;
}

// Enriched card with full Card data from the card database
interface EnrichedCard extends DeckCardData {
  type: string;
  alignment: string;
  brigade: string;
  fullCard: Card | null;
}

// Adapt an enriched deck card for the canonical default comparator.
// Strength/reference only live on the full card record when we resolved one.
function toSortable(c: EnrichedCard): SortableCard {
  return {
    name: c.card_name,
    type: c.type,
    brigade: c.brigade,
    alignment: c.alignment,
    strength: c.fullCard?.strength,
    reference: c.fullCard?.reference,
  };
}

function formatDeckType(format?: string): string {
  return getFormatDef(format).id;
}

function getDeckTypeBadgeClasses(format?: string): string {
  const deckType = formatDeckType(format);
  if (deckType === "T2") {
    return "px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded-full text-sm font-semibold";
  }
  if (deckType === "Paragon") {
    return "px-3 py-1 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded-full text-sm font-semibold";
  }
  if (deckType === "Limited") {
    return "px-3 py-1 bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 rounded-full text-sm font-semibold";
  }
  return "px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-semibold";
}

export default function PublicDeckClient({ deck, isOwner, isLoggedIn }: Props) {
  const router = useRouter();
  const { isAdmin, permissions } = useIsAdmin();
  const canManageTags = isAdmin && permissions.includes('manage_tags');
  const [linkCopied, setLinkCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyResult, setCopyResult] = useState<{ success: boolean; message: string } | null>(null);
  const [cardDatabase, setCardDatabase] = useState<Map<string, Card> | null>(null);
  const [modalCard, setModalCard] = useState<Card | null>(null);
  // Logged-in users can manage their collection from the card modal here too
  const {
    quantities: collectionQuantities,
    isAvailable: collectionAvailable,
    syncError: collectionSyncError,
    adjustQuantity: adjustCollectionQuantity,
  } = useCollectionState({ enabled: isLoggedIn });
  const [viewMode, setViewMode] = useState<"normal" | "stacked">("normal");
  const [groupBy, setGroupBy] = useState<"type" | "alignment" | "none">("type");
  // Maybeboard is a scratchpad, so it gets its own tab rather than trailing the
  // real deck. The tab bar only appears when there is a maybeboard to show.
  const [deckTab, setDeckTab] = useState<"deck" | "considering">("deck");
  const [showParagonModal, setShowParagonModal] = useState(false);
  const [paragonVisible, setParagonVisible] = useState(true);

  // Hover preview state (desktop only)
  const [hoveredCard, setHoveredCard] = useState<{ name: string; imgFile: string; set?: string; type?: string } | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [showBuyDeckModal, setShowBuyDeckModal] = useState(false);
  const [buyModalMode, setBuyModalMode] = useState<"exact" | "budget">("exact");
  const [showCollectionCheckModal, setShowCollectionCheckModal] = useState(false);
  // When set, the buy modal opens seeded with just these (missing) cards.
  const [buyCards, setBuyCards] = useState<BuyDeckCard[] | null>(null);
  const [showPDFModal, setShowPDFModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Card prices
  const { getPrice, getProductUrl } = useCardPrices();

  // Tournament provenance. Present only on published tournament copies, where
  // it — not the deck row — carries the identity of this decklist.
  const tournament = deck.tournament ?? null;

  // Count this visit once per tab session. Owners never count, and the write
  // lives here rather than in the server load so link-unfurl bots, which only
  // reach generateMetadata, do not inflate it.
  useEffect(() => {
    if (isOwner) return;
    const key = `viewed-deck:${deck.id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Blocked storage: still record the view, just without the dedupe.
    }
    recordDeckViewAction(deck.id).catch(() => {});
  }, [deck.id, isOwner]);

  // Inline name editing (owner only)
  const [deckName, setDeckName] = useState(deck.name);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(deck.name);

  async function handleNameSubmit() {
    const trimmed = nameInput.trim();
    setEditingName(false);
    if (!trimmed || trimmed === deckName) { setNameInput(deckName); return; }
    setDeckName(trimmed);
    const result = await renameDeckAction(deck.id, trimmed);
    if (!result.success) setDeckName(deckName); // revert on failure
  }

  // Description editing (owner only)
  const [description, setDescription] = useState(deck.description || "");
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState(deck.description || "");
  const [savingDescription, setSavingDescription] = useState(false);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize description textarea to fit content
  useEffect(() => {
    const el = descriptionTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [descriptionInput, editingDescription]);

  async function handleDescriptionSubmit() {
    setEditingDescription(false);
    if (descriptionInput === description) return;
    setSavingDescription(true);
    setDescription(descriptionInput);
    const result = await updateDeckDescriptionAction(deck.id, descriptionInput);
    setSavingDescription(false);
    if (!result.success) setDescription(description); // revert on failure
  }

  // Tags
  const [deckTags, setDeckTags] = useState<GlobalTag[]>(deck.tags || []);
  const [allGlobalTags, setAllGlobalTags] = useState<GlobalTag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsLoadError, setTagsLoadError] = useState<string | null>(null);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const tagPickerRef = useRef<HTMLDivElement>(null);

  // Load global tag list when the picker opens (retry on each open if load hasn't succeeded)
  useEffect(() => {
    if (!isOwner || !tagPickerOpen) return;
    if (allGlobalTags.length > 0) return;
    let cancelled = false;
    setTagsLoading(true);
    setTagsLoadError(null);
    (async () => {
      try {
        const { createClient } = await import("../../../utils/supabase/client");
        const supabase = createClient();
        const { data, error } = await supabase
          .from("global_tags")
          .select("id, name, color")
          .order("name");
        if (cancelled) return;
        if (error) {
          setTagsLoadError(error.message || "Failed to load tags");
        } else if (data) {
          setAllGlobalTags(data as GlobalTag[]);
        }
      } catch (err) {
        if (cancelled) return;
        setTagsLoadError(err instanceof Error ? err.message : "Network error");
      } finally {
        if (!cancelled) setTagsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOwner, tagPickerOpen, allGlobalTags.length]);

  // Close picker on outside click
  useEffect(() => {
    if (!tagPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setTagPickerOpen(false);
        setTagFilter("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tagPickerOpen]);

  const toggleTag = useCallback(async (tag: GlobalTag) => {
    const isSelected = deckTags.some((t) => t.id === tag.id);
    const next = isSelected
      ? deckTags.filter((t) => t.id !== tag.id)
      : [...deckTags, tag];
    setDeckTags(next);
    setSavingTags(true);
    await updateDeckTagsAction(deck.id, next.map((t) => t.id));
    setSavingTags(false);
  }, [deckTags, deck.id]);

  const filteredGlobalTags = allGlobalTags.filter((t) =>
    t.name.toLowerCase().includes(tagFilter.toLowerCase())
  );

  // Inline create tag form (admin only, inside the picker)
  const [createMode, setCreateMode] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#6366f1");
  const [createColorOpen, setCreateColorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  async function handleCreateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreateError(null);
    setCreating(true);
    const res = await createGlobalTagAction(createName.trim(), createColor);
    setCreating(false);
    if (!res.success) {
      setCreateError(res.error || "Failed to create tag");
      return;
    }
    const newTag = res.tag as GlobalTag;
    // Add to global list and immediately apply to deck
    setAllGlobalTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)));
    const next = [...deckTags, newTag];
    setDeckTags(next);
    setSavingTags(true);
    await updateDeckTagsAction(deck.id, next.map((t) => t.id));
    setSavingTags(false);
    setCreateMode(false);
    setCreateName("");
    setCreateColor("#6366f1");
    setCreateError(null);
    setTagFilter("");
  }

  // Cover card editor (owner only)
  const [previewCard1, setPreviewCard1] = useState<string | null>(deck.preview_card_1 ?? null);
  const [previewCard2, setPreviewCard2] = useState<string | null>(deck.preview_card_2 ?? null);
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);
  const [coverPickerSlot, setCoverPickerSlot] = useState<1 | 2 | null>(null);
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverSaved, setCoverSaved] = useState(false);
  const [coverPickerSort, setCoverPickerSort] = useState<"default" | "name" | "type" | "brigade">("type");
  const [coverPickerSearch, setCoverPickerSearch] = useState("");

  useEffect(() => {
    if (!coverEditorOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setCoverEditorOpen(false); setCoverPickerSlot(null); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [coverEditorOpen]);

  // Populate from the module-scope index (built once per bundle load)
  useEffect(() => {
    setCardDatabase(CARD_BY_FULL_KEY as Map<string, Card>);
  }, []);

  // Enrich cards with full card data
  const enrichedCards = useMemo<EnrichedCard[]>(() => {
    return deck.cards.map((card) => {
      if (!cardDatabase) {
        return { ...card, type: "", alignment: "", brigade: "", fullCard: null };
      }
      const key = `${card.card_name}|${card.card_set}|${sanitizeImgFile(card.card_img_file || "")}`;
      const fullCard = cardDatabase.get(key) || null;
      return {
        ...card,
        type: fullCard?.type || "",
        alignment: fullCard?.alignment || "",
        brigade: fullCard?.brigade || "",
        fullCard,
      };
    });
  }, [deck.cards, cardDatabase]);

  // Build Deck object for PDF/Image modals
  const deckForModal: DeckType = useMemo(() => ({
    id: deck.id,
    name: deck.name,
    description: deck.description || "",
    format: deck.format,
    cards: enrichedCards.map((c) => ({
      card: c.fullCard || ({
        name: c.card_name,
        set: c.card_set || "",
        imgFile: c.card_img_file || "",
        dataLine: "", officialSet: "", type: "", brigade: "",
        strength: "", toughness: "", class: "", identifier: "",
        specialAbility: "", rarity: "", reference: "", alignment: "",
        legality: "", testament: "", isGospel: false,
      } as Card),
      quantity: c.quantity,
      zone: c.zone,
    })),
    createdAt: new Date(deck.created_at),
    updatedAt: new Date(deck.updated_at),
  }), [deck, enrichedCards]);

  const mainCards = enrichedCards.filter((c) => c.zone === 'main');
  const reserveCards = enrichedCards.filter((c) => c.zone === 'reserve');
  const maybeboardCards = enrichedCards.filter((c) => c.zone === 'maybeboard');
  const mainDeckCount = mainCards.reduce((sum, c) => sum + c.quantity, 0);
  const reserveCount = reserveCards.reduce((sum, c) => sum + c.quantity, 0);
  const maybeboardCount = maybeboardCards.reduce((sum, c) => sum + c.quantity, 0);

  const totalDeckPrice = useMemo(() => {
    let total = 0;
    let hasAnyPrice = false;
    // Maybeboard is a scratchpad — it never counts toward the deck's price.
    for (const card of statCards(enrichedCards)) {
      const priceKey = `${card.card_name}|${card.card_set}|${sanitizeImgFile(card.card_img_file || "")}`;
      const priceInfo = getPrice(priceKey);
      if (priceInfo) {
        total += priceInfo.price * card.quantity;
        hasAnyPrice = true;
      }
    }
    return hasAnyPrice ? total : null;
  }, [enrichedCards, getPrice]);

  // Group and sort cards based on current groupBy setting
  const groupedMainCards = useMemo(() => {
    return groupAndSortCards(mainCards, groupBy);
  }, [mainCards, groupBy]);

  const sortedReserveCards = useMemo(() => {
    return [...reserveCards].sort((a, b) => compareCardsByType(toSortable(a), toSortable(b)));
  }, [reserveCards]);

  const sortedMaybeboardCards = useMemo(() => {
    return [...maybeboardCards].sort((a, b) => compareCardsByType(toSortable(a), toSortable(b)));
  }, [maybeboardCards]);

  // Build flat list of Card objects for modal navigation. Scoped to the visible
  // tab so the modal's arrows never walk into cards that aren't on screen.
  const allCardsForNav = useMemo<Card[]>(() => {
    const allEnriched = deckTab === "considering"
      ? sortedMaybeboardCards
      : [...Object.values(groupedMainCards).flat(), ...sortedReserveCards];
    return allEnriched
      .filter((c) => c.fullCard)
      .map((c) => c.fullCard!);
  }, [deckTab, groupedMainCards, sortedReserveCards, sortedMaybeboardCards]);

  async function handleCopyLink() {
    const url = `${window.location.origin}/decklist/${deck.id}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handleCopyToLibrary() {
    setCopying(true);
    setCopyResult(null);
    const result = await copyPublicDeckAction(deck.id);
    setCopying(false);
    if (result.success && result.deckId) {
      router.push(`/decklist/card-search?deckId=${result.deckId}`);
    } else {
      setCopyResult({
        success: false,
        message: result.error === "You must be logged in to copy a deck"
          ? "Sign in to copy this deck to your library"
          : result.error || "Failed to copy deck",
      });
    }
  }

  function handleOpenInBuilder() {
    router.push(`/decklist/card-search?deckId=${deck.id}`);
  }

  function handleDownloadTxt() {
    // Use the canonical generator so the public-page export matches the
    // builder's format — including the `Tokens:` section with
    // `# auto-generated` and `# maybeboard` markers required for round-trip.
    const text = generateDeckText(deckForModal);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${deck.name.replace(/\s+/g, "_")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className={`w-full mx-auto py-8 jayden-gradient-bg ${viewMode === "stacked" ? "max-w-full px-2" : "max-w-7xl px-4"}`}>
      {/* Card detail modal — no add/remove buttons */}
      {modalCard && (
        <ModalWithClose
          modalCard={modalCard}
          setModalCard={setModalCard}
          visibleCards={allCardsForNav}
          onAddCard={null}
          onRemoveCard={null}
          getCardQuantity={null}
          legalityFilter={null}
          allCards={allCardsForNav}
          collectionQuantities={collectionAvailable ? collectionQuantities : null}
          onAdjustCollection={collectionAvailable ? adjustCollectionQuantity : null}
          collectionSignedOut={!isLoggedIn}
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
            <button
              onClick={() => setShowParagonModal(false)}
              className="absolute -top-4 -right-4 w-10 h-10 bg-card rounded-full shadow-lg flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors z-10"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <Image
              src={`/paragons/Paragon ${deck.paragon}.png`}
              alt={deck.paragon}
              width={800}
              height={1120}
              className="w-full h-auto rounded-lg shadow-2xl"
            />
          </div>
        </div>
      )}

      {/* Breadcrumb — a published tournament copy belongs to its event, not the community index */}
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-muted-foreground">
        {tournament ? (
          <>
            {/* Root crumb is dropped on phones so the trail stays one line */}
            <Link href="/tournaments/results" className="hidden sm:inline hover:text-foreground transition-colors">
              Tournament Results
            </Link>
            <span className="hidden sm:contents"><BreadcrumbChevron /></span>
            {tournament.results_published ? (
              <Link
                href={`/tournaments/results/${tournament.tournament_id}`}
                className="hover:text-foreground transition-colors truncate"
              >
                {tournament.tournament_name}
              </Link>
            ) : (
              <span className="truncate">{tournament.tournament_name}</span>
            )}
            <BreadcrumbChevron />
            <span className="text-foreground truncate">{tournament.player_name || deckName}</span>
          </>
        ) : (
          <>
            <a href="/decklist/community" className="hover:text-foreground transition-colors">
              Community Decks
            </a>
            <BreadcrumbChevron />
            <span className="text-foreground truncate">{deckName}</span>
          </>
        )}
      </nav>

      {/* Tournament result header — the identity of a published copy */}
      {tournament && (
        <div className="mb-6 rounded-xl bg-muted/40 px-4 py-4 sm:px-5 sm:py-5">
          {tournament.placement != null && (
            <div className="flex items-center gap-2 mb-1">
              <TrophyIcon place={tournament.placement} className="w-5 h-5 flex-shrink-0" />
              <span className={`text-sm font-semibold uppercase tracking-wide ${getPlacementToneClass(tournament.placement)}`}>
                {getPlacementLabel(tournament.placement)}
              </span>
            </div>
          )}
          <h1 className="font-cinzel text-3xl font-bold text-foreground break-words">
            {tournament.player_name || deckName}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {(() => {
              // Separators trail their own item so a wrap on narrow screens
              // never starts a line with a stray "·".
              const meta = [
                formatEventDate(tournament.ended_at),
                tournament.deck_format,
                tournament.participant_count > 0
                  ? `${tournament.participant_count} player${tournament.participant_count === 1 ? "" : "s"}`
                  : null,
              ].filter(Boolean) as string[];
              return (
                <>
                  <span className="flex items-center gap-2">
                    {tournament.results_published ? (
                      <Link
                        href={`/tournaments/results/${tournament.tournament_id}`}
                        className="font-medium underline underline-offset-2 hover:text-foreground transition-colors"
                      >
                        {tournament.tournament_name}
                      </Link>
                    ) : (
                      <span className="font-medium">{tournament.tournament_name}</span>
                    )}
                    {meta.length > 0 && <span aria-hidden="true">·</span>}
                  </span>
                  {meta.map((part, i) => (
                    <span key={part} className="flex items-center gap-2">
                      {part}
                      {i < meta.length - 1 && <span aria-hidden="true">·</span>}
                    </span>
                  ))}
                </>
              );
            })()}
          </div>
          {(tournament.match_points != null || tournament.differential != null) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tournament.match_points != null && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs text-muted-foreground">
                  <span className="uppercase tracking-wide">Match points</span>
                  <span className="font-semibold text-foreground">{tournament.match_points}</span>
                </span>
              )}
              {tournament.differential != null && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-2.5 py-1 text-xs text-muted-foreground">
                  <span className="uppercase tracking-wide">Differential</span>
                  <span className="font-semibold text-foreground">
                    {tournament.differential > 0 ? `+${tournament.differential}` : tournament.differential}
                  </span>
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {/* Tournament copies are titled "<player> - <place> - <event>"; the
                result header above already says all of that, and better. */}
            {!tournament && (isOwner && editingName ? (
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onBlur={handleNameSubmit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNameSubmit();
                  if (e.key === "Escape") { setNameInput(deckName); setEditingName(false); }
                }}
                className="text-3xl font-bold bg-transparent border-b-2 border-blue-500 outline-none w-full min-w-0 mb-2"
              />
            ) : (
              <h1
                className={`text-3xl font-bold mb-2 ${isOwner ? "cursor-pointer hover:text-blue-500 dark:hover:text-blue-400 transition-colors" : ""}`}
                onClick={isOwner ? () => { setNameInput(deckName); setEditingName(true); } : undefined}
                title={isOwner ? "Click to rename" : undefined}
              >
                {deckName}
              </h1>
            ))}
            <div className="flex items-center gap-3 flex-wrap">
              <span className={getDeckTypeBadgeClasses(deck.format)}>
                {formatDeckType(deck.format)}
              </span>
              {deck.paragon && formatDeckType(deck.format) === "Paragon" && (
                <span className="text-sm text-muted-foreground">
                  Paragon: <strong>{deck.paragon}</strong>
                </span>
              )}
              {/* The byline on a published copy is the service account that owns
                  it, not the player — the result header credits the player. */}
              {!tournament && deck.username && (
                <span className="text-sm text-muted-foreground">
                  by{" "}
                  <Link
                    href={`/decklist/community?username=${encodeURIComponent(deck.username)}`}
                    className="font-medium text-muted-foreground underline hover:text-foreground"
                  >
                    {deck.username}
                  </Link>
                </span>
              )}
              <span className="text-sm text-muted-foreground">
                {mainDeckCount} cards{reserveCount > 0 && ` + ${reserveCount} reserve`}
                {/* Price stays available in the Stats panel, but it must not be
                    the loudest thing on a tournament result page. */}
                {!tournament && totalDeckPrice !== null && (
                  <button
                    onClick={() => { setBuyModalMode("exact"); setShowBuyDeckModal(true); }}
                    className="text-green-600 dark:text-green-400 font-medium hover:underline inline-flex items-center gap-1"
                    title="Buy deck on YTG"
                  >
                    {" · "}
                    <img src="/sponsors/ytg-dark.png" alt="" className="h-3 w-3 object-contain hidden dark:block" />
                    <img src="/sponsors/ytg-light.png" alt="" className="h-3 w-3 object-contain dark:hidden" />
                    ${totalDeckPrice.toFixed(2)}
                  </button>
                )}
                {!tournament && deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
                  <button
                    onClick={() => { setBuyModalMode("budget"); setShowBuyDeckModal(true); }}
                    className="text-muted-foreground font-normal hover:underline inline-flex items-center gap-0.5 text-xs"
                    title={`Save $${(deck.total_price - deck.budget_price).toFixed(2)} with cheapest versions`}
                  >
                    {" · Min: "}
                    <span className="text-green-600 dark:text-green-400">${deck.budget_price.toFixed(2)}</span>
                  </button>
                )}
              </span>
              {/* A published copy is an immutable archive row — its own created/
                  updated stamps say nothing. The event date is the real date. */}
              {!tournament && (
                <>
                  <span className="text-sm text-muted-foreground">
                    Created {new Date(deck.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Updated {new Date(deck.updated_at).toLocaleDateString()}
                  </span>
                </>
              )}
              {(deck.view_count ?? 0) > 0 && (
                <span className="text-sm text-muted-foreground">{deck.view_count} views</span>
              )}
            </div>

            {/* Tags row */}
            {(deckTags.length > 0 || isOwner) && (
              <div className="flex items-center gap-2 flex-wrap mt-3">
                {deckTags.map((tag) =>
                  isOwner ? (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag)}
                      className="group flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium transition-opacity"
                      style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
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
                  ) : (
                    <span
                      key={tag.id}
                      className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                      style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                    >
                      {tag.name}
                    </span>
                  )
                )}

                {/* Owner tag picker trigger */}
                {isOwner && (
                  <div className="relative" ref={tagPickerRef}>
                    <button
                      onClick={() => { setTagPickerOpen((o) => !o); setTagFilter(""); }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-border text-xs text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      {deckTags.length === 0 ? "Add tags" : "Edit"}
                      {savingTags && <span className="ml-1 opacity-60">·</span>}
                    </button>

                    {tagPickerOpen && (
                      <div className="absolute z-50 top-full mt-1.5 left-0 w-72 bg-background border border-border rounded-xl shadow-xl">

                        {createMode ? (
                          /* ── Inline create form ── */
                          <form onSubmit={handleCreateTag} className="p-3 flex flex-col gap-3">
                            {/* Name + swatch row */}
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setCreateColorOpen((o) => !o)}
                                className="w-7 h-7 rounded-md border-2 border-border shadow-sm flex-shrink-0 hover:scale-110 transition-transform"
                                style={{ backgroundColor: createColor }}
                                title={createColorOpen ? "Close color picker" : "Pick color"}
                              />
                              <input
                                autoFocus
                                type="text"
                                placeholder="Tag name"
                                value={createName}
                                onChange={(e) => setCreateName(e.target.value)}
                                maxLength={50}
                                className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>

                            {/* Color picker — inline, expands the dropdown downward */}
                            {createColorOpen && (
                              <div className="flex flex-col items-center gap-1.5">
                                <HexColorPicker color={createColor} onChange={setCreateColor} style={{ width: "100%" }} />
                                <span className="font-mono text-xs text-muted-foreground">{createColor}</span>
                              </div>
                            )}

                            {/* Preview pill */}
                            {createName.trim() && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Preview:</span>
                                <span
                                  className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                                  style={{ backgroundColor: createColor, color: getContrastColor(createColor) }}
                                >
                                  {createName}
                                </span>
                              </div>
                            )}

                            {createError && (
                              <p className="text-xs text-red-500 dark:text-red-400">{createError}</p>
                            )}

                            <div className="flex gap-2">
                              <button
                                type="submit"
                                disabled={creating || !createName.trim()}
                                className="flex-1 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                              >
                                {creating ? "Creating…" : "Create tag"}
                              </button>
                              <button
                                type="button"
                                onClick={() => { setCreateMode(false); setCreateError(null); setCreateName(""); setCreateColorOpen(false); }}
                                className="flex-1 py-1.5 border border-border text-sm rounded-lg hover:bg-muted transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            {/* Filter input */}
                            <div className="px-3 pt-3 pb-2 border-b border-border">
                              <input
                                autoFocus
                                type="text"
                                placeholder="Filter tags…"
                                value={tagFilter}
                                onChange={(e) => setTagFilter(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && filteredGlobalTags[0]) {
                                    e.preventDefault();
                                    toggleTag(filteredGlobalTags[0]);
                                  }
                                }}
                                className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>

                            {/* Tag list */}
                            <div className="max-h-56 overflow-y-auto">
                              {tagsLoading ? (
                                <div className="flex items-center justify-center gap-2 py-4">
                                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-muted-foreground border-t-transparent" />
                                  <span className="text-xs text-muted-foreground">Loading tags…</span>
                                </div>
                              ) : tagsLoadError ? (
                                <p className="text-xs text-red-500 dark:text-red-400 text-center py-4 px-3">
                                  {tagsLoadError}
                                </p>
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
                                      <span
                                        className="w-3 h-3 rounded-full flex-shrink-0 border border-black/10"
                                        style={{ backgroundColor: tag.color }}
                                      />
                                      <span className="text-sm text-foreground">{tag.name}</span>
                                    </button>
                                  );
                                })
                              )}
                            </div>

                            {/* Admin: create new tag footer */}
                            {canManageTags && (
                              <div className="border-t border-border">
                                <button
                                  onClick={() => {
                                    setCreateName(tagFilter);
                                    setCreateColor("#6366f1");
                                    setCreateError(null);
                                    setCreateMode(true);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted transition-colors"
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
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCopyLink}
              className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
            >
              {linkCopied ? (
                <>
                  <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </>
              )}
            </button>

            <GoldfishButton deckId={deck.id} deckName={deck.name} format={deck.format} />

            {isLoggedIn && (
              <button
                onClick={() => setShowCollectionCheckModal(true)}
                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Check my collection
              </button>
            )}

            {/* Export dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showExportMenu && (
                <div className="absolute left-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg py-1 z-50 min-w-[160px]">
                  <button
                    onClick={() => { setShowPDFModal(true); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Generate PDF
                  </button>
                  <button
                    onClick={() => { setShowImageModal(true); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Generate Image
                  </button>
                  <button
                    onClick={() => { handleDownloadTxt(); setShowExportMenu(false); }}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-muted flex items-center gap-2"
                  >
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download .txt
                  </button>
                </div>
              )}
            </div>

            {!isOwner && isLoggedIn && (
              <button
                onClick={handleCopyToLibrary}
                disabled={copying}
                className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {copying ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Copying...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                    </svg>
                    Copy &amp; Edit
                  </>
                )}
              </button>
            )}

            {isOwner && (
              <>
                <button
                  onClick={() => { setCoverEditorOpen(true); setCoverPickerSlot(1); }}
                  className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2"
                  title="Edit cover cards"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Cover
                </button>
                <button
                  onClick={handleOpenInBuilder}
                  className="px-4 py-2 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-800 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit in Builder
                </button>
              </>
            )}
          </div>
        </div>

        {/* Copy result notification */}
        {copyResult && (
          <div
            className={`mt-4 px-4 py-3 rounded-lg text-sm ${
              copyResult.success
                ? "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800"
            }`}
          >
            {copyResult.message}
            {!copyResult.success && copyResult.message.includes("Sign in") && (
              <a href="/sign-in" className="ml-2 underline font-medium">
                Sign in
              </a>
            )}
          </div>
        )}
      </div>

      {/* Cover card editor modal — owner only */}
      {isOwner && coverEditorOpen && (() => {
        const coverMainCards = enrichedCards.filter(c => c.zone === 'main');
        const filteredCoverCards = coverPickerSearch.trim()
          ? coverMainCards.filter(c => c.card_name.toLowerCase().includes(coverPickerSearch.trim().toLowerCase()))
          : coverMainCards;
        const sortedCoverCards = [...filteredCoverCards].sort((a, b) => {
          switch (coverPickerSort) {
            case "name":
              return a.card_name.localeCompare(b.card_name);
            case "type":
              return (a.type || "").localeCompare(b.type || "") || a.card_name.localeCompare(b.card_name);
            case "brigade":
              return (a.brigade || "").localeCompare(b.brigade || "") || a.card_name.localeCompare(b.card_name);
            default:
              return compareCardsDefault(toSortable(a), toSortable(b));
          }
        });
        const close = () => { setCoverEditorOpen(false); setCoverPickerSlot(null); };
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60" onClick={close}>
            <div className="bg-background rounded-t-xl sm:rounded-xl shadow-2xl w-full sm:max-w-2xl flex flex-col max-h-[95vh] sm:max-h-[90vh]" onClick={(e) => e.stopPropagation()}>

              {/* Header */}
              <div className="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b border-border flex-shrink-0">
                <div>
                  <h2 className="text-base sm:text-lg font-semibold">Cover Cards</h2>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Choose thumbnail cards for the Community page.</p>
                </div>
                <button onClick={close} className="ml-4 text-muted-foreground hover:text-foreground p-1 flex-shrink-0">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="px-4 sm:px-6 py-3 sm:py-5 flex-shrink-0">
                {/* Two card slots */}
                <div className="flex gap-4 sm:gap-6 justify-center mb-2">
                  {([1, 2] as const).map((slot) => {
                    const imgFile = slot === 1 ? previewCard1 : previewCard2;
                    const imgUrl = imgFile ? getImageUrl(imgFile) : null;
                    const isActive = coverPickerSlot === slot;
                    return (
                      <div key={slot} className="flex flex-col items-center gap-1 sm:gap-2">
                        <button
                          onClick={() => setCoverPickerSlot(slot)}
                          className={`relative rounded-xl overflow-hidden border-2 transition-all ${
                            isActive
                              ? "border-blue-500 ring-4 ring-blue-200 dark:ring-blue-800 scale-105"
                              : "border-border hover:border-green-600 hover:scale-102"
                          } bg-muted w-20 sm:w-[130px]`}
                          style={{ aspectRatio: "2.5/3.5" }}
                          title={`Set cover card ${slot}`}
                        >
                          {imgUrl ? (
                            <img src={imgUrl} alt={`Cover ${slot}`} className="w-full h-full object-cover" />
                          ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                              <svg className="w-8 h-8 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                              </svg>
                              <span className="text-sm">Empty</span>
                            </div>
                          )}
                          {isActive && (
                            <div className="absolute inset-0 bg-green-600/10 flex items-end justify-center pb-2">
                              <span className="bg-green-700 text-white text-xs font-semibold px-2 py-0.5 rounded-full">Selecting</span>
                            </div>
                          )}
                        </button>
                        <span className="text-xs font-medium text-muted-foreground">Card {slot}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Instruction */}
                <p className="text-center text-sm text-muted-foreground">
                  {coverPickerSlot
                    ? `Click a card below to set it as cover card ${coverPickerSlot}`
                    : "Click a slot above to start"}
                </p>
              </div>

              {/* Sort + Search */}
              <div className="px-4 sm:px-6 pb-2 flex-shrink-0 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Sort:</span>
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
                </div>
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search cards..."
                    value={coverPickerSearch}
                    onChange={(e) => setCoverPickerSearch(e.target.value)}
                    className="w-full pl-8 pr-8 py-1.5 text-sm border border-border rounded-lg bg-card focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {coverPickerSearch && (
                    <button onClick={() => setCoverPickerSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Card grid — scrollable */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 min-h-0">
                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                  {sortedCoverCards.map((card) => (
                    <button
                      key={`${card.card_name}|${card.card_set}`}
                      onClick={async () => {
                        if (!coverPickerSlot) return;
                        const imgFile = card.card_img_file || "";
                        const c1 = coverPickerSlot === 1 ? imgFile : previewCard1;
                        const c2 = coverPickerSlot === 2 ? imgFile : previewCard2;
                        if (coverPickerSlot === 1) setPreviewCard1(imgFile);
                        else setPreviewCard2(imgFile);
                        // Advance to next slot if slot 1 was just filled and slot 2 is empty
                        const nextSlot = coverPickerSlot === 1 && !previewCard2 ? 2 : null;
                        setCoverPickerSlot(nextSlot);
                        setCoverSaving(true);
                        const result = await updateDeckPreviewCardsAction(deck.id, c1, c2);
                        setCoverSaving(false);
                        if (result.success) {
                          setCoverSaved(true);
                          setTimeout(() => setCoverSaved(false), 2000);
                        }
                      }}
                      disabled={!coverPickerSlot}
                      className={`relative rounded-lg overflow-hidden border transition-all ${
                        coverPickerSlot
                          ? "border-border hover:border-blue-500 hover:scale-105 cursor-pointer"
                          : "border-border opacity-50 cursor-default"
                      }`}
                      style={{ aspectRatio: "2.5/3.5" }}
                      title={card.card_name}
                    >
                      <img src={getImageUrl(card.card_img_file || "")} alt={card.card_name} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Footer status */}
              <div className="px-6 py-3 border-t border-border flex-shrink-0 h-12 flex items-center justify-center">
                {coverSaving && <p className="text-sm text-muted-foreground">Saving…</p>}
                {coverSaved && <p className="text-sm text-green-600 dark:text-green-400 font-medium">Saved!</p>}
              </div>

            </div>
          </div>
        );
      })()}

      {/* Paragon image — collapsible */}
      {deck.paragon && formatDeckType(deck.format) === "Paragon" && (
        <div className="mb-6">
          <button
            onClick={() => setParagonVisible((v) => !v)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <svg className={`w-4 h-4 transition-transform ${paragonVisible ? 'rotate-0' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {paragonVisible ? 'Hide' : 'Show'} Paragon Card
          </button>
          {paragonVisible && (
            <div className="max-w-xs">
              <Image
                src={`/paragons/Paragon ${deck.paragon}.png`}
                alt={deck.paragon}
                width={320}
                height={448}
                className="w-full rounded-lg shadow-md cursor-pointer hover:scale-105 hover:shadow-xl transition-all"
                onClick={() => setShowParagonModal(true)}
                title="Click to view full size"
              />
            </div>
          )}
        </div>
      )}

      {/* View Controls */}
      <div className="flex items-center gap-2 md:gap-3 mb-6 flex-wrap">
        <button
          onClick={() => setViewMode(viewMode === "normal" ? "stacked" : "normal")}
          className="flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3 py-1.5 border border-border rounded-lg text-xs md:text-sm hover:bg-muted transition-colors"
        >
          <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {viewMode === "normal" ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            )}
          </svg>
          {viewMode === "normal" ? "Normal" : "Stacked"}
        </button>

        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as "type" | "alignment" | "none")}
          className="px-2.5 md:px-3 py-1.5 border border-border rounded-lg bg-card text-xs md:text-sm"
        >
          <option value="type">Group by Type</option>
          <option value="alignment">Group by Alignment</option>
          <option value="none">No Grouping</option>
        </select>

        {/* Preview sidebar toggle — desktop only */}
        <button
          onClick={() => setShowPreview((v) => !v)}
          className={`hidden lg:flex items-center gap-2 px-3 py-1.5 border rounded-lg text-sm transition-colors ${
            showPreview
              ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
          title={showPreview ? 'Hide card preview' : 'Show card preview'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {showPreview ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878l4.242 4.242M15.12 15.12L21 21" />
            )}
          </svg>
          Preview
        </button>

        {/* Stats toggle */}
        <button
          onClick={() => setShowStats((v) => !v)}
          className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3 py-1.5 border rounded-lg text-xs md:text-sm transition-colors ${
            showStats
              ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'border-border text-muted-foreground hover:bg-muted'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Stats
        </button>
      </div>

      {/* Stats Panel — collapsible */}
      {showStats && cardDatabase && (
        <div className="mb-6 rounded-lg border border-border bg-muted p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Alignment Breakdown */}
            <div>
              <h3 className="font-semibold text-foreground mb-3">
                Alignment Breakdown
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {(() => {
                  const alignmentCounts = countBy(enrichedCards, (card) => {
                    const alignment = card.alignment || "Neutral";
                    return alignment.includes("Good/Evil") ? "Neutral" : alignment;
                  });

                  const alignmentConfig = [
                    { name: 'Good', color: 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200' },
                    { name: 'Evil', color: 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-800 dark:text-red-200' },
                    { name: 'Neutral', color: 'bg-muted border-border text-muted-foreground' },
                    { name: 'Dual', color: 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700 text-purple-800 dark:text-purple-200' },
                  ];

                  return alignmentConfig.map(({ name, color }) => {
                    const count = alignmentCounts[name] || 0;
                    if (count === 0 && name === 'Dual') return null;
                    return (
                      <div key={name} className={`p-3 rounded-lg border-2 ${color}`}>
                        <div className="text-xs font-semibold uppercase tracking-wide mb-1">{name}</div>
                        <div className="text-2xl font-bold">{count}</div>
                      </div>
                    );
                  });
                })()}
                <AodCountCard
                  deck={deckForModal}
                  deckType={getFormatDef(deck.format).family}
                />
              </div>
            </div>

            {/* Deck Statistics */}
            <div>
              <h3 className="font-semibold text-foreground mb-3">
                Deck Statistics
              </h3>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="flex justify-between">
                  <span>Total Cards:</span>
                  <span className="font-medium">{mainDeckCount + reserveCount}</span>
                </div>
                <div className="flex justify-between">
                  <span>Unique Cards:</span>
                  <span className="font-medium">{statCards(enrichedCards).length}</span>
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
                    <span className="font-medium">
                      {sumQuantity(enrichedCards.filter(c => c.type === 'LS' || c.type === 'Lost Soul'))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Dominants:</span>
                    <span className="font-medium">
                      {sumQuantity(enrichedCards.filter(c => c.type === 'Dom' || c.type === 'Dominant'))}
                    </span>
                  </div>
                  {totalDeckPrice !== null && (
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
                  )}
                  {deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
                    <button
                      onClick={() => { setBuyModalMode("budget"); setShowBuyDeckModal(true); }}
                      className="flex justify-between w-full text-left hover:bg-muted -mx-1 px-1 py-0.5 rounded transition-colors group"
                    >
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <span className="w-3.5" />
                        Min:
                      </span>
                      <span className="text-xs">
                        <span className="text-green-600 dark:text-green-400 group-hover:underline">${deck.budget_price.toFixed(2)}</span>
                        <span className="text-muted-foreground ml-1">(save ${(deck.total_price - deck.budget_price).toFixed(2)})</span>
                      </span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Card Type Breakdown */}
            <div>
              <h3 className="font-semibold text-foreground mb-3">
                Card Types
              </h3>
              <div className="space-y-0.5 text-sm text-muted-foreground">
                {(() => {
                  const typeCounts = countBy(enrichedCards, (card) =>
                    prettifyTypeName(card.type || "Unknown")
                  );

                  return Object.entries(typeCounts)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => (
                      <div key={type} className="flex justify-between gap-2">
                        <span className="flex-shrink-0">{type}:</span>
                        <span className="font-medium ml-auto">{count}</span>
                      </div>
                    ));
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading state while card database fetches */}
      {!cardDatabase && deck.cards.length > 0 && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-muted-foreground mx-auto"></div>
            <p className="mt-4 text-muted-foreground text-sm">Loading deck...</p>
          </div>
        </div>
      )}

      {/* Deck cards — only render after card database is loaded */}
      {cardDatabase && <div className="lg:flex lg:gap-6">
      <div className="flex-1 min-w-0">
      {/* Deck / Considering tabs. The maybeboard is a scratchpad, so it lives
          behind its own tab rather than trailing the real deck. */}
      {maybeboardCount > 0 && (
        <div
          role="tablist"
          aria-label="Deck sections"
          className="flex w-full sm:w-fit gap-1 rounded-lg bg-muted/50 p-1 mb-6"
        >
          {([
            { key: "deck" as const, label: "Deck", count: mainDeckCount + reserveCount },
            { key: "considering" as const, label: "Considering", count: maybeboardCount },
          ]).map((tab) => {
            const isActive = tab.key === deckTab;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => setDeckTab(tab.key)}
                className={`flex-1 sm:flex-none whitespace-nowrap rounded-md px-3 sm:px-8 py-3 sm:py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-card font-semibold text-foreground shadow-sm"
                    : "font-medium text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}{" "}
                <span className="font-normal text-muted-foreground">({tab.count})</span>
              </button>
            );
          })}
        </div>
      )}
      {deckTab === "deck" && (
        <>
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            Main Deck
            <span className="text-sm font-normal text-muted-foreground">
              ({mainDeckCount} cards)
            </span>
          </h2>

          {mainCards.length === 0 ? (
            <p className="text-muted-foreground italic">No cards in main deck.</p>
          ) : viewMode === "stacked" ? (
            /* Stacked view — matches FullDeckView layout exactly */
            <div className="flex gap-4 items-start flex-wrap">
              {Object.entries(groupedMainCards).flatMap(([groupName, cards]) => {
                const columns = splitGroup(cards);
                return columns.map((col, colIndex) => (
                  <div key={`${groupName}-${colIndex}`} className="flex flex-col">
                    {groupBy === "alignment" && colIndex === 0 && (
                      <div className="mb-2 flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-muted-foreground">{groupName}</h3>
                        <span className="text-xs text-muted-foreground">({cards.reduce((s, c) => s + c.quantity, 0)})</span>
                      </div>
                    )}
                    <div className="flex flex-col gap-2 items-center">
                      {col.flatMap((card) =>
                        Array.from({ length: card.quantity }, (_, i) => (
                          <StackedTile
                            key={`${card.card_name}-${card.card_set}-${colIndex}-${i}`}
                            card={card}
                            ringClass="hover:ring-blue-500"
                            onClick={() => card.fullCard && setModalCard(card.fullCard)}
                            onHover={setHoveredCard}
                          />
                        ))
                      )}
                    </div>
                  </div>
                ));
              })}

              {/* Reserve columns */}
              {sortedReserveCards.length > 0 && splitGroup(sortedReserveCards).map((col, colIndex) => (
                <div key={`reserve-col-${colIndex}`} className="flex flex-col ml-4">
                  {colIndex === 0 && (
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-purple-400">Reserve</h3>
                      <span className="text-xs text-muted-foreground">({reserveCount})</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 items-center">
                    {col.flatMap((card) =>
                      Array.from({ length: card.quantity }, (_, i) => (
                        <StackedTile
                          key={`reserve-${card.card_name}-${card.card_set}-${colIndex}-${i}`}
                          card={card}
                          ringClass="hover:ring-blue-500"
                          onClick={() => card.fullCard && setModalCard(card.fullCard)}
                          onHover={setHoveredCard}
                        />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Normal view: compact grid with type group headers */
            <div className="space-y-3">
              {Object.entries(groupedMainCards).map(([groupName, cards]) => {
                const groupCount = cards.reduce((sum, c) => sum + c.quantity, 0);
                return (
                  <div key={groupName}>
                    {groupBy !== "none" && (
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                        {getGroupDisplayName(groupName)}
                        <span className="ml-1.5 font-normal">({groupCount})</span>
                      </h3>
                    )}
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-7">
                      {cards.map((card, index) => (
                        <CardTile
                          key={`main-${card.card_name}-${card.card_set}-${index}`}
                          card={card}
                          onClick={() => card.fullCard && setModalCard(card.fullCard)}
                          onHover={setHoveredCard}
                          compact
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reserve (normal view only — stacked view renders reserve inline above) */}
        {viewMode === "normal" && sortedReserveCards.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              Reserve
              <span className="text-sm font-normal text-muted-foreground">
                ({reserveCount} cards)
              </span>
            </h2>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-7">
              {sortedReserveCards.map((card, index) => (
                <CardTile
                  key={`reserve-${card.card_name}-${card.card_set}-${index}`}
                  card={card}
                  onClick={() => card.fullCard && setModalCard(card.fullCard)}
                  onHover={setHoveredCard}
                  compact
                />
              ))}
            </div>
          </div>
        )}
        </>
      )}

      {/* Considering (maybeboard) tab panel */}
      {deckTab === "considering" && (
        <div className="mb-8">
          <h2 className="text-xl font-semibold italic text-muted-foreground mb-4 flex items-center gap-2">
            Considering
            <span className="text-sm font-normal text-muted-foreground not-italic">
              ({maybeboardCount} cards)
            </span>
            <span
              title="A scratchpad — not part of the deck."
              className="w-4 h-4 rounded-full bg-muted text-muted-foreground text-[10px] font-bold flex items-center justify-center cursor-help not-italic"
            >
              ?
            </span>
          </h2>

          {viewMode === "stacked" ? (
            <div className="flex gap-4 items-start flex-wrap">
              {splitGroup(sortedMaybeboardCards).map((col, colIndex) => (
                <div key={`maybeboard-col-${colIndex}`} className="flex flex-col">
                  <div className="flex flex-col gap-2 items-center">
                    {col.flatMap((card) =>
                      Array.from({ length: card.quantity }, (_, i) => (
                        <StackedTile
                          key={`maybeboard-${card.card_name}-${card.card_set}-${colIndex}-${i}`}
                          card={card}
                          ringClass="hover:ring-violet-500"
                          onClick={() => card.fullCard && setModalCard(card.fullCard)}
                          onHover={setHoveredCard}
                        />
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-7">
              {sortedMaybeboardCards.map((card, index) => (
                <CardTile
                  key={`maybeboard-${card.card_name}-${card.card_set}-${index}`}
                  card={card}
                  onClick={() => card.fullCard && setModalCard(card.fullCard)}
                  onHover={setHoveredCard}
                  compact
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Description */}
      {(description || isOwner) && (
        <div className="mt-8 mb-8">
          {isOwner && editingDescription ? (
            <div>
              <CardMentionTextarea
                textareaRef={descriptionTextareaRef}
                autoFocus
                value={descriptionInput}
                onChange={setDescriptionInput}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setDescriptionInput(description); setEditingDescription(false); }
                }}
                rows={3}
                placeholder="Write a description for your deck... (Markdown supported)"
                className="w-full px-3 py-2 border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-hidden"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={handleDescriptionSubmit}
                  className="px-3 py-1.5 text-sm font-medium text-white bg-green-700 hover:bg-green-800 rounded-lg transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => { setDescriptionInput(description); setEditingDescription(false); }}
                  className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <span className="text-xs text-muted-foreground ml-auto">
                  Markdown supported {"\u00b7"} type{" "}
                  <kbd className="rounded bg-muted px-1 font-mono text-[11px] text-foreground">[[</kbd> to mention a card
                </span>
              </div>
            </div>
          ) : description ? (
            <div
              className={`rounded-lg border border-border bg-muted px-4 py-3 ${isOwner ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`}
              onClick={isOwner ? (e) => {
                if ((e.target as HTMLElement).closest("button, a")) return;
                setDescriptionInput(description); setEditingDescription(true);
              } : undefined}
              title={isOwner ? "Click to edit description" : undefined}
            >
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</h3>
              <DeckDescription markdown={description} />
            </div>
          ) : isOwner ? (
            <button
              onClick={() => setEditingDescription(true)}
              className="w-full rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors text-left"
            >
              + Add a description...
            </button>
          ) : null}
        </div>
      )}
      </div>

      {/* Sticky sidebar card preview — desktop only */}
      {showPreview && (
        <div className="hidden lg:block w-72 flex-shrink-0">
          <div className="sticky top-24">
            {hoveredCard ? (
              <div className="transition-opacity duration-150">
                <div className="aspect-[2.5/3.5] rounded-lg overflow-hidden shadow-lg bg-muted">
                  <img
                    src={getImageUrl(hoveredCard.imgFile)}
                    alt={hoveredCard.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                <p className="mt-2 text-sm font-semibold text-foreground">{hoveredCard.name}</p>
                <p className="text-xs text-muted-foreground">
                  {hoveredCard.set}{hoveredCard.type ? ` · ${prettifyTypeName(hoveredCard.type)}` : ''}
                  {(() => {
                    const priceKey = `${hoveredCard.name}|${hoveredCard.set}|${hoveredCard.imgFile}`;
                    const priceInfo = getPrice(priceKey);
                    return priceInfo ? (
                      <span className="text-green-600 dark:text-green-400 font-medium"> · ${priceInfo.price.toFixed(2)}</span>
                    ) : null;
                  })()}
                </p>
              </div>
            ) : (
              <div className="aspect-[2.5/3.5] rounded-lg border-2 border-dashed border-border flex items-center justify-center">
                <p className="text-sm text-muted-foreground text-center px-4">Hover over a card to preview</p>
              </div>
            )}
          </div>
        </div>
      )}
      </div>}

      {/* Buy Deck Modal */}
      {showBuyDeckModal && (
        <BuyDeckModal
          cards={buyCards ?? enrichedCards.map(c => ({
            card_name: c.card_name,
            card_key: `${c.card_name}|${c.card_set}|${sanitizeImgFile(c.card_img_file || "")}`,
            quantity: c.quantity,
            zone: c.zone,
          }))}
          onClose={() => { setShowBuyDeckModal(false); setBuyCards(null); }}
          initialMode={buyModalMode}
        />
      )}

      {showCollectionCheckModal && (
        <CollectionCheckModal
          cards={enrichedCards.map(c => ({
            card_name: c.card_name,
            card_key: `${c.card_name}|${c.card_set}|${sanitizeImgFile(c.card_img_file || "")}`,
            quantity: c.quantity,
            zone: c.zone,
          }))}
          ownedByName={aggregateOwnedByName(collectionQuantities)}
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

      {/* Generate PDF Modal */}
      {showPDFModal && (
        <GeneratePDFModal
          deck={deckForModal}
          onClose={() => setShowPDFModal(false)}
          isLegal={deck.is_legal ?? null}
        />
      )}

      {/* Generate Image Modal */}
      {showImageModal && (
        <GenerateDeckImageModal
          deck={deckForModal}
          onClose={() => setShowImageModal(false)}
          isLegal={deck.is_legal ?? null}
        />
      )}
    </div>
  );
}

/**
 * Group cards and sort within each group.
 * Supports grouping by type, alignment, or no grouping.
 */
type HoverTarget = { name: string; imgFile: string; set?: string; type?: string } | null;

/**
 * One card in the stacked (overlapping columns) layout — the main deck,
 * Reserve and Considering columns all render the same tile.
 */
function StackedTile({
  card,
  ringClass,
  onClick,
  onHover,
}: {
  card: EnrichedCard;
  ringClass: string;
  onClick: () => void;
  onHover: (target: HoverTarget) => void;
}) {
  return (
    <div
      className="group relative w-28 flex-shrink-0 cursor-pointer transition-all -mb-32 last:mb-0"
      onClick={onClick}
      onMouseEnter={() => onHover({ name: card.card_name, imgFile: card.card_img_file || "", set: card.card_set, type: card.type })}
      onMouseLeave={() => onHover(null)}
    >
      <div className={`relative aspect-[2.5/3.5] rounded-md overflow-hidden bg-muted hover:ring-2 ${ringClass} transition-all cursor-pointer shadow-md`}>
        <img
          src={getImageUrl(card.card_img_file || "")}
          alt={card.card_name}
          className="w-full h-full object-contain"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity flex items-end">
          <div className="w-full p-1.5 text-white">
            <p className="text-xs font-semibold leading-tight truncate">{card.card_name}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Split a group of cards into multiple columns when it exceeds maxPerColumn.
 * Matches FullDeckView splitTypeGroup logic.
 */
function splitGroup(cards: EnrichedCard[], maxPerColumn = 17): EnrichedCard[][] {
  const totalCards = cards.reduce((sum, c) => sum + c.quantity, 0);
  if (totalCards <= maxPerColumn) return [cards];

  const numColumns = Math.ceil(totalCards / maxPerColumn);
  const targetPerColumn = Math.ceil(totalCards / numColumns);

  const columns: EnrichedCard[][] = [];
  let currentColumn: EnrichedCard[] = [];
  let currentCount = 0;

  for (const card of cards) {
    if (currentCount + card.quantity > targetPerColumn && currentColumn.length > 0) {
      const distWithout = Math.abs(currentCount - targetPerColumn);
      const distWith = Math.abs(currentCount + card.quantity - targetPerColumn);
      if (distWith > distWithout) {
        columns.push(currentColumn);
        currentColumn = [card];
        currentCount = card.quantity;
        continue;
      }
    }
    currentColumn.push(card);
    currentCount += card.quantity;
  }

  if (currentColumn.length > 0) columns.push(currentColumn);
  return columns;
}

function groupAndSortCards(
  cards: EnrichedCard[],
  groupByMode: "type" | "alignment" | "none" = "type"
): Record<string, EnrichedCard[]> {
  const grouped: Record<string, EnrichedCard[]> = {};

  for (const card of cards) {
    let key: string;
    if (groupByMode === "alignment") {
      key = card.alignment || "Neutral";
    } else if (groupByMode === "type") {
      key = getGroupKey(card.type);
    } else {
      key = "All Cards";
    }
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(card);
  }

  // Sort within each group by type, alignment, brigade, then name
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => compareCardsByType(toSortable(a), toSortable(b)));
  }

  // Order the groups
  const ordered: Record<string, EnrichedCard[]> = {};
  if (groupByMode === "alignment") {
    ["Good", "Evil", "Neutral"].forEach((a) => {
      if (grouped[a]) ordered[a] = grouped[a];
    });
    // Any remaining
    Object.keys(grouped).forEach((k) => {
      if (!ordered[k]) ordered[k] = grouped[k];
    });
  } else {
    // Order type buckets canonically (Dominants, Artifacts, Fortresses, …)
    Object.keys(grouped)
      .sort(compareTypeGroups)
      .forEach((key) => {
        ordered[key] = grouped[key];
      });
  }

  return ordered;
}

