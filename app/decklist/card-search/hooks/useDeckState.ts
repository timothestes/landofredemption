import { useState, useEffect, useCallback, useRef } from "react";
import { Card, sanitizeImgFile } from "../utils";
import { Deck, DeckCard, DeckStats, DeckZone, DeckVisibility } from "../types/deck";
import { saveDeckAction, loadDeckByIdAction, DeckCardData } from "../../actions";
import { CARD_BY_FULL_KEY } from "../data/cardIndex";
import { buildReplacedHalf, type ReplaceAlignment } from "../utils/replaceHalf";
import type { DeckBuilderPersistence } from "../builderConfig";

const STORAGE_KEY = "redemption-deck-builder-current-deck";
// The last cloud-synced snapshot, kept beside the draft so a later mount that
// restores the draft can tell whether it is dirty (see isDisplacedDraft).
const SAVED_SNAPSHOT_KEY = "redemption-deck-builder-saved-snapshot";

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

  // Record the cloud-synced state in memory and on this device.
  const commitSavedSnapshot = (snapshot: string) => {
    lastSavedSnapshotRef.current = snapshot;
    if (localStoragePersistRef.current) saveSavedSnapshotToStorage(snapshot);
  };

  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  // Track the initial params to avoid re-running on hydration changes
  const initialParamsRef = useRef<{ deckId?: string; isNew?: boolean; initialized: boolean }>({ initialized: false });

  // Load from localStorage on client mount (after hydration)
  // Use a small delay to ensure searchParams has hydrated
  useEffect(() => {
    // Skip if already processed or if still on first render before hydration settles
    if (hasLoadedFromStorage.current) return;
    
    // Wait a tick for searchParams to hydrate properly
    const timer = setTimeout(() => {
      if (hasLoadedFromStorage.current) return;
      
      // Mark the initial params we're working with
      if (!initialParamsRef.current.initialized) {
        initialParamsRef.current = { deckId: initialDeckId, isNew: isNewDeck, initialized: true };
      }
      
      // Only load from storage if no deckId and not creating new deck
      if (!initialDeckId && !isNewDeck) {
        if (localStoragePersistRef.current) {
          const storedDeck = loadDeckFromStorage();
          // Only update if there's actually a deck in storage (not just the default)
          if (storedDeck.cards.length > 0 || storedDeck.name !== "Untitled Deck" || storedDeck.id) {
            // Restore the sync baseline too, so a clean cloud deck reopened from
            // the bare URL is not flagged as unsaved.
            lastSavedSnapshotRef.current = loadSavedSnapshotFromStorage();
            setDeck(storedDeck);
          }
        }
        // This path owns initialization; the cloud-load and new-deck effects own
        // theirs. Flipping isInitializing here when a deckId is present would
        // prematurely hide the "Loading deck..." indicator while the cloud fetch
        // is still in flight, leaving a blank "Untitled Deck" panel on screen.
        setIsInitializing(false);
      }
      hasLoadedFromStorage.current = true;
    }, 0);
    
    return () => clearTimeout(timer);
  }, [initialDeckId, isNewDeck]);

  // Persist deck to localStorage whenever it changes — but not before the
  // deferred initial read below has run, or the SSR default overwrites the draft.
  useEffect(() => {
    if (
      canPersistDeckToStorage({
        hasLoadedFromStorage: hasLoadedFromStorage.current,
        localStoragePersist: localStoragePersistRef.current,
      })
    ) {
      saveDeckToStorage(deck);
    }

    // Derive the dirty flag from the saved-snapshot ref so it reflects reality
    // after both edits and successful saves (rather than always flipping to true).
    if (!isInitialMount.current) {
      setHasUnsavedChanges(snapshotDeck(deck) !== lastSavedSnapshotRef.current);
    }
  }, [deck]);

  // Load deck from cloud on mount if deckId provided, or create new deck with folderId if provided
  useEffect(() => {
    if (initialDeckId && isInitialMount.current) {
      // Loading the cloud deck also persists it over whatever draft is in
      // localStorage. If that draft is unsaved work (an anonymous deck, or
      // edits never synced), show it instead and let the host confirm.
      const draft = localStoragePersistRef.current ? loadDeckFromStorage() : null;
      const savedSnapshot = draft ? loadSavedSnapshotFromStorage() : null;
      if (draft && isDisplacedDraft(draft, savedSnapshot, initialDeckId)) {
        lastSavedSnapshotRef.current = savedSnapshot;
        setDeck(draft);
        setIsInitializing(false);
        setDeferredDeckId(initialDeckId);
      } else {
        // Load existing deck from cloud
        loadDeckFromCloud(initialDeckId);
      }
    } else if (isNewDeck && isInitialMount.current) {
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
    }
    isInitialMount.current = false;
  }, [initialDeckId, initialFolderId, isNewDeck]);

  /**
   * Load deck from cloud by ID
   */
  const loadDeckFromCloud = useCallback(async (deckId: string) => {
    try {
      setSyncStatus({ isSaving: false, lastSavedAt: null, error: null });
      
      const result = await persistenceRef.current.loadById(deckId);

      if (result.success && result.deck) {
        const cloudDeck = result.deck;
        const isOwner = result.isOwner ?? false;

        // Convert database format to Deck format with full card data
        // If not the owner, clear the ID so saving creates a new copy instead of trying to update
        const loadedDeck: Deck = {
          id: isOwner ? cloudDeck.id : undefined,
          name: isOwner ? cloudDeck.name : `Copy of ${cloudDeck.name}`,
          description: isOwner ? (cloudDeck.description || "") : "",
          format: cloudDeck.format,
          paragon: cloudDeck.paragon,
          folderId: cloudDeck.folder_id,
          isPublic: cloudDeck.is_public ?? false,
          // Non-owners get a fresh copy, so their copy starts private.
          visibility: isOwner ? (cloudDeck.visibility ?? "private") : "private",
          previewCard1: cloudDeck.preview_card_1 ?? null,
          previewCard2: cloudDeck.preview_card_2 ?? null,
          cards: cloudDeck.cards.map((c: any) => dbCardToDeckCard(c, persistenceRef.current.resolveCard)),
          createdAt: new Date(cloudDeck.created_at),
          updatedAt: new Date(cloudDeck.updated_at),
        };

        // Set the saved-snapshot baseline so the dirty flag starts clean
        commitSavedSnapshot(snapshotDeck(loadedDeck));
        setDeck(loadedDeck);
        setHasUnsavedChanges(false);
        setIsInitializing(false);
        setSyncStatus({
          isSaving: false,
          lastSavedAt: new Date(cloudDeck.updated_at),
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

        // Use user-selected preview cards if set, otherwise auto-compute.
        // Maybeboard cards are explicitly excluded so a "considering" card never becomes a cover.
        let previewCard1 = targetDeck.previewCard1 ?? null;
        let previewCard2 = targetDeck.previewCard2 ?? null;
        if (!previewCard1 || !previewCard2) {
          const mainCards = targetDeck.cards.filter(dc => dc.zone === 'main' && dc.quantity > 0);
          const heroTypes = ['Hero', 'HC', 'Hero Character'];
          const evilTypes = ['Evil Character', 'EC'];
          const firstHero = mainCards.find(dc => heroTypes.includes(dc.card.type));
          const firstEvil = mainCards.find(dc => evilTypes.includes(dc.card.type));
          previewCard1 = previewCard1 ?? firstHero?.card.imgFile ?? mainCards[0]?.card.imgFile ?? null;
          previewCard2 = previewCard2 ?? firstEvil?.card.imgFile ?? (mainCards.length > 1 ? mainCards[1]?.card.imgFile : null) ?? null;
        }

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
 * Load deck from localStorage
 */
function loadDeckFromStorage(): Deck {
  // Check if we're in the browser (not SSR)
  if (typeof window === 'undefined') {
    return getDefaultDeck();
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Migrate legacy isReserve:boolean to zone:DeckZone (pre-PR-1 localStorage drafts)
      const migratedCards = Array.isArray(parsed.cards)
        ? parsed.cards.map((c: any) => {
            if (c?.zone) return c;
            const zone: DeckZone = c?.isReserve ? 'reserve' : 'main';
            const { isReserve: _drop, ...rest } = c ?? {};
            return { ...rest, zone };
          })
        : [];
      return {
        ...parsed,
        cards: migratedCards,
        createdAt: new Date(parsed.createdAt),
        updatedAt: new Date(parsed.updatedAt),
      };
    }
  } catch (error) {
    console.error("Error loading deck from storage:", error);
  }

  return getDefaultDeck();
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

function loadSavedSnapshotFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(SAVED_SNAPSHOT_KEY);
  } catch {
    return null;
  }
}

function saveSavedSnapshotToStorage(snapshot: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SAVED_SNAPSHOT_KEY, snapshot);
  } catch (error) {
    console.error("Error saving deck snapshot to storage:", error);
  }
}

/**
 * Save deck to localStorage
 */
function saveDeckToStorage(deck: Deck): void {
  // Check if we're in the browser (not SSR)
  if (typeof window === 'undefined') {
    return;
  }
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
  } catch (error) {
    console.error("Error saving deck to storage:", error);
  }
}
