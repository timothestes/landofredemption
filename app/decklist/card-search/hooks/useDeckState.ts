import { useState, useEffect, useCallback, useRef } from "react";
import { Card, sanitizeImgFile } from "../utils";
import { Deck, DeckCard, DeckStats, DeckZone, DeckVisibility } from "../types/deck";
import { saveDeckAction, loadDeckByIdAction, DeckCardData } from "../../actions";
import { ALL_CARDS, CARD_BY_FULL_KEY } from "../data/cardIndex";
import { buildReplacedHalf, type ReplaceAlignment } from "../utils/replaceHalf";
import { applyZoneMoves, type ZoneMove } from "../utils/zoneMoves";
import type { DeckBuilderPersistence } from "../builderConfig";
import { pickCovers } from "../../pickCovers";
import { deckHasContent, openDraftTab, writeDraft, writeDraftSnapshot, type DraftTab } from "../utils/deckDrafts";

// Public default persistence: the `decks` table. Module-level so it's a stable
// reference (no re-creation per render) when no override is injected.
const DEFAULT_PERSISTENCE: DeckBuilderPersistence = {
  save: saveDeckAction,
  loadById: loadDeckByIdAction,
};

// Stable serialization of the persisted parts of a deck for change detection.
// Drives the "Unsaved Changes" indicator and skips no-op saves.
export function snapshotDeck(d: Deck): string {
  const sortedCards = d.cards
    .map((c) => `${c.card.name}|${c.card.set}|${c.quantity}|${c.zone}`)
    .sort()
    .join("§");
  return JSON.stringify({
    id: d.id ?? null,
    name: d.name,
    description: d.description ?? "",
    format: d.format ?? null,
    paragon: d.paragon ?? null,
    folderId: d.folderId ?? null,
    isPublic: d.isPublic ?? false,
    previewCard1: d.previewCard1 ?? null,
    previewCard2: d.previewCard2 ?? null,
    cards: sortedCards,
  });
}

/** The two covers a save of this deck stores, and that the Details tab shows (see pickCovers). */
export function deckCovers(d: Deck): [string | null, string | null] {
  return pickCovers(
    [d.previewCard1, d.previewCard2],
    d.cards.map((dc) => ({
      imgFile: dc.card.imgFile,
      name: dc.card.name,
      type: dc.card.type,
      zone: dc.zone,
      quantity: dc.quantity,
    })),
    (file) => ALL_CARDS.find((c) => c.imgFile === file)?.name,
  );
}

/**
 * Whether the persist effect may write the in-memory deck to localStorage yet.
 * The initial read from storage is deferred a tick (so searchParams settle), but
 * the persist effect fires on the very first render with the SSR default deck —
 * writing that would clobber the draft the read is about to restore. That was
 * the "add a card, reload, deck is empty" bug.
 */
export function canPersistDeckToStorage(state: {
  hasLoadedFromStorage: boolean;
  localStoragePersist: boolean;
}): boolean {
  return state.localStoragePersist && state.hasLoadedFromStorage;
}

/**
 * Whether loading `incomingDeckId` would silently destroy a draft restored from
 * localStorage: it is a different deck, it has cards, and it does not match the
 * last cloud-synced snapshot (never saved, or edited since). A clean cloud deck
 * left in storage is not displaced work — switching decks must not nag.
 */
export function isDisplacedDraft(
  draft: Deck,
  savedSnapshot: string | null,
  incomingDeckId: string
): boolean {
  if (draft.id === incomingDeckId) return false;
  if (!draft.cards.some((c) => c.quantity > 0)) return false;
  return snapshotDeck(draft) !== savedSnapshot;
}

/**
 * Sync status for cloud operations
 */
export interface SyncStatus {
  isSaving: boolean;
  lastSavedAt: Date | null;
  error: string | null;
}

/**
 * Custom hook for managing deck state with localStorage persistence and cloud sync
 */
export function useDeckState(
  initialDeckId?: string,
  initialFolderId?: string | null,
  isNewDeck?: boolean,
  options?: { persistence?: DeckBuilderPersistence; localStoragePersist?: boolean }
) {
  // Injected persistence + localStorage gate. Held in refs so async callbacks and
  // effects read the latest without threading them through dependency arrays.
  const persistenceRef = useRef<DeckBuilderPersistence>(options?.persistence ?? DEFAULT_PERSISTENCE);
  persistenceRef.current = options?.persistence ?? DEFAULT_PERSISTENCE;
  const localStoragePersist = options?.localStoragePersist ?? true;
  const localStoragePersistRef = useRef(localStoragePersist);
  localStoragePersistRef.current = localStoragePersist;

  // Initialize with default deck to avoid hydration mismatch
  const [deck, setDeck] = useState<Deck>(getDefaultDeck);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    isSaving: false,
    lastSavedAt: null,
    error: null,
  });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const isInitialMount = useRef(true);
  const hasLoadedFromStorage = useRef(false);

  // Mirror of `deck` for use inside async callbacks that need the latest deck without a stale closure
  const deckRef = useRef(deck);
  // Snapshot of the most recently saved (or just-loaded) deck — drives the dirty flag and skips no-op saves
  const lastSavedSnapshotRef = useRef<string | null>(null);
  // Serializes saves so two saves can't race
  const savePromiseRef = useRef<Promise<unknown> | null>(null);
  // A `?deckId=` open that was held back because it would replace an unsaved
  // draft on this device. The host shows the draft and confirms before loading.
  const [deferredDeckId, setDeferredDeckId] = useState<string | null>(null);

  // This tab's slot for the deck in progress (see utils/deckDrafts). Null until
  // the tab has claimed it, and always null when the host turns storage off.
  const draftTabRef = useRef<DraftTab | null>(null);

  // Record the cloud-synced state in memory and on this device.
  const commitSavedSnapshot = (snapshot: string) => {
    lastSavedSnapshotRef.current = snapshot;
    const tab = draftTabRef.current;
    if (tab) writeDraftSnapshot(tab.store, tab.tabId, snapshot);
  };

  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  // On mount, claim this tab's storage slot, then open what the URL asked for:
  // the cloud deck for ?deckId=, a blank deck for New Deck, otherwise this tab's
  // deck in progress (or one a closed tab left). Runs once, with the first
  // render's URL — the host's URL sync rewrites the address before a deck has
  // loaded. Deferred a tick so React's dev double-mount clears the timer
  // instead of claiming the slot twice.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const restoring = !initialDeckId && !isNewDeck;
      let tab: DraftTab | null = null;
      if (localStoragePersistRef.current) {
        try {
          tab = await openDraftTab(restoring);
        } catch (error) {
          // Storage blocked (private mode, site data off): build without it.
          console.error("Error opening deck storage:", error);
        }
        if (cancelled) {
          tab?.release();
          return;
        }
      }
      draftTabRef.current = tab;
      hasLoadedFromStorage.current = true;
      const draft = tab?.draft ?? null;

      if (initialDeckId) {
        // Loading the cloud deck also persists it over this tab's draft. If
        // that draft is unsaved work (an anonymous deck, or edits never
        // synced), show it instead and let the host confirm.
        if (draft && isDisplacedDraft(draft.deck, draft.savedSnapshot, initialDeckId)) {
          lastSavedSnapshotRef.current = draft.savedSnapshot;
          setDeck(draft.deck);
          setIsInitializing(false);
          setDeferredDeckId(initialDeckId);
        } else {
          loadDeckFromCloud(initialDeckId);
        }
      } else if (isNewDeck) {
        // Create a fresh blank deck (with optional folderId)
        console.log('[useDeckState] Creating new deck with folderId:', initialFolderId);
        setDeck({
          name: "Untitled Deck",
          cards: [],
          description: "",
          format: undefined,
          folderId: initialFolderId || undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        setHasUnsavedChanges(false);
        setIsInitializing(false);
      } else {
        if (draft && deckHasContent(draft.deck)) {
          // Restore the sync baseline too, so a clean cloud deck reopened from
          // the bare URL is not flagged as unsaved.
          lastSavedSnapshotRef.current = draft.savedSnapshot;
          setDeck(draft.deck);
        }
        setIsInitializing(false);
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      // Closing the builder frees this tab's deck for another tab to pick up.
      draftTabRef.current?.release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the first render's URL only (see above)
  }, []);

  // Persist the deck to this tab's slot whenever it changes — but not before
  // the tab has opened its deck, or the SSR default overwrites the draft.
  useEffect(() => {
    const tab = draftTabRef.current;
    if (
      tab &&
      canPersistDeckToStorage({
        hasLoadedFromStorage: hasLoadedFromStorage.current,
        localStoragePersist: localStoragePersistRef.current,
      })
    ) {
      writeDraft(tab.store, tab.tabId, deck, lastSavedSnapshotRef.current);
    }

    // Derive the dirty flag from the saved-snapshot ref so it reflects reality
    // after both edits and successful saves (rather than always flipping to true).
    if (!isInitialMount.current) {
      setHasUnsavedChanges(snapshotDeck(deck) !== lastSavedSnapshotRef.current);
    }
  }, [deck]);

  // After the persist effect's first run: the default deck on the first render
  // is not an unsaved change.
  useEffect(() => {
    isInitialMount.current = false;
  }, []);

  /**
   * Load deck from cloud by ID
   */
  const loadDeckFromCloud = useCallback(async (deckId: string) => {
    try {
      setSyncStatus({ isSaving: false, lastSavedAt: null, error: null });
      
      const result = await persistenceRef.current.loadById(deckId);

      if (result.success && result.deck) {
        const loadedDeck = deckFromCloud(result.deck, result.isOwner ?? false, persistenceRef.current.resolveCard);

        // Set the saved-snapshot baseline so the dirty flag starts clean
        commitSavedSnapshot(snapshotDeck(loadedDeck));
        setDeck(loadedDeck);
        setHasUnsavedChanges(false);
        setIsInitializing(false);
        setSyncStatus({
          isSaving: false,
          lastSavedAt: loadedDeck.updatedAt,
          error: null,
        });
        return true;
      } else {
        setIsInitializing(false);
        setSyncStatus({
          isSaving: false,
          lastSavedAt: null,
          error: result.error || "Failed to load deck",
        });
        return false;
      }
    } catch (error) {
      console.error("Error loading deck from cloud:", error);
      setIsInitializing(false);
      setSyncStatus({
        isSaving: false,
        lastSavedAt: null,
        error: "Failed to load deck",
      });
      return false;
    }
  }, []);

  /**
   * Save current deck to cloud
   */
  const saveDeckToCloud = useCallback(async (overrideName?: string, overrideDeck?: Deck) => {
    const isExplicitCall = overrideName !== undefined || overrideDeck !== undefined;

    // Serialize: chain this save behind any in-flight one so two saves can't race
    const previous = savePromiseRef.current;
    const next = (async () => {
      if (previous) {
        try { await previous; } catch { /* prior caller already saw the error */ }
      }

      try {
        const targetDeck = overrideDeck ?? deckRef.current;

        // Skip if nothing has changed since the last successful save
        if (!isExplicitCall && snapshotDeck(targetDeck) === lastSavedSnapshotRef.current) {
          return { success: true, deckCheckResult: null, skipped: true } as const;
        }

        setSyncStatus({ isSaving: true, lastSavedAt: null, error: null });

        // Convert Deck format to database format
        // Filter out cards with quantity <= 0 to avoid database constraint violations
        const cardsData: DeckCardData[] = targetDeck.cards
          .filter((deckCard) => deckCard.quantity > 0)
          .map((deckCard) => ({
            card_name: deckCard.card.name,
            card_set: deckCard.card.set,
            card_img_file: deckCard.card.imgFile,
            quantity: deckCard.quantity,
            zone: deckCard.zone,
          }));

        // The chosen covers while their cards are still in the main deck; auto picks for the rest.
        const [previewCard1, previewCard2] = deckCovers(targetDeck);

        const result = await persistenceRef.current.save({
          deckId: targetDeck.id,
          name: overrideName || targetDeck.name,
          description: targetDeck.description,
          format: targetDeck.format,
          paragon: targetDeck.paragon,
          folderId: targetDeck.folderId,
          cards: cardsData,
          previewCard1,
          previewCard2,
        });

        if (result.success) {
          const savedId = result.deckId ?? targetDeck.id;
          // Snapshot the saved state (with its potentially-new id) so subsequent
          // saves dedup and the dirty flag goes clean.
          commitSavedSnapshot(snapshotDeck({ ...targetDeck, id: savedId }));

          // Update deck with the ID if it was newly created
          if (!targetDeck.id && result.deckId) {
            setDeck((prevDeck) => ({ ...prevDeck, id: result.deckId }));
          }

          setHasUnsavedChanges(false);
          setSyncStatus({
            isSaving: false,
            lastSavedAt: new Date(),
            error: null,
          });

          return { success: true, deckCheckResult: result.deckCheckResult ?? null } as const;
        } else {
          setSyncStatus({
            isSaving: false,
            lastSavedAt: null,
            error: result.error || "Failed to save deck",
          });

          return { success: false, error: result.error } as const;
        }
      } catch (error) {
        console.error("Error saving deck to cloud:", error);
        const errorMessage = "Failed to save deck";
        setSyncStatus({
          isSaving: false,
          lastSavedAt: null,
          error: errorMessage,
        });

        return { success: false, error: errorMessage } as const;
      }
    })();

    savePromiseRef.current = next;
    try {
      return await next;
    } finally {
      if (savePromiseRef.current === next) {
        savePromiseRef.current = null;
      }
    }
  }, []);


  /**
   * Add a card to the deck or increase its quantity
   */
  const addCard = useCallback((card: Card, zone: DeckZone = 'main') => {
    setDeck((prevDeck) => {
      const existingCardIndex = prevDeck.cards.findIndex(
        (dc) =>
          dc.card.name === card.name &&
          dc.card.set === card.set &&
          dc.zone === zone
      );

      let newCards: DeckCard[];

      if (existingCardIndex >= 0) {
        // Card exists, increment quantity (no limit)
        const existingCard = prevDeck.cards[existingCardIndex];

        newCards = [...prevDeck.cards];
        newCards[existingCardIndex] = {
          ...existingCard,
          quantity: existingCard.quantity + 1,
        };
      } else {
        // New card, add with quantity 1
        newCards = [
          ...prevDeck.cards,
          {
            card,
            quantity: 1,
            zone,
          },
        ];
      }

      return {
        ...prevDeck,
        cards: newCards,
        updatedAt: new Date(),
      };
    });
  }, []);

  /**
   * Remove a card from the deck or decrease its quantity
   */
  const removeCard = useCallback(
    (cardName: string, cardSet: string, zone: DeckZone = 'main') => {
      setDeck((prevDeck) => {
        const existingCardIndex = prevDeck.cards.findIndex(
          (dc) =>
            dc.card.name === cardName &&
            dc.card.set === cardSet &&
            dc.zone === zone
        );

        if (existingCardIndex < 0) {
          return prevDeck; // Card not found
        }

        const existingCard = prevDeck.cards[existingCardIndex];
        let newCards: DeckCard[];

        if (existingCard.quantity > 1) {
          // Decrease quantity
          newCards = [...prevDeck.cards];
          newCards[existingCardIndex] = {
            ...existingCard,
            quantity: existingCard.quantity - 1,
          };
        } else {
          // Remove card entirely
          newCards = prevDeck.cards.filter((_, i) => i !== existingCardIndex);
        }

        return {
          ...prevDeck,
          cards: newCards,
          updatedAt: new Date(),
        };
      });
    },
    []
  );

  /**
   * Apply a batch of zone moves in one state update (multi-select drag, the
   * selection bar, and their undo)
   */
  const moveCards = useCallback((moves: ZoneMove[]) => {
    if (moves.length === 0) return;
    setDeck((prevDeck) => ({
      ...prevDeck,
      cards: applyZoneMoves(prevDeck.cards, moves),
      updatedAt: new Date(),
    }));
  }, []);

  /**
   * Update card quantity directly
   */
  const updateQuantity = useCallback(
    (
      cardName: string,
      cardSet: string,
      quantity: number,
      zone: DeckZone = 'main'
    ) => {
      if (quantity < 0) {
        console.warn("Invalid quantity:", quantity);
        return;
      }

      setDeck((prevDeck) => {
        const existingCardIndex = prevDeck.cards.findIndex(
          (dc) =>
            dc.card.name === cardName &&
            dc.card.set === cardSet &&
            dc.zone === zone
        );

        if (existingCardIndex < 0) {
          return prevDeck; // Card not found
        }

        let newCards: DeckCard[];

        if (quantity === 0) {
          // Remove card
          newCards = prevDeck.cards.filter((_, i) => i !== existingCardIndex);
        } else {
          // Update quantity
          newCards = [...prevDeck.cards];
          newCards[existingCardIndex] = {
            ...newCards[existingCardIndex],
            quantity,
          };
        }

        return {
          ...prevDeck,
          cards: newCards,
          updatedAt: new Date(),
        };
      });
    },
    []
  );

  /**
   * Update deck name
   */
  const setDeckName = useCallback((name: string) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      name,
      updatedAt: new Date(),
    }));
  }, []);

  /**
   * Update deck description
   */
  const setDeckDescription = useCallback((description: string) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      description,
      updatedAt: new Date(),
    }));
  }, []);

  /**
   * Update deck format
   */
  const setDeckFormat = useCallback((format: string) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      format,
      updatedAt: new Date(),
    }));
  }, []);

  /**
   * Set deck's Paragon (for Paragon format)
   */
  const setDeckParagon = useCallback((paragon: string | undefined) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      paragon,
      updatedAt: new Date(),
    }));
  }, []);

  /**
   * Update deck public visibility (local state only — actual toggle calls server action separately)
   */
  const setDeckPublic = useCallback((isPublic: boolean) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      isPublic,
      visibility: isPublic ? "public" : "private",
    }));
  }, []);

  /**
   * Update three-state deck visibility (local state only — the server action
   * setDeckVisibilityAction is called separately by the caller).
   */
  const setDeckVisibility = useCallback((visibility: DeckVisibility) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      visibility,
      isPublic: visibility === "unlisted" || visibility === "public",
    }));
  }, []);

  /**
   * Set user-chosen preview/cover card img files
   */
  const setPreviewCards = useCallback((card1: string | null, card2: string | null) => {
    setDeck((prevDeck) => ({
      ...prevDeck,
      previewCard1: card1,
      previewCard2: card2,
      updatedAt: new Date(),
    }));
    setHasUnsavedChanges(true);
  }, []);

  /**
   * Clear all cards from deck and reset to new blank deck
   */
  const clearDeck = useCallback(() => {
    setDeck({
      id: undefined,
      name: "Untitled Deck",
      cards: [],
      description: "",
      format: undefined,
      folderId: undefined,
      isPublic: false,
      visibility: "private",
      previewCard1: null,
      previewCard2: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, []);

  /**
   * Reset deck to empty state with new name
   */
  const newDeck = useCallback((name: string = "Untitled Deck", folderId?: string | null) => {
    setDeck({
      name,
      cards: [],
      description: "",
      format: undefined,
      folderId: folderId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }, []);

  /**
   * Load a complete deck (for imports or loading from database)
   */
  const loadDeck = useCallback((newDeck: Deck) => {
    setDeck(newDeck);
  }, []);

  /**
   * Get quantity of a specific card in the deck
   */
  const getCardQuantity = useCallback(
    (cardName: string, cardSet: string, zone: DeckZone = 'main'): number => {
      const deckCard = deck.cards.find(
        (dc) =>
          dc.card.name === cardName &&
          dc.card.set === cardSet &&
          dc.zone === zone
      );
      return deckCard?.quantity || 0;
    },
    [deck.cards]
  );

  /**
   * Calculate deck statistics. Maybeboard cards don't roll into type/brigade
   * aggregates — those drive deck composition charts and the maybeboard is a
   * scratchpad, not part of the deck.
   */
  const getDeckStats = useCallback((): DeckStats => {
    const mainDeckCards = deck.cards.filter((dc) => dc.zone === 'main');
    const reserveCards = deck.cards.filter((dc) => dc.zone === 'reserve');
    const maybeboardCards = deck.cards.filter((dc) => dc.zone === 'maybeboard');

    const mainDeckCount = mainDeckCards.reduce((sum, dc) => sum + dc.quantity, 0);
    const reserveCount = reserveCards.reduce((sum, dc) => sum + dc.quantity, 0);
    const maybeboardCount = maybeboardCards.reduce((sum, dc) => sum + dc.quantity, 0);

    const cardsByType: Record<string, number> = {};
    const cardsByBrigade: Record<string, number> = {};

    deck.cards.forEach((dc) => {
      if (dc.zone === 'maybeboard') return;
      const type = dc.card.type || "Unknown";
      cardsByType[type] = (cardsByType[type] || 0) + dc.quantity;

      const brigade = dc.card.brigade || "None";
      cardsByBrigade[brigade] = (cardsByBrigade[brigade] || 0) + dc.quantity;
    });

    return {
      mainDeckCount,
      reserveCount,
      maybeboardCount,
      uniqueCards: mainDeckCards.length + reserveCards.length,
      cardsByType,
      cardsByBrigade,
    };
  }, [deck.cards]);

  /**
   * Replace the current deck's good (or evil) half with the matching half of another
   * saved deck (in memory only — the user saves manually). Returns counts for a toast,
   * or an error string. Makes no change when the source has no matching-alignment cards.
   */
  const replaceHalf = useCallback(
    async (
      alignment: ReplaceAlignment,
      sourceDeckId: string
    ): Promise<{
      success: boolean;
      removed?: number;
      added?: number;
      sourceName?: string;
      error?: string;
    }> => {
      try {
        const result = await persistenceRef.current.loadById(sourceDeckId);
        if (!result.success || !result.deck) {
          return { success: false, error: result.error || "Failed to load source deck" };
        }

        const sourceName = result.deck.name;
        const sourceCards = result.deck.cards.map((c: any) => dbCardToDeckCard(c, persistenceRef.current.resolveCard));
        const { cards, removed, added } = buildReplacedHalf(deck.cards, sourceCards, alignment);

        if (added === 0) {
          return {
            success: false,
            error: `"${sourceName}" has no ${alignment}-aligned cards.`,
          };
        }

        setDeck({ ...deck, cards, updatedAt: new Date() });
        return { success: true, removed, added, sourceName };
      } catch (error) {
        console.error("Error replacing deck half:", error);
        return { success: false, error: "Failed to replace deck half" };
      }
    },
    [deck]
  );

  /**
   * Clear the unsaved changes flag (useful when discarding changes)
   */
  const clearUnsavedChanges = useCallback(() => {
    setHasUnsavedChanges(false);
  }, []);

  return {
    deck,
    syncStatus,
    hasUnsavedChanges,
    isInitializing,
    deferredDeckId,
    addCard,
    removeCard,
    moveCards,
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
  };
}

type CloudDeck = NonNullable<Awaited<ReturnType<DeckBuilderPersistence["loadById"]>>["deck"]>;

/**
 * The deck the builder opens for a cloud row: the owner's deck itself, or — for
 * anyone else — a fresh private "Copy of …" with no id, so saving creates their
 * own deck. The copy also takes no folder: the folder is the original owner's,
 * and saveDeckAction refuses a folder the caller doesn't own.
 */
export function deckFromCloud(
  cloudDeck: CloudDeck,
  isOwner: boolean,
  resolveCard?: DeckBuilderPersistence["resolveCard"],
): Deck {
  return {
    id: isOwner ? cloudDeck.id : undefined,
    name: isOwner ? cloudDeck.name : `Copy of ${cloudDeck.name}`,
    description: isOwner ? (cloudDeck.description || "") : "",
    format: cloudDeck.format,
    paragon: cloudDeck.paragon,
    folderId: isOwner ? cloudDeck.folder_id : undefined,
    isPublic: cloudDeck.is_public ?? false,
    visibility: isOwner ? (cloudDeck.visibility ?? "private") : "private",
    previewCard1: cloudDeck.preview_card_1 ?? null,
    previewCard2: cloudDeck.preview_card_2 ?? null,
    cards: cloudDeck.cards.map((c: any) => dbCardToDeckCard(c, resolveCard)),
    createdAt: new Date(cloudDeck.created_at),
    updatedAt: new Date(cloudDeck.updated_at),
  };
}

/**
 * Reconstruct a full in-memory DeckCard from a database card row, using the card
 * catalog lookup so alignment and other fields are populated. An injected
 * `resolveCard` (from the persistence seam) runs first so non-catalog cards —
 * the Forge's — rehydrate with full data instead of the "Unknown" stub. Falls
 * back to a minimal card object if the card is not found anywhere.
 */
function dbCardToDeckCard(
  dbCard: any,
  resolveCard?: DeckBuilderPersistence["resolveCard"]
): DeckCard {
  const resolved = resolveCard?.(dbCard);
  if (resolved) {
    return {
      card: resolved,
      quantity: dbCard.quantity,
      zone: dbCard.zone as DeckZone,
    };
  }

  const key = `${dbCard.card_name}|${dbCard.card_set}|${sanitizeImgFile(dbCard.card_img_file)}`;
  const fullCard = CARD_BY_FULL_KEY.get(key);

  if (fullCard) {
    return {
      card: fullCard,
      quantity: dbCard.quantity,
      zone: dbCard.zone as DeckZone,
    };
  }

  console.warn(`Card not found in database: ${dbCard.card_name} (${dbCard.card_set})`);
  return {
    card: {
      dataLine: "",
      name: dbCard.card_name,
      set: dbCard.card_set,
      imgFile: sanitizeImgFile(dbCard.card_img_file),
      officialSet: "",
      type: "Unknown",
      brigade: "",
      strength: "",
      toughness: "",
      class: "",
      identifier: "",
      specialAbility: "",
      rarity: "",
      reference: "",
      alignment: "",
      legality: "",
      testament: "",
      isGospel: false,
    } as Card,
    quantity: dbCard.quantity,
    zone: dbCard.zone as DeckZone,
  };
}

/**
 * Get default empty deck
 */
function getDefaultDeck(): Deck {
  return {
    name: "Untitled Deck",
    cards: [],
    description: "",
    format: undefined,
    visibility: "private",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

