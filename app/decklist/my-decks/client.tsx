"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  loadUserDecksAction,
  deleteDeckAction,
  duplicateDeckAction,
  loadUserFoldersAction,
  createFolderAction,
  renameFolderAction,
  deleteFolderAction,
  moveDeckToFolderAction,
  loadDeckByIdAction,
  setDeckVisibilityAction,
  loadGlobalTagsAction,
  updateDeckPreviewCardsAction,
  DeckData,
  DeckCardData,
  DeckVisibility,
  FolderData,
  GlobalTag,
} from "../actions";
import { GoldfishButton } from "../../goldfish/components/GoldfishButton";
import DeleteDeckModal from "./DeleteDeckModal";
import DeleteFolderModal from "./DeleteFolderModal";
import FolderModal from "./FolderModal";
import UsernameModal from "./UsernameModal";
import QuickLookModal from "./QuickLookModal";
import { buildSortInfo, compareDeckCards } from "./cardTypeSort";
import type { SortableCard } from "@/lib/cards/defaultSort";
import { getCardImageUrlOrNull } from "@/app/shared/utils/cardImageUrl";
import GeneratePDFModal from "../card-search/components/GeneratePDFModal";
import GenerateDeckImageModal from "../card-search/components/GenerateDeckImageModal";
import ShareDeckModal from "../card-search/components/ShareDeckModal";
import { Deck } from "../card-search/types/deck";
import { Card } from "../card-search/utils";
import { cn } from "@/lib/utils";
import { getFormatDef, FORMAT_IDS, FormatId } from "@/lib/formats";

// Derive three-state visibility from a deck row (falls back to the is_public mirror).
function deckVisibility(deck: DeckData): DeckVisibility {
  return deck.visibility ?? (deck.is_public ? "public" : "private");
}

// Badge label + tailwind classes for a visibility state.
function visibilityBadge(vis: DeckVisibility): { label: string; classes: string } {
  if (vis === "public") {
    return { label: "Public", classes: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" };
  }
  if (vis === "unlisted") {
    return { label: "Unlisted", classes: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" };
  }
  return { label: "Private", classes: "bg-muted text-muted-foreground" };
}

// Helper function to normalize deck format display
function formatDeckType(format?: string): FormatId {
  return getFormatDef(format).id;
}

const FORMAT_CHIP = "inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tracking-wide text-muted-foreground";

function getContrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "#1f2937" : "#ffffff";
}

// Helper function to format date with time and timezone
function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  // Get timezone abbreviation
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzAbbr = new Intl.DateTimeFormat('en-US', { 
    timeZoneName: 'short',
    timeZone: timezone
  }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value || '';
  
  return `${month}/${day}/${year} ${hours}:${minutes}:${seconds} ${tzAbbr}`;
}

// Helper: relative "time ago" for quick scanning; absolute stays on hover via formatDateTime.
function formatRelativeTime(dateString: string): string {
  const then = new Date(dateString).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 45) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const d = new Date(dateString);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

type ToastState = {
  message: string;
  type: "error" | "success";
  action?: { label: string; onClick: () => void };
};

export default function MyDecksClient() {
  const router = useRouter();
  const [decks, setDecks] = useState<DeckData[]>([]);
  const [folders, setFolders] = useState<FolderData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [sortBy, setSortBy] = useState<"updated" | "created" | "name">("updated");
  const [deckTypeFilter, setDeckTypeFilter] = useState<"all" | FormatId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchAllFolders, setSearchAllFolders] = useState(true);
  const [searchScopeOpen, setSearchScopeOpen] = useState(false);
  const searchScopeRef = useRef<HTMLDivElement>(null);
  const [deckToDelete, setDeckToDelete] = useState<{ id: string; name: string } | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null); // null = "My Decks"
  const [folderModal, setFolderModal] = useState<{ mode: "create" | "rename"; folderId?: string; initialName?: string } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);
  const [pdfDeck, setPdfDeck] = useState<Deck | null>(null); // For PDF generation modal
  const [pdfDeckLegal, setPdfDeckLegal] = useState<boolean | null>(null);
  const [imageDeck, setImageDeck] = useState<Deck | null>(null); // For image generation modal
  const [imageDeckLegal, setImageDeckLegal] = useState<boolean | null>(null);
  const [usernameModalDeckId, setUsernameModalDeckId] = useState<string | null>(null);
  const [shareDeckId, setShareDeckId] = useState<string | null>(null);
  const [coverPickerDeckId, setCoverPickerDeckId] = useState<string | null>(null);
  const [quickLookDeckId, setQuickLookDeckId] = useState<string | null>(null);

  // Multi-select + bulk actions
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const bulkMoveRef = useRef<HTMLDivElement>(null);

  // Drag-to-folder: tracks which drop target is hovered ("uncat" or a folder id).
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Inline toast/snackbar (replaces native alert; also drives undo-on-delete)
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(
    message: string,
    type: "error" | "success" = "error",
    action?: ToastState["action"],
  ) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type, action });
    toastTimerRef.current = setTimeout(() => setToast(null), action ? 5000 : 4000);
  }

  // Tag filter state
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [globalTags, setGlobalTags] = useState<GlobalTag[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagFilterInput, setTagFilterInput] = useState("");
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tagDropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
        setTagFilterInput("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [tagDropdownOpen]);

  useEffect(() => {
    if (!searchScopeOpen) return;
    function handleClick(e: MouseEvent) {
      if (searchScopeRef.current && !searchScopeRef.current.contains(e.target as Node)) {
        setSearchScopeOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [searchScopeOpen]);

  useEffect(() => {
    if (!bulkMoveOpen) return;
    function handleClick(e: MouseEvent) {
      if (bulkMoveRef.current && !bulkMoveRef.current.contains(e.target as Node)) {
        setBulkMoveOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [bulkMoveOpen]);

  useEffect(() => {
    loadGlobalTagsAction().then((res) => {
      if (res.success) setGlobalTags(res.tags);
    });
  }, []);

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    
    const [decksResult, foldersResult] = await Promise.all([
      loadUserDecksAction(),
      loadUserFoldersAction(),
    ]);
    
    if (decksResult.success) {
      setDecks(decksResult.decks);
    } else {
      setError(decksResult.error || "Failed to load decks");
    }
    
    if (foldersResult.success) {
      setFolders(foldersResult.folders);
    }
    
    setLoading(false);
  }

  // Silent refetch (no full-page spinner) used to reconcile after mutations.
  async function refreshDecks() {
    const r = await loadUserDecksAction();
    if (r.success) setDecks(r.decks);
  }

  function handleDeleteDeck(deckId: string) {
    const removed = decks.find((d) => d.id === deckId);
    if (!removed) return;
    // Deferred-commit delete: remove optimistically, only call the server after
    // the undo window elapses. Undo cancels the timer and restores the row.
    setDecks((prev) => prev.filter((d) => d.id !== deckId));
    let undone = false;
    const commitTimer = setTimeout(async () => {
      const result = await deleteDeckAction(deckId);
      if (!result.success) {
        setDecks((prev) => [removed, ...prev]);
        showToast(result.error || "Failed to delete deck");
      }
    }, 5000);
    showToast(`Deleted "${removed.name}"`, "success", {
      label: "Undo",
      onClick: () => {
        if (undone) return;
        undone = true;
        clearTimeout(commitTimer);
        setDecks((prev) => [removed, ...prev]);
        setToast(null);
      },
    });
  }

  async function handleDuplicateDeck(deckId: string) {
    const result = await duplicateDeckAction(deckId);
    if (result.success) {
      await refreshDecks();
      showToast("Deck duplicated", "success");
    } else {
      showToast(result.error || "Failed to duplicate deck");
    }
  }

  async function handleCreateFolder(name: string) {
    const result = await createFolderAction(name);
    if (result.success && result.folder) {
      setFolders((prev) => [...prev, result.folder!]);
    } else {
      showToast(result.error || "Failed to create folder");
    }
  }

  async function handleRenameFolder(folderId: string, newName: string) {
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: newName } : f)));
    const result = await renameFolderAction(folderId, newName);
    if (!result.success) {
      const r = await loadUserFoldersAction();
      if (r.success) setFolders(r.folders);
      showToast(result.error || "Failed to rename folder");
    }
  }

  async function handleDeleteFolder(folderId: string) {
    const result = await deleteFolderAction(folderId);
    if (result.success) {
      setFolders(folders.filter((f) => f.id !== folderId));
      // Decks inside the folder are cascade-deleted server-side; drop them locally too.
      setDecks((prev) => prev.filter((d) => d.folder_id !== folderId));
      if (selectedFolder === folderId) {
        setSelectedFolder(null); // Go back to "My Decks"
      }
    } else {
      showToast(result.error || "Failed to delete folder");
    }
  }

  async function handleMoveDeck(deckId: string, folderId: string | null) {
    setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, folder_id: folderId } : d)));
    const result = await moveDeckToFolderAction(deckId, folderId);
    if (!result.success) {
      await refreshDecks();
      showToast(result.error || "Failed to move deck");
    }
  }

  // ── Multi-select / bulk actions ────────────────────────────────────────────
  function toggleSelect(deckId: string) {
    setSelectedIds((prev) =>
      prev.includes(deckId) ? prev.filter((id) => id !== deckId) : [...prev, deckId]
    );
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds([]);
    setBulkMoveOpen(false);
  }

  async function handleBulkMove(folderId: string | null) {
    const ids = selectedIds.slice();
    if (ids.length === 0) return;
    setBulkMoveOpen(false);
    setDecks((prev) => prev.map((d) => (ids.includes(d.id!) ? { ...d, folder_id: folderId } : d)));
    exitSelection();
    const results = await Promise.all(ids.map((id) => moveDeckToFolderAction(id, folderId)));
    if (results.some((r) => !r.success)) {
      await refreshDecks();
      showToast("Some decks couldn't be moved");
    } else {
      showToast(`Moved ${ids.length} deck${ids.length > 1 ? "s" : ""}`, "success");
    }
  }

  function handleBulkDelete() {
    const ids = selectedIds.slice();
    if (ids.length === 0) return;
    const removed = decks.filter((d) => ids.includes(d.id!));
    setDecks((prev) => prev.filter((d) => !ids.includes(d.id!)));
    exitSelection();
    // Deferred-commit: only hit the server after the undo window elapses.
    let undone = false;
    const commitTimer = setTimeout(async () => {
      const results = await Promise.all(ids.map((id) => deleteDeckAction(id)));
      const failed = removed.filter((_, i) => !results[i].success);
      if (failed.length > 0) {
        setDecks((prev) => [...failed, ...prev]);
        showToast(`${failed.length} deck${failed.length > 1 ? "s" : ""} couldn't be deleted`);
      }
    }, 5000);
    showToast(`Deleted ${ids.length} deck${ids.length > 1 ? "s" : ""}`, "success", {
      label: "Undo",
      onClick: () => {
        if (undone) return;
        undone = true;
        clearTimeout(commitTimer);
        setDecks((prev) => [...removed, ...prev]);
        setToast(null);
      },
    });
  }

  // Move a deck via drag-and-drop onto a folder (desktop). No-op if already there.
  function handleDropDeckOnFolder(deckId: string, folderId: string | null) {
    const deck = decks.find((d) => d.id === deckId);
    if (!deck || (deck.folder_id ?? null) === folderId) return;
    handleMoveDeck(deckId, folderId);
  }

  // Drop-target props for a folder destination (highlight + drop = move).
  function deckDropHandlers(key: string, folderId: string | null) {
    return {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOverKey !== key) setDragOverKey(key);
      },
      onDragLeave: () => setDragOverKey((k) => (k === key ? null : k)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDragOverKey(null);
        const id = e.dataTransfer.getData("text/plain");
        if (id) handleDropDeckOnFolder(id, folderId);
      },
    };
  }

  async function handleSetVisibility(deckId: string, visibility: DeckVisibility) {
    const result = await setDeckVisibilityAction(deckId, visibility);
    if (result.success) {
      setDecks(decks.map(d =>
        d.id === deckId
          ? { ...d, visibility, is_public: visibility === "unlisted" || visibility === "public" }
          : d
      ));
    } else if ((result as any).needsUsername) {
      setUsernameModalDeckId(deckId);
    } else {
      showToast(result.error || "Failed to update deck visibility");
    }
  }

  async function handleUsernameSet(_username: string) {
    const deckId = usernameModalDeckId;
    setUsernameModalDeckId(null);
    if (deckId) {
      const result = await setDeckVisibilityAction(deckId, "public");
      if (result.success) {
        setDecks(prev => prev.map(d =>
          d.id === deckId ? { ...d, visibility: "public", is_public: true } : d
        ));
      } else {
        showToast(result.error || "Failed to update deck visibility");
      }
    }
  }

  async function loadDeckForModal(deckId: string): Promise<{ deck: Deck; isLegal: boolean | null } | null> {
    const result = await loadDeckByIdAction(deckId);
    if (result.success && result.deck) {
      const cloudDeck = result.deck;
      const deck: Deck = {
        id: cloudDeck.id,
        name: cloudDeck.name,
        description: cloudDeck.description || "",
        format: cloudDeck.format,
        folderId: cloudDeck.folder_id,
        cards: cloudDeck.cards.map((dbCard: any) => ({
          card: {
            name: dbCard.card_name,
            set: dbCard.card_set,
            imgFile: dbCard.card_img_file,
            dataLine: "", officialSet: "", type: "", brigade: "",
            strength: "", toughness: "", class: "", identifier: "",
            specialAbility: "", rarity: "", reference: "", alignment: "",
            legality: "", testament: "", isGospel: false,
          } as Card,
          quantity: dbCard.quantity,
          zone: dbCard.zone,
        })),
        createdAt: new Date(cloudDeck.created_at),
        updatedAt: new Date(cloudDeck.updated_at),
      };
      return { deck, isLegal: cloudDeck.is_legal ?? null };
    }
    showToast(result.error || "Failed to load deck");
    return null;
  }

  async function handleGeneratePDF(deckId: string) {
    const loaded = await loadDeckForModal(deckId);
    if (loaded) {
      setPdfDeck(loaded.deck);
      setPdfDeckLegal(loaded.isLegal);
    }
  }

  async function handleGenerateImage(deckId: string) {
    const loaded = await loadDeckForModal(deckId);
    if (loaded) {
      setImageDeck(loaded.deck);
      setImageDeckLegal(loaded.isLegal);
    }
  }

  async function handleDownload(deckId: string) {
    const result = await loadDeckByIdAction(deckId);
    if (!result.success || !result.deck) return;
    const cards = result.deck.cards as { card_name: string; quantity: number; zone: 'main' | 'reserve' | 'maybeboard' }[];
    const main = cards.filter((c) => c.zone === 'main').sort((a, b) => a.card_name.localeCompare(b.card_name));
    const reserve = cards.filter((c) => c.zone === 'reserve').sort((a, b) => a.card_name.localeCompare(b.card_name));
    const lines: string[] = [];
    main.forEach((c) => lines.push(`${c.quantity}\t${c.card_name}`));
    if (reserve.length > 0) {
      lines.push("");
      lines.push("Reserve:");
      reserve.forEach((c) => lines.push(`${c.quantity}\t${c.card_name}`));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${result.deck.name.replace(/\s+/g, "_")}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleNewDeck() {
    // If in a folder, pass folderId so the new deck is created in that folder
    if (selectedFolder) {
      router.push(`/decklist/card-search?folderId=${selectedFolder}&new=true`);
    } else {
      router.push("/decklist/card-search?new=true");
    }
  }

  function handleEditDeck(deckId: string) {
    router.push(`/decklist/card-search?deckId=${deckId}`);
  }

  // Filter decks based on selected folder
  const folderDecks = selectedFolder === null
    ? decks.filter(d => !d.folder_id)
    : decks.filter(d => d.folder_id === selectedFolder);

  // Apply search filter (search all folders or just current)
  const searchSource = searchQuery.trim() && searchAllFolders ? decks : folderDecks;
  const searchedDecks = searchQuery.trim()
    ? searchSource.filter(d => d.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : searchSource;

  // Apply tag filter (client-side)
  const filteredDecks = selectedTagIds.length === 0
    ? searchedDecks
    : searchedDecks.filter(d => d.tags && d.tags.some(t => selectedTagIds.includes(t.id)));

  // Apply deck type filter (client-side)
  const typeFilteredDecks = deckTypeFilter === "all"
    ? filteredDecks
    : filteredDecks.filter(d => formatDeckType(d.format) === deckTypeFilter);

  // Deck types present among the loaded decks (drives which pills render)
  const availableDeckTypes = FORMAT_IDS.filter(
    type => decks.some(d => formatDeckType(d.format) === type)
  );

  // Sort decks
  const sortedDecks = [...typeFilteredDecks].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "created":
        return new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime();
      case "updated":
      default:
        return new Date(b.updated_at!).getTime() - new Date(a.updated_at!).getTime();
    }
  });

  // Get selected folder name
  const selectedFolderName = selectedFolder 
    ? folders.find(f => f.id === selectedFolder)?.name || "Unknown Folder"
    : "My Decks";

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-8">
        <div className="flex gap-6">
          <div className="hidden lg:block w-64 flex-shrink-0">
            <div className="h-64 rounded-lg border border-border bg-card animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="h-9 w-40 rounded bg-muted animate-pulse mb-6" />
            <div className="h-10 rounded-lg bg-muted animate-pulse mb-3" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-card overflow-hidden">
                  <div className="h-12 bg-muted animate-pulse" />
                  <div className="p-4 space-y-3">
                    <div className="h-5 w-2/3 rounded bg-muted animate-pulse" />
                    <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
                    <div className="h-9 rounded bg-muted animate-pulse mt-4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">

          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-8 overflow-x-hidden jayden-gradient-bg">

      {/* Mobile folder strip (hidden on lg+) */}
      <div className="lg:hidden mb-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button
            onClick={() => setSelectedFolder(null)}
            {...deckDropHandlers("uncat", null)}
            className={cn(
              "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
              selectedFolder === null ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
              dragOverKey === "uncat" && "ring-2 ring-primary",
            )}
          >
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            My Decks
            <span className={`text-xs ${selectedFolder === null ? "opacity-75" : "text-muted-foreground"}`}>
              {decks.filter(d => !d.folder_id).length}
            </span>
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => setSelectedFolder(folder.id!)}
              {...deckDropHandlers(folder.id!, folder.id!)}
              className={cn(
                "flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
                selectedFolder === folder.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
                dragOverKey === folder.id && "ring-2 ring-primary",
              )}
            >
              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              {folder.name}
              <span className={`text-xs ${selectedFolder === folder.id ? "opacity-75" : "text-muted-foreground"}`}>
                {decks.filter(d => d.folder_id === folder.id).length}
              </span>
            </button>
          ))}
          <button
            onClick={() => setFolderModal({ mode: "create" })}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border border-dashed border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors"
          >
            + Folder
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Left Sidebar - Folders (hidden on mobile) */}
        <div className="hidden lg:block w-64 flex-shrink-0">
          <div className="bg-card rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Folders</h2>
              <button
                onClick={() => setFolderModal({ mode: "create" })}
                className="p-1.5 hover:bg-muted rounded transition-colors"
                title="Create new folder"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>

            {/* My Decks (Uncategorized) */}
            <div
              onClick={() => setSelectedFolder(null)}
              {...deckDropHandlers("uncat", null)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg mb-1 transition-colors flex items-center gap-2 cursor-pointer",
                selectedFolder === null ? "bg-primary/10 text-primary" : "hover:bg-muted",
                dragOverKey === "uncat" && "ring-2 ring-primary bg-primary/10",
              )}
            >
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="flex-1">My Decks</span>
              <span className="text-sm text-muted-foreground">
                {decks.filter(d => !d.folder_id).length}
              </span>
            </div>

            {/* Folder List */}
            <div className="space-y-1">
              {folders.map((folder) => (
                <FolderItem
                  key={folder.id}
                  folder={folder}
                  isSelected={selectedFolder === folder.id}
                  deckCount={decks.filter(d => d.folder_id === folder.id).length}
                  onSelect={() => setSelectedFolder(folder.id!)}
                  onRename={() => setFolderModal({ mode: "rename", folderId: folder.id!, initialName: folder.name })}
                  onDelete={() => setFolderToDelete({ id: folder.id!, name: folder.name })}
                  onDropDeck={(deckId) => handleDropDeckOnFolder(deckId, folder.id!)}
                />
              ))}
            </div>

            {folders.length === 0 && (
              <p className="text-sm text-muted-foreground text-center mt-4">
                No folders yet.
                <br />
                Create one to organize your decks!
              </p>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-4 md:mb-8 gap-2">
            <div className="min-w-0">
              <h1 className="font-cinzel text-2xl md:text-3xl font-bold tracking-tight mb-1 md:mb-2 truncate">{selectedFolderName}</h1>
              <p className="text-sm md:text-base text-muted-foreground">
                {typeFilteredDecks.length} {typeFilteredDecks.length === 1 ? "deck" : "decks"}
                {deckTypeFilter !== "all" && ` · ${deckTypeFilter}`}
                {selectedTagIds.length > 0 && ` · ${selectedTagIds.length} tag${selectedTagIds.length > 1 ? "s" : ""} selected`}
              </p>
            </div>
            <button
              onClick={handleNewDeck}
              className="flex-shrink-0 px-3 md:px-6 py-2 md:py-3 border-2 border-primary bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-sm md:text-base font-medium transition-colors"
            >
              + New
              <span className="hidden md:inline"> Deck</span>
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative mb-3" ref={searchScopeRef}>
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder={searchAllFolders ? "Search all folders..." : `Search ${selectedFolderName.toLowerCase()}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-28 py-2 text-sm border border-border rounded-lg bg-card focus-visible:outline-none focus:border-foreground/30"
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <button
                onClick={() => setSearchScopeOpen(prev => !prev)}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors border border-border bg-muted text-muted-foreground hover:bg-muted/80"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <span className="whitespace-nowrap">{searchAllFolders ? "All" : "Folder"}</span>
                <svg className={`w-3 h-3 transition-transform ${searchScopeOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {searchScopeOpen && (
              <div className="absolute z-50 top-full mt-1 right-0 w-48 bg-background border border-border rounded-lg shadow-xl overflow-hidden">
                <button
                  onClick={() => { setSearchAllFolders(true); setSearchScopeOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors ${
                    searchAllFolders ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  All folders
                  {searchAllFolders && (
                    <svg className="w-4 h-4 ml-auto text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => { setSearchAllFolders(false); setSearchScopeOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors ${
                    !searchAllFolders ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  Current folder only
                  {!searchAllFolders && (
                    <svg className="w-4 h-4 ml-auto text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between mb-3 gap-2 md:gap-4">
            <div className="flex items-center gap-1.5 md:gap-2 min-w-0 flex-1">
              <label className="text-sm text-muted-foreground hidden md:inline flex-shrink-0">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-2 md:px-3 py-1.5 border border-border rounded-md bg-card text-xs md:text-sm min-w-0"
              >
                <option value="updated">Last Modified</option>
                <option value="created">Date Created</option>
                <option value="name">Name</option>
              </select>

              {/* Deck type filter pills */}
              {availableDeckTypes.length > 0 && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {(["all", ...availableDeckTypes] as const).map((type) => {
                    const active = deckTypeFilter === type;
                    return (
                      <button
                        key={type}
                        onClick={() => setDeckTypeFilter(type)}
                        className={`px-2 md:px-3 py-1.5 border rounded-lg text-xs md:text-sm transition-colors ${
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card text-foreground hover:bg-muted"
                        }`}
                      >
                        {type === "all" ? "All" : type}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Tags dropdown */}
              {globalTags.length > 0 && (
                <div className="static sm:relative" ref={tagDropdownRef}>
                  <button
                    onClick={() => { setTagDropdownOpen((o) => !o); setTagFilterInput(""); }}
                    className={`flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 border rounded-lg text-xs md:text-sm transition-colors ${
                      selectedTagIds.length > 0
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-foreground hover:bg-muted"
                    }`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
                    </svg>
                    <span className="hidden sm:inline">Tags</span>
                    {selectedTagIds.length > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold bg-primary text-primary-foreground">
                        {selectedTagIds.length}
                      </span>
                    )}
                    <svg className={`hidden sm:block w-3.5 h-3.5 transition-transform ${tagDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {tagDropdownOpen && (
                    <div className="fixed sm:absolute inset-x-3 sm:inset-x-auto z-50 top-auto sm:top-full mt-1.5 sm:left-0 w-auto sm:w-64 bg-background border border-border rounded-xl shadow-xl">
                      <div className="px-3 pt-3 pb-2 border-b border-border">
                        <input
                          autoFocus
                          type="text"
                          placeholder="Filter tags…"
                          value={tagFilterInput}
                          onChange={(e) => setTagFilterInput(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-border bg-card focus-visible:outline-none focus:border-foreground/30"
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto">
                        {globalTags.filter((t) => t.name.toLowerCase().includes(tagFilterInput.toLowerCase())).length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-4">No matches</p>
                        ) : (
                          globalTags
                            .filter((t) => t.name.toLowerCase().includes(tagFilterInput.toLowerCase()))
                            .map((tag) => {
                              const active = selectedTagIds.includes(tag.id);
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => toggleTagFilter(tag.id)}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted transition-colors text-left"
                                >
                                  <span className="w-4 flex-shrink-0 flex items-center justify-center">
                                    {active && (
                                      <svg className="w-3.5 h-3.5 text-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </span>
                                  <span className="w-3 h-3 rounded-full flex-shrink-0 border border-black/10" style={{ backgroundColor: tag.color }} />
                                  <span className="text-sm text-foreground">{tag.name}</span>
                                </button>
                              );
                            })
                        )}
                      </div>
                      {selectedTagIds.length > 0 && (
                        <div className="border-t border-border">
                          <button
                            onClick={() => setSelectedTagIds([])}
                            className="w-full px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-left"
                          >
                            Clear all tags
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
              <button
                onClick={() => { if (selectionMode) exitSelection(); else setSelectionMode(true); }}
                className={`px-2 md:px-3 py-1.5 rounded-lg border text-xs md:text-sm font-medium transition-colors ${
                  selectionMode
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground hover:bg-muted"
                }`}
                title={selectionMode ? "Exit selection" : "Select decks"}
              >
                {selectionMode ? "Done" : "Select"}
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 md:p-2 rounded ${
                  viewMode === "grid"
                    ? "bg-muted"
                    : "hover:bg-muted"
                }`}
                title="Grid view"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 md:p-2 rounded ${
                  viewMode === "list"
                    ? "bg-muted"
                    : "hover:bg-muted"
                }`}
                title="List view"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Active tag pills banner */}
          {selectedTagIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-xs text-muted-foreground">Filtered by:</span>
              {selectedTagIds.map((id) => {
                const tag = globalTags.find((t) => t.id === id);
                if (!tag) return null;
                return (
                  <button
                    key={id}
                    onClick={() => toggleTagFilter(id)}
                    className="flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-xs font-medium"
                    style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                  >
                    {tag.name}
                    <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}

          {/* Bulk action bar (selection mode) */}
          {selectionMode && (
            <div className="sticky top-2 z-30 mb-3 flex items-center gap-2 md:gap-3 rounded-lg border border-primary/40 bg-card/95 backdrop-blur px-3 py-2 shadow-sm">
              <span className="text-sm font-medium flex-shrink-0">
                {selectedIds.length} selected
              </span>
              <button
                onClick={() => {
                  const visibleIds = sortedDecks.map((d) => d.id!);
                  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
                  setSelectedIds(allSelected ? [] : visibleIds);
                }}
                className="text-xs md:text-sm text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                {sortedDecks.length > 0 && sortedDecks.every((d) => selectedIds.includes(d.id!)) ? "Clear" : "Select all"}
              </button>

              <div className="flex-1" />

              <div className="relative" ref={bulkMoveRef}>
                <button
                  onClick={() => setBulkMoveOpen((o) => !o)}
                  disabled={selectedIds.length === 0}
                  className="flex items-center gap-1 px-2.5 md:px-3 py-1.5 rounded-md border border-border bg-card text-xs md:text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Move to
                  <svg className={`w-3.5 h-3.5 transition-transform ${bulkMoveOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {bulkMoveOpen && selectedIds.length > 0 && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-card rounded-md shadow-lg border border-border z-40 max-h-60 overflow-y-auto">
                    <button
                      onClick={() => handleBulkMove(null)}
                      className="w-full text-left px-4 py-2 hover:bg-muted first:rounded-t-md text-sm"
                    >
                      My Decks
                    </button>
                    {folders.map((folder) => (
                      <button
                        key={folder.id}
                        onClick={() => handleBulkMove(folder.id!)}
                        className="w-full text-left px-4 py-2 hover:bg-muted last:rounded-b-md text-sm truncate"
                      >
                        {folder.name}
                      </button>
                    ))}
                    {folders.length === 0 && (
                      <div className="px-4 py-2 text-sm text-muted-foreground">No folders</div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.length === 0}
                className="flex items-center gap-1 px-2.5 md:px-3 py-1.5 rounded-md text-xs md:text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            </div>
          )}

          {/* Decks Display */}
          {typeFilteredDecks.length === 0 ? (
            <div className="text-center py-16">
              <svg
                className="mx-auto h-24 w-24 text-muted-foreground"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <h3 className="mt-4 text-lg font-medium text-foreground">
                {searchQuery.trim()
                  ? `No decks matching "${searchQuery.trim()}"${searchAllFolders ? " across all folders" : ""}`
                  : selectedTagIds.length > 0
                    ? "No decks match the selected tags"
                    : `No decks in ${selectedFolderName.toLowerCase()}`}
              </h3>
              <p className="mt-2 text-muted-foreground">
                {searchQuery.trim()
                  ? "Try a different search term."
                  : selectedTagIds.length > 0
                    ? "Try removing some tag filters."
                    : selectedFolder ? "Create a new deck or move existing decks to this folder." : "Get started by creating your first deck!"}
              </p>
              <button
                onClick={handleNewDeck}
                className="mt-6 px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium transition-colors"
              >
                Create A Deck
              </button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-6">
              {sortedDecks.map((deck) => (
                <DeckCard
                  key={deck.id}
                  deck={deck}
                  folders={folders}
                  selectionMode={selectionMode}
                  selected={selectedIds.includes(deck.id!)}
                  onToggleSelect={() => toggleSelect(deck.id!)}
                  onEdit={handleEditDeck}
                  onDelete={(id, name) => setDeckToDelete({ id, name })}
                  onDuplicate={handleDuplicateDeck}
                  onMove={handleMoveDeck}
                  onGeneratePDF={handleGeneratePDF}
                  onGenerateImage={handleGenerateImage}
                  onDownload={handleDownload}
                  onShare={(id) => setShareDeckId(id)}
                  onEditCover={(id) => setCoverPickerDeckId(id)}
                  onQuickLook={(id) => setQuickLookDeckId(id)}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {sortedDecks.map((deck) => (
                <DeckListItem
                  key={deck.id}
                  deck={deck}
                  folders={folders}
                  selectionMode={selectionMode}
                  selected={selectedIds.includes(deck.id!)}
                  onToggleSelect={() => toggleSelect(deck.id!)}
                  onEdit={handleEditDeck}
                  onDelete={(id, name) => setDeckToDelete({ id, name })}
                  onDuplicate={handleDuplicateDeck}
                  onMove={handleMoveDeck}
                  onGeneratePDF={handleGeneratePDF}
                  onGenerateImage={handleGenerateImage}
                  onDownload={handleDownload}
                  onShare={(id) => setShareDeckId(id)}
                  onQuickLook={(id) => setQuickLookDeckId(id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deckToDelete && (
        <DeleteDeckModal
          deckName={deckToDelete.name}
          onConfirm={() => handleDeleteDeck(deckToDelete.id)}
          onClose={() => setDeckToDelete(null)}
        />
      )}

      {/* Folder Modal */}
      {folderModal && (
        <FolderModal
          mode={folderModal.mode}
          initialName={folderModal.initialName}
          onConfirm={(name) => {
            if (folderModal.mode === "create") {
              handleCreateFolder(name);
            } else if (folderModal.folderId) {
              handleRenameFolder(folderModal.folderId, name);
            }
          }}
          onClose={() => setFolderModal(null)}
        />
      )}

      {/* Delete Folder Confirmation */}
      {folderToDelete && (
        <DeleteFolderModal
          folderName={folderToDelete.name}
          deckCount={decks.filter((d) => d.folder_id === folderToDelete.id).length}
          onConfirm={() => handleDeleteFolder(folderToDelete.id)}
          onClose={() => setFolderToDelete(null)}
        />
      )}

      {/* Generate PDF Modal */}
      {pdfDeck && (
        <GeneratePDFModal
          deck={pdfDeck}
          onClose={() => { setPdfDeck(null); setPdfDeckLegal(null); }}
          isLegal={pdfDeckLegal}
        />
      )}

      {/* Generate Image Modal */}
      {imageDeck && (
        <GenerateDeckImageModal
          deck={imageDeck}
          onClose={() => { setImageDeck(null); setImageDeckLegal(null); }}
          isLegal={imageDeckLegal}
        />
      )}

      {/* Share / visibility modal */}
      {(() => {
        const shareDeck = decks.find(d => d.id === shareDeckId);
        return shareDeck ? (
          <ShareDeckModal
            open={true}
            onOpenChange={(open) => { if (!open) setShareDeckId(null); }}
            deckId={shareDeck.id!}
            deckName={shareDeck.name}
            visibility={deckVisibility(shareDeck)}
            onSetVisibility={(v) => handleSetVisibility(shareDeck.id!, v)}
          />
        ) : null;
      })()}

      {/* Username Modal */}
      {usernameModalDeckId && (
        <UsernameModal
          onSuccess={handleUsernameSet}
          onClose={() => setUsernameModalDeckId(null)}
        />
      )}

      {coverPickerDeckId && (() => {
        const coverDeck = decks.find(d => d.id === coverPickerDeckId);
        return coverDeck ? (
          <CoverPickerModal
            deckId={coverPickerDeckId}
            initialCard1={coverDeck.preview_card_1 ?? null}
            initialCard2={coverDeck.preview_card_2 ?? null}
            onClose={() => setCoverPickerDeckId(null)}
            onSaved={(deckId, card1, card2) => {
              setDecks(prev => prev.map(d =>
                d.id === deckId ? { ...d, preview_card_1: card1, preview_card_2: card2 } : d
              ));
            }}
          />
        ) : null;
      })()}

      {/* Quick look modal */}
      {quickLookDeckId && (() => {
        const qlDeck = decks.find((d) => d.id === quickLookDeckId);
        return qlDeck ? (
          <QuickLookModal
            deckId={quickLookDeckId}
            deckName={qlDeck.name}
            onClose={() => setQuickLookDeckId(null)}
            onOpenEditor={(id) => { setQuickLookDeckId(null); handleEditDeck(id); }}
          />
        ) : null;
      })()}

      {/* Inline toast / snackbar */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-4 left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0 z-[60]",
            "max-w-[calc(100vw-2rem)] md:max-w-sm bg-card border border-border text-foreground shadow-lg rounded-lg px-4 py-3 flex items-center gap-3",
            toast.type === "error" && "border-l-2 border-l-red-500",
          )}
        >
          <span className="text-sm flex-1 min-w-0">{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.onClick();
              }}
              className="flex-shrink-0 min-h-[40px] px-3 -my-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {toast.action.label}
            </button>
          )}
          <button
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="flex-shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

// Folder Item Component
function FolderItem({
  folder,
  isSelected,
  deckCount,
  onSelect,
  onRename,
  onDelete,
  onDropDeck,
}: {
  folder: FolderData;
  isSelected: boolean;
  deckCount: number;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDropDeck: (deckId: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div className="relative">
      <div
        onClick={onSelect}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!isDragOver) setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const id = e.dataTransfer.getData("text/plain");
          if (id) onDropDeck(id);
        }}
        className={cn(
          "w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer",
          isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted",
          isDragOver && "ring-2 ring-primary bg-primary/10",
        )}
      >
        <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <span className="flex-1 truncate">{folder.name}</span>
        <span className="text-sm text-muted-foreground">{deckCount}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          aria-label="Folder menu"
          className="p-1 hover:bg-muted rounded"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
          </svg>
        </button>
      </div>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
          <div className="absolute right-0 mt-1 w-48 bg-card rounded-md shadow-lg border border-border z-20">
            <button
              onClick={() => {
                onRename();
                setShowMenu(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted first:rounded-t-md"
            >
              Rename
            </button>
            <button
              onClick={() => {
                onDelete();
                setShowMenu(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-red-100 dark:hover:bg-red-900 text-red-600 dark:text-red-400 last:rounded-b-md"
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Deck Card Component (Grid View)
function DeckCard({
  deck,
  folders,
  selectionMode,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
  onGeneratePDF,
  onGenerateImage,
  onDownload,
  onShare,
  onEditCover,
  onQuickLook,
}: {
  deck: DeckData;
  folders: FolderData[];
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (deckId: string, folderId: string | null) => void;
  onGeneratePDF: (deckId: string) => void;
  onGenerateImage: (deckId: string) => void;
  onDownload: (deckId: string) => void;
  onShare: (deckId: string) => void;
  onEditCover: (deckId: string) => void;
  onQuickLook: (deckId: string) => void;
}) {
  const updatedRelative = formatRelativeTime(deck.updated_at!);
  const updatedAbsolute = formatDateTime(deck.updated_at!);
  const openCard = () => (selectionMode ? onToggleSelect() : onEdit(deck.id!));

  return (
    <div
      draggable={!selectionMode}
      onDragStart={(e) => {
        if (selectionMode) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", deck.id!);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={selectionMode ? onToggleSelect : undefined}
      className={cn(
        "group relative bg-gradient-to-br from-card to-muted/40 rounded-lg border hover:shadow-lg transition-shadow flex flex-col jayden-gradient-bg",
        selectionMode && "cursor-pointer select-none",
        selected ? "border-primary ring-2 ring-primary" : "border-border",
      )}
    >
      {/* Selection checkbox (selection mode) */}
      {selectionMode && (
        <span
          className={cn(
            "absolute top-2 left-2 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center shadow",
            selected ? "bg-primary border-primary text-primary-foreground" : "bg-card/90 border-border text-transparent",
          )}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
      {/* Image Header */}
      {formatDeckType(deck.format) === "Paragon" && deck.paragon ? (
        <div className="h-32 overflow-hidden rounded-t-lg cursor-pointer" onClick={openCard}>
          <Image
            src={`/paragons/Paragon ${deck.paragon}.png`}
            alt={deck.paragon}
            width={400}
            height={560}
            draggable={false}
            className="w-full h-full object-cover object-top"
          />
        </div>
      ) : (getCardImageUrlOrNull(deck.preview_card_1) || getCardImageUrlOrNull(deck.preview_card_2)) ? (
        <div className="relative h-32 overflow-hidden rounded-t-lg flex items-center justify-center gap-1 px-2 py-2 cursor-pointer" onClick={openCard}>
          {getCardImageUrlOrNull(deck.preview_card_1) && <img src={getCardImageUrlOrNull(deck.preview_card_1)!} alt="" draggable={false} className="h-full object-contain rounded shadow-md" />}
          {getCardImageUrlOrNull(deck.preview_card_2) && <img src={getCardImageUrlOrNull(deck.preview_card_2)!} alt="" draggable={false} className="h-full object-contain rounded shadow-md" />}
          {!selectionMode && <button
            onClick={(e) => { e.stopPropagation(); onEditCover(deck.id!); }}
            className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/30 hover:bg-black/50 text-white/60 hover:text-white transition-colors"
            title="Change cover cards"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>}
        </div>
      ) : formatDeckType(deck.format) !== "Paragon" ? (
        <div
          className="h-8 group-hover:h-12 rounded-t-lg bg-muted/40 group-hover:bg-muted flex items-center justify-center transition-all"
          onClick={selectionMode ? onToggleSelect : undefined}
        >
          <button
            onClick={() => { if (!selectionMode) onEditCover(deck.id!); }}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/60 group-hover:text-muted-foreground hover:!text-foreground transition-colors"
            title="Set cover cards"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
            </svg>
            Add cover
          </button>
        </div>
      ) : null}

      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h3 className="font-semibold text-lg truncate">{deck.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${visibilityBadge(deckVisibility(deck)).classes}`}>
              {visibilityBadge(deckVisibility(deck)).label}
            </span>
          </div>
          {!selectionMode && (
            <DropdownMenu
              folders={folders}
              currentFolderId={deck.folder_id}
              onQuickLook={() => onQuickLook(deck.id!)}
              onEdit={() => onEdit(deck.id!)}
              onDelete={() => onDelete(deck.id!, deck.name)}
              onDuplicate={() => onDuplicate(deck.id!)}
              onMove={(folderId) => onMove(deck.id!, folderId)}
              onGeneratePDF={() => onGeneratePDF(deck.id!)}
              onGenerateImage={() => onGenerateImage(deck.id!)}
              onDownload={() => onDownload(deck.id!)}
              onShare={() => onShare(deck.id!)}
            />
          )}
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <span className={FORMAT_CHIP}>
              {formatDeckType(deck.format)}
            </span>
            <span className="text-muted-foreground">
              {deck.card_count || 0} cards
            </span>
            {deck.total_price != null && deck.total_price > 0 && (
              <span className="text-green-600 dark:text-green-400">${deck.total_price.toFixed(2)}</span>
            )}
            {deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
              <span className="text-[10px] text-muted-foreground" title={`Minimum price using cheapest available printings: $${deck.budget_price.toFixed(2)}`}>
                min ${deck.budget_price.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {deck.tags && deck.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2 mb-3">
            {deck.tags.slice(0, 6).map((tag) => (
              <span
                key={tag.id}
                className="px-2 py-0.5 rounded-full text-xs font-medium"
                style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground" title={updatedAbsolute}>
            Updated {updatedRelative}
          </p>
        </div>
      </div>

      <div className={cn("border-t border-border px-4 py-3 flex gap-2", selectionMode && "pointer-events-none opacity-40")}>
        <button
          onClick={() => onEdit(deck.id!)}
          className="flex-1 px-4 py-2 bg-muted text-foreground rounded-md hover:bg-muted/80 font-medium transition-colors"
        >
          Open Deck
        </button>
        <GoldfishButton deckId={deck.id} deckName={deck.name} format={deck.format} iconOnly />
      </div>
    </div>
  );
}

// Deck List Item Component (List View)
function DeckListItem({
  deck,
  folders,
  selectionMode,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
  onGeneratePDF,
  onGenerateImage,
  onDownload,
  onShare,
  onQuickLook,
}: {
  deck: DeckData;
  folders: FolderData[];
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (deckId: string, folderId: string | null) => void;
  onGeneratePDF: (deckId: string) => void;
  onGenerateImage: (deckId: string) => void;
  onDownload: (deckId: string) => void;
  onShare: (deckId: string) => void;
  onQuickLook: (deckId: string) => void;
}) {
  const updatedRelative = formatRelativeTime(deck.updated_at!);
  const updatedAbsolute = formatDateTime(deck.updated_at!);

  return (
    <div
      draggable={!selectionMode}
      onDragStart={(e) => {
        if (selectionMode) { e.preventDefault(); return; }
        e.dataTransfer.setData("text/plain", deck.id!);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={selectionMode ? onToggleSelect : undefined}
      className={cn(
        "bg-card rounded-lg border transition-colors",
        selectionMode ? "cursor-pointer select-none" : "hover:bg-muted",
        selected ? "border-primary ring-2 ring-primary" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 md:gap-4 p-3 md:p-4">
        {selectionMode && (
          <span
            className={cn(
              "flex-shrink-0 w-6 h-6 rounded-md border-2 flex items-center justify-center",
              selected ? "bg-primary border-primary text-primary-foreground" : "bg-card border-border text-transparent",
            )}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 md:gap-3">
            <span className={FORMAT_CHIP}>
              {formatDeckType(deck.format)}
            </span>
            <h3 className="font-semibold truncate text-sm md:text-base">{deck.name}</h3>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${visibilityBadge(deckVisibility(deck)).classes}`}>
              {visibilityBadge(deckVisibility(deck)).label}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground md:hidden">
            <span>{deck.card_count || 0} cards</span>
            {deck.total_price != null && deck.total_price > 0 && (
              <span className="text-green-600 dark:text-green-400">${deck.total_price.toFixed(2)}</span>
            )}
            {deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
              <span className="text-[10px] text-muted-foreground" title={`Minimum price using cheapest available printings: $${deck.budget_price.toFixed(2)}`}>
                min ${deck.budget_price.toFixed(2)}
              </span>
            )}
          </div>
          {deck.tags && deck.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {deck.tags.slice(0, 6).map((tag) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: tag.color, color: getContrastColor(tag.color) }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <span>{deck.card_count || 0} cards</span>
          {deck.total_price != null && deck.total_price > 0 && (
            <span className="text-green-600 dark:text-green-400">${deck.total_price.toFixed(2)}</span>
          )}
          {deck.budget_price != null && deck.total_price != null && deck.budget_price < deck.total_price - 0.005 && (
            <span className="text-xs text-muted-foreground" title={`Minimum price using cheapest available printings: $${deck.budget_price.toFixed(2)}`}>
              min ${deck.budget_price.toFixed(2)}
            </span>
          )}
          <span className="text-xs" title={updatedAbsolute}>Updated {updatedRelative}</span>
        </div>

        {!selectionMode && (
          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            <button
              onClick={() => onEdit(deck.id!)}
              className="px-2 md:px-4 py-1.5 md:py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-xs md:text-sm font-medium transition-colors"
            >
              Edit
            </button>
            <DropdownMenu
              folders={folders}
              currentFolderId={deck.folder_id}
              onQuickLook={() => onQuickLook(deck.id!)}
              onEdit={() => onEdit(deck.id!)}
              onDelete={() => onDelete(deck.id!, deck.name)}
              onDuplicate={() => onDuplicate(deck.id!)}
              onMove={(folderId) => onMove(deck.id!, folderId)}
              onGeneratePDF={() => onGeneratePDF(deck.id!)}
              onGenerateImage={() => onGenerateImage(deck.id!)}
              onDownload={() => onDownload(deck.id!)}
              onShare={() => onShare(deck.id!)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Dropdown Menu Component
function DropdownMenu({
  folders,
  currentFolderId,
  onQuickLook,
  onEdit,
  onDelete,
  onDuplicate,
  onMove,
  onGeneratePDF,
  onGenerateImage,
  onDownload,
  onShare,
}: {
  folders: FolderData[];
  currentFolderId?: string | null;
  onQuickLook: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (folderId: string | null) => void;
  onGeneratePDF: () => void;
  onGenerateImage: () => void;
  onDownload: () => void;
  onShare: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function handleToggle() {
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const menuHeight = 400; // conservative estimate for full menu
      const openUp = spaceBelow < menuHeight && rect.top > spaceBelow;

      setMenuStyle({
        position: "fixed" as const,
        right: window.innerWidth - rect.right,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        zIndex: 50,
      });
    }
    setIsOpen(!isOpen);
  }

  // Reposition on scroll/resize while open
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    function reposition() {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUp = spaceBelow < 400 && rect.top > spaceBelow;
      setMenuStyle({
        position: "fixed" as const,
        right: window.innerWidth - rect.right,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
        zIndex: 50,
      });
    }
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="p-1 hover:bg-muted rounded"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setIsOpen(false);
              setShowMoveMenu(false);
            }}
          />
          <div
            ref={menuRef}
            style={menuStyle}
            className="w-52 bg-card rounded-md shadow-lg border border-border max-h-[calc(100vh-2rem)] overflow-y-auto"
          >
            <button
              onClick={() => {
                onQuickLook();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted first:rounded-t-md flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              Quick look
            </button>
            <button
              onClick={() => {
                onEdit();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
            <button
              onClick={() => {
                onDuplicate();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Duplicate
            </button>
            <button
              onClick={() => {
                onGeneratePDF();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Generate PDF
            </button>
            <button
              onClick={() => {
                onGenerateImage();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Generate Image
            </button>
            <button
              onClick={() => {
                onDownload();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download .txt
            </button>

            {/* Sharing section */}
            <div className="border-t border-border my-1"></div>
            <button
              onClick={() => {
                onShare();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-muted flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share…
            </button>

            {/* Move to Folder submenu (expands inline so it isn't clipped by the menu's scroll container) */}
            <div className="border-t border-border my-1"></div>
            <button
              onClick={() => setShowMoveMenu(!showMoveMenu)}
              className="w-full text-left px-4 py-2 hover:bg-muted flex items-center gap-2"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <span className="flex-1">Move to...</span>
              <svg className={`w-4 h-4 transition-transform ${showMoveMenu ? "rotate-90" : ""}`} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
            </button>

            {showMoveMenu && (
              <div className="bg-muted/40">
                <button
                  onClick={() => {
                    onMove(null);
                    setIsOpen(false);
                    setShowMoveMenu(false);
                  }}
                  className={`w-full text-left pl-11 pr-4 py-2 text-sm hover:bg-muted ${
                    !currentFolderId ? "bg-primary/10" : ""
                  }`}
                >
                  My Decks
                </button>
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => {
                      onMove(folder.id!);
                      setIsOpen(false);
                      setShowMoveMenu(false);
                    }}
                    className={`w-full text-left pl-11 pr-4 py-2 text-sm truncate hover:bg-muted ${
                      currentFolderId === folder.id ? "bg-primary/10" : ""
                    }`}
                  >
                    {folder.name}
                  </button>
                ))}
                {folders.length === 0 && (
                  <div className="pl-11 pr-4 py-2 text-sm text-muted-foreground">
                    No folders available
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-border my-1"></div>
            <button
              onClick={() => {
                onDelete();
                setIsOpen(false);
              }}
              className="w-full text-left px-4 py-2 hover:bg-red-100 dark:hover:bg-red-900 text-red-600 dark:text-red-400 last:rounded-b-md flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Cover Picker Modal — pick preview cards for a deck
function CoverPickerModal({
  deckId,
  initialCard1,
  initialCard2,
  onClose,
  onSaved,
}: {
  deckId: string;
  initialCard1: string | null;
  initialCard2: string | null;
  onClose: () => void;
  onSaved: (deckId: string, card1: string | null, card2: string | null) => void;
}) {
  const [cards, setCards] = useState<DeckCardData[]>([]);
  const [sortInfo, setSortInfo] = useState<Record<string, SortableCard>>({});
  const [loading, setLoading] = useState(true);
  const [previewCard1, setPreviewCard1] = useState<string | null>(initialCard1);
  const [previewCard2, setPreviewCard2] = useState<string | null>(initialCard2);
  const [activeSlot, setActiveSlot] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [coverSearch, setCoverSearch] = useState("");

  useEffect(() => {
    let active = true;
    loadDeckByIdAction(deckId).then(async (result) => {
      if (!active) return;
      if (result.success && result.deck) {
        const mainCards = ((result.deck as any).cards?.filter((c: DeckCardData) => c.zone === 'main') || []) as DeckCardData[];
        setCards(mainCards);
        setLoading(false);
        const info = await buildSortInfo(mainCards);
        if (active) setSortInfo(info);
      } else {
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [deckId]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const filteredCards = coverSearch.trim()
    ? cards.filter(c => c.card_name.toLowerCase().includes(coverSearch.trim().toLowerCase()))
    : cards;
  // Canonical default sort — consistent with quick look.
  const sortedCards = [...filteredCards].sort((a, b) => compareDeckCards(sortInfo, a, b));

  async function handleSelect(imgFile: string) {
    const c1 = activeSlot === 1 ? imgFile : previewCard1;
    const c2 = activeSlot === 2 ? imgFile : previewCard2;
    if (activeSlot === 1) setPreviewCard1(imgFile);
    else setPreviewCard2(imgFile);
    const nextSlot = activeSlot === 1 ? 2 : 1;
    setActiveSlot(nextSlot as 1 | 2);
    setSaving(true);
    const result = await updateDeckPreviewCardsAction(deckId, c1, c2);
    setSaving(false);
    if (result.success) {
      onSaved(deckId, c1, c2);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/60" onClick={onClose}>
      <div className="bg-background rounded-t-xl sm:rounded-xl shadow-2xl w-full sm:max-w-2xl flex flex-col max-h-[95vh] sm:max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-5 pb-3 border-b border-border flex-shrink-0">
          <h2 className="text-base sm:text-lg font-semibold">Cover Cards</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Card slots */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex-shrink-0">
          <div className="flex gap-4 justify-center mb-2">
            {([1, 2] as const).map((slot) => {
              const imgFile = slot === 1 ? previewCard1 : previewCard2;
              const imgUrl = imgFile ? getCardImageUrlOrNull(imgFile) : null;
              const isActive = activeSlot === slot;
              return (
                <button
                  key={slot}
                  onClick={() => setActiveSlot(slot)}
                  className={`relative w-16 sm:w-24 aspect-[2.5/3.5] rounded-lg overflow-hidden border-2 transition-all ${
                    isActive
                      ? "border-primary"
                      : "border-border hover:border-foreground/50"
                  } bg-muted`}
                >
                  {imgUrl ? (
                    <img src={imgUrl} alt={`Cover ${slot}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground">
                      <svg className="w-5 h-5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="text-[10px]">Card {slot}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-center text-xs text-muted-foreground">
            {saving ? "Saving..." : `Click a card below to set cover card ${activeSlot}`}
          </p>
        </div>

        {/* Search */}
        <div className="px-4 sm:px-6 pb-3 flex-shrink-0">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search cards..."
              value={coverSearch}
              onChange={(e) => setCoverSearch(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 text-sm border border-border rounded-lg bg-card focus-visible:outline-none focus:border-foreground/30"
            />
            {coverSearch && (
              <button onClick={() => setCoverSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin" />
            </div>
          ) : cards.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">No cards in this deck yet.</p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-2">
              {sortedCards.map((card) => (
                <button
                  key={`${card.card_name}|${card.card_set}`}
                  onClick={() => handleSelect(card.card_img_file || "")}
                  className="relative rounded-lg overflow-hidden border border-border hover:border-primary hover:scale-105 transition-all"
                  style={{ aspectRatio: "2.5/3.5" }}
                  title={card.card_name}
                >
                  <img src={getCardImageUrlOrNull(card.card_img_file || "") || ""} alt={card.card_name} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
