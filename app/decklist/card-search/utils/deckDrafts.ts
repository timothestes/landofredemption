/**
 * Where the deck builder keeps the deck in progress on this device.
 *
 * Each browser tab keeps its own deck under its own key, so a second tab never
 * shows, overwrites or asks about the deck being built in the first. While the
 * builder is open a tab holds a Web Lock named after its id, and the browser
 * drops that lock when the tab closes. A deck whose lock is free was left by a
 * closed tab: the next tab opened on the plain builder URL picks it up, which is
 * the "close the tab, come back later" case.
 *
 * The tab id lives in sessionStorage, so a reload finds the tab's own deck.
 */

import type { Deck, DeckZone } from "../types/deck";

const DRAFT_KEY_PREFIX = "redemption-deck-builder-draft:";
const TAB_ID_KEY = "redemption-deck-builder-tab-id";
const TAB_LOCK_PREFIX = "redemption-deck-builder-tab:";
// Serializes the hand-over, so two tabs opening at once can't both take one deck.
const HANDOVER_LOCK = "redemption-deck-builder-handover";

// Before per-tab keys every tab shared one slot. A deck found there is treated
// as one left by a closed tab.
export const LEGACY_DECK_KEY = "redemption-deck-builder-current-deck";
export const LEGACY_SNAPSHOT_KEY = "redemption-deck-builder-saved-snapshot";
const LEGACY_TAB_ID = "legacy";

/** How many closed tabs' decks are kept for a later tab to pick up. */
export const MAX_LEFT_BEHIND = 5;

// How long a reloading tab waits for its old lock, which the page it replaced
// may not have released yet. Past this the id belongs to another open tab (a
// duplicated tab inherits sessionStorage), and this tab takes a new one.
const RECLAIM_WAIT_MS = 250;

export interface DeckDraft {
  deck: Deck;
  /** The last cloud-synced snapshot of the deck (see isDisplacedDraft). */
  savedSnapshot: string | null;
  /** When the tab last wrote it; the newest closed tab's deck is picked up first. */
  updatedAt: number;
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export interface TabLocks {
  /** Hold `name` until the returned release runs; null if another tab keeps it for `waitMs`. */
  hold(name: string, waitMs: number): Promise<(() => void) | null>;
  /** Every lock name held on this site, by any tab. */
  heldNames(): Promise<string[]>;
  /** Run `fn` while holding `name`. */
  exclusive<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
}

export interface DraftTabEnv {
  store: KeyValueStore;
  session: Pick<Storage, "getItem" | "setItem">;
  locks: TabLocks;
  newId: () => string;
}

export interface DraftTab {
  tabId: string;
  store: KeyValueStore;
  /** This tab's deck, or (when restoring) the closed tab's deck it picked up. */
  draft: DeckDraft | null;
  /** Let go of the tab's lock, so its deck can be picked up by another tab. */
  release: () => void;
}

const draftKey = (tabId: string) => DRAFT_KEY_PREFIX + tabId;

/** Whether a deck holds anything worth restoring. */
export function deckHasContent(deck: Deck): boolean {
  return deck.cards.length > 0 || deck.name !== "Untitled Deck" || !!deck.id;
}

function parseDeck(parsed: any): Deck {
  // Migrate legacy isReserve:boolean to zone:DeckZone (pre-PR-1 localStorage drafts)
  const cards = Array.isArray(parsed.cards)
    ? parsed.cards.map((c: any) => {
        if (c?.zone) return c;
        const zone: DeckZone = c?.isReserve ? "reserve" : "main";
        const { isReserve: _drop, ...rest } = c ?? {};
        return { ...rest, zone };
      })
    : [];
  return {
    ...parsed,
    cards,
    createdAt: new Date(parsed.createdAt),
    updatedAt: new Date(parsed.updatedAt),
  };
}

export function readDraft(store: KeyValueStore, tabId: string): DeckDraft | null {
  try {
    const raw = store.getItem(draftKey(tabId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return {
      deck: parseDeck(parsed.deck),
      savedSnapshot: parsed.savedSnapshot ?? null,
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch (error) {
    console.error("Error loading deck from storage:", error);
    return null;
  }
}

export function writeDraft(
  store: KeyValueStore,
  tabId: string,
  deck: Deck,
  savedSnapshot: string | null,
  now: number = Date.now()
): void {
  try {
    store.setItem(draftKey(tabId), JSON.stringify({ deck, savedSnapshot, updatedAt: now }));
  } catch (error) {
    console.error("Error saving deck to storage:", error);
  }
}

/** Record a save that left the deck itself unchanged. */
export function writeDraftSnapshot(store: KeyValueStore, tabId: string, savedSnapshot: string): void {
  const draft = readDraft(store, tabId);
  if (draft) writeDraft(store, tabId, draft.deck, savedSnapshot, draft.updatedAt);
}

function draftTabIds(store: KeyValueStore): string[] {
  const ids: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(DRAFT_KEY_PREFIX)) ids.push(key.slice(DRAFT_KEY_PREFIX.length));
  }
  return ids;
}

function foldInLegacySlot(store: KeyValueStore): void {
  const raw = store.getItem(LEGACY_DECK_KEY);
  if (raw === null) return;
  try {
    const deck = parseDeck(JSON.parse(raw));
    writeDraft(store, LEGACY_TAB_ID, deck, store.getItem(LEGACY_SNAPSHOT_KEY), deck.updatedAt.getTime() || 0);
  } catch (error) {
    console.error("Error loading deck from storage:", error);
  }
  store.removeItem(LEGACY_DECK_KEY);
  store.removeItem(LEGACY_SNAPSHOT_KEY);
}

/**
 * Once this tab holds its lock: fold in the old shared slot, delete closed tabs'
 * blank decks and all but the newest MAX_LEFT_BEHIND, and — when `restore` is
 * set and this tab has no deck of its own — take over the newest one.
 */
function settleDrafts(
  store: KeyValueStore,
  tabId: string,
  openTabIds: ReadonlySet<string>,
  restore: boolean
): DeckDraft | null {
  foldInLegacySlot(store);
  let own = readDraft(store, tabId);

  const leftBehind: { tabId: string; draft: DeckDraft }[] = [];
  for (const id of draftTabIds(store)) {
    if (id === tabId || openTabIds.has(id)) continue;
    const draft = readDraft(store, id);
    if (draft && deckHasContent(draft.deck)) leftBehind.push({ tabId: id, draft });
    else store.removeItem(draftKey(id));
  }
  leftBehind.sort((a, b) => b.draft.updatedAt - a.draft.updatedAt);

  if (restore && !own && leftBehind.length > 0) {
    const newest = leftBehind.shift()!;
    store.setItem(draftKey(tabId), store.getItem(draftKey(newest.tabId))!);
    store.removeItem(draftKey(newest.tabId));
    own = newest.draft;
  }
  for (const { tabId: id } of leftBehind.slice(MAX_LEFT_BEHIND)) {
    store.removeItem(draftKey(id));
  }
  return own;
}

/**
 * Claim this tab's storage slot. `restore` is set when the tab opens the plain
 * builder URL (no deck id, not New Deck): only then does it pick up a closed
 * tab's deck.
 */
export async function openDraftTab(restore: boolean, env: DraftTabEnv = browserEnv()): Promise<DraftTab> {
  const { store, session, locks } = env;
  const previousId = session.getItem(TAB_ID_KEY);
  let tabId = previousId;
  let release = previousId ? await locks.hold(TAB_LOCK_PREFIX + previousId, RECLAIM_WAIT_MS) : null;

  if (!tabId || !release) {
    tabId = env.newId();
    session.setItem(TAB_ID_KEY, tabId);
    release = (await locks.hold(TAB_LOCK_PREFIX + tabId, RECLAIM_WAIT_MS)) ?? (() => {});
    // A duplicated tab on the plain builder URL shows what its original showed.
    // One opened on a specific deck starts clean, or it would ask about the
    // original's unsaved work.
    if (previousId && restore) {
      const raw = store.getItem(draftKey(previousId));
      if (raw !== null) store.setItem(draftKey(tabId), raw);
    }
  }

  const id = tabId;
  const draft = await locks.exclusive(HANDOVER_LOCK, async () => {
    const openTabIds = new Set(
      (await locks.heldNames())
        .filter((name) => name.startsWith(TAB_LOCK_PREFIX))
        .map((name) => name.slice(TAB_LOCK_PREFIX.length))
    );
    return settleDrafts(store, id, openTabIds, restore);
  });
  return { tabId: id, store, draft, release };
}

function webTabLocks(locks: LockManager): TabLocks {
  return {
    hold(name, waitMs) {
      return new Promise((resolve) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), waitMs);
        locks
          .request(name, { signal: controller.signal }, () => {
            clearTimeout(timer);
            // The lock is held until this promise settles.
            return new Promise<void>((release) => resolve(() => release()));
          })
          .catch(() => resolve(null));
      });
    },
    async heldNames() {
      const { held = [] } = await locks.query();
      return held.map((lock) => lock.name ?? "");
    },
    exclusive(name, fn) {
      return locks.request(name, fn);
    },
  };
}

// Without Web Locks no tab can tell another is open, so every other tab's deck
// counts as left behind — the hand-over then works as the shared slot did.
const noTabLocks: TabLocks = {
  hold: async () => () => {},
  heldNames: async () => [],
  exclusive: async (_name, fn) => fn(),
};

function browserEnv(): DraftTabEnv {
  return {
    store: window.localStorage,
    session: window.sessionStorage,
    locks: typeof navigator !== "undefined" && navigator.locks ? webTabLocks(navigator.locks) : noTabLocks,
    newId: () =>
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  };
}
