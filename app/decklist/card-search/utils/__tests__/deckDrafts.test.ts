import { describe, it, expect } from "vitest";
import {
  LEGACY_DECK_KEY,
  LEGACY_SNAPSHOT_KEY,
  MAX_LEFT_BEHIND,
  openDraftTab,
  readDraft,
  writeDraft,
  writeDraftSnapshot,
  type DraftTabEnv,
  type TabLocks,
} from "../deckDrafts";
import type { Deck } from "../../types/deck";
import type { Card } from "../../utils";

class MemoryStore {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, String(v));
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
  keys() {
    return [...this.items.keys()];
  }
}

const TAB_LOCK = (tabId: string) => `redemption-deck-builder-tab:${tabId}`;

/** Locks as the browser would report them; `openTabs` are other tabs still open. */
function fakeLocks(openTabs: string[] = []): TabLocks {
  const held = new Set(openTabs.map(TAB_LOCK));
  return {
    async hold(name) {
      if (held.has(name)) return null;
      held.add(name);
      return () => held.delete(name);
    },
    async heldNames() {
      return [...held];
    },
    async exclusive(_name, fn) {
      return fn();
    },
  };
}

function env(opts: { sessionTabId?: string; openTabs?: string[]; store?: MemoryStore } = {}) {
  const store = opts.store ?? new MemoryStore();
  const session = new MemoryStore();
  if (opts.sessionTabId) session.setItem("redemption-deck-builder-tab-id", opts.sessionTabId);
  let n = 0;
  const e: DraftTabEnv = {
    store,
    session,
    locks: fakeLocks(opts.openTabs),
    newId: () => `new-${++n}`,
  };
  return { env: e, store, session };
}

function deckNamed(name: string, cardCount = 1, extra: Partial<Deck> = {}): Deck {
  const card = { name: "Angel of the Lord", set: "Roots", imgFile: "aotl.jpg", type: "Hero" } as unknown as Card;
  return {
    name,
    description: "",
    cards: cardCount > 0 ? [{ card, quantity: cardCount, zone: "main" }] : [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...extra,
  };
}

const blankDeck = () => deckNamed("Untitled Deck", 0);

describe("openDraftTab", () => {
  it("gives a reloaded tab its own deck back", async () => {
    const { env: e, store } = env({ sessionTabId: "t1" });
    writeDraft(store, "t1", deckNamed("Deck A"), null);

    const tab = await openDraftTab(true, e);

    expect(tab.tabId).toBe("t1");
    expect(tab.draft?.deck.name).toBe("Deck A");
  });

  it("does not show a second tab the deck another open tab is building", async () => {
    const { env: e, store } = env({ openTabs: ["t1"] });
    writeDraft(store, "t1", deckNamed("Deck A"), null);

    const tab = await openDraftTab(true, e);

    expect(tab.tabId).not.toBe("t1");
    expect(tab.draft).toBeNull();
    expect(readDraft(store, "t1")?.deck.name).toBe("Deck A");
  });

  it("hands a closed tab's deck to the next tab opened on the plain builder URL", async () => {
    const { env: e, store } = env();
    writeDraft(store, "t1", deckNamed("Deck A"), "snap-a");

    const tab = await openDraftTab(true, e);

    expect(tab.draft?.deck.name).toBe("Deck A");
    expect(tab.draft?.savedSnapshot).toBe("snap-a");
    expect(readDraft(store, tab.tabId)?.deck.name).toBe("Deck A");
    expect(readDraft(store, "t1")).toBeNull();
  });

  it("picks the most recently edited deck when several tabs were closed", async () => {
    const { env: e, store } = env();
    writeDraft(store, "t1", deckNamed("Older"), null, 1000);
    writeDraft(store, "t2", deckNamed("Newer"), null, 2000);

    const tab = await openDraftTab(true, e);

    expect(tab.draft?.deck.name).toBe("Newer");
    expect(readDraft(store, "t1")?.deck.name).toBe("Older");
  });

  it("leaves closed tabs' decks alone when the tab opens a specific deck or a new one", async () => {
    const { env: e, store } = env();
    writeDraft(store, "t1", deckNamed("Deck A"), null);

    const tab = await openDraftTab(false, e);

    expect(tab.draft).toBeNull();
    expect(readDraft(store, "t1")?.deck.name).toBe("Deck A");
  });

  it("returns the tab's own deck when it opens a specific deck, for the unsaved-work check", async () => {
    const { env: e, store } = env({ sessionTabId: "t1" });
    writeDraft(store, "t1", deckNamed("Deck A"), null);

    const tab = await openDraftTab(false, e);

    expect(tab.draft?.deck.name).toBe("Deck A");
  });

  it("keeps a tab's own blank deck after New Deck instead of swapping in a closed tab's deck", async () => {
    const { env: e, store } = env({ sessionTabId: "t1" });
    writeDraft(store, "t1", blankDeck(), null, 2000);
    writeDraft(store, "t2", deckNamed("Deck B"), null, 1000);

    const tab = await openDraftTab(true, e);

    expect(tab.draft?.deck.cards).toHaveLength(0);
    expect(readDraft(store, "t2")?.deck.name).toBe("Deck B");
  });

  it("gives a duplicated tab a new id and a copy of the deck it was duplicated from", async () => {
    // A duplicated tab inherits sessionStorage, so it starts with the original's id.
    const { env: e, store } = env({ sessionTabId: "t1", openTabs: ["t1"] });
    writeDraft(store, "t1", deckNamed("Deck A"), null);

    const tab = await openDraftTab(true, e);

    expect(tab.tabId).not.toBe("t1");
    expect(tab.draft?.deck.name).toBe("Deck A");
    expect(readDraft(store, "t1")?.deck.name).toBe("Deck A");
  });

  it("does not hand the original's deck to a duplicated tab that opens a specific deck", async () => {
    const { env: e, store } = env({ sessionTabId: "t1", openTabs: ["t1"] });
    writeDraft(store, "t1", deckNamed("Deck A"), null);

    const tab = await openDraftTab(false, e);

    expect(tab.tabId).not.toBe("t1");
    expect(tab.draft).toBeNull();
  });

  it("records the new id so a reload of a fresh tab finds its deck", async () => {
    const { env: e, session } = env();

    const tab = await openDraftTab(true, e);

    expect(session.getItem("redemption-deck-builder-tab-id")).toBe(tab.tabId);
  });

  it("deletes blank decks left by closed tabs instead of handing them on", async () => {
    const { env: e, store } = env();
    writeDraft(store, "t1", blankDeck(), null, 2000);
    writeDraft(store, "t2", deckNamed("Deck B"), null, 1000);

    const tab = await openDraftTab(true, e);

    expect(tab.draft?.deck.name).toBe("Deck B");
    expect(readDraft(store, "t1")).toBeNull();
  });

  it(`keeps at most ${MAX_LEFT_BEHIND} closed tabs' decks, newest first`, async () => {
    const { env: e, store } = env();
    for (let i = 1; i <= MAX_LEFT_BEHIND + 3; i++) {
      writeDraft(store, `t${i}`, deckNamed(`Deck ${i}`), null, i * 1000);
    }

    await openDraftTab(false, e);

    const kept = store.keys().filter((k) => k.startsWith("redemption-deck-builder-draft:"));
    expect(kept).toHaveLength(MAX_LEFT_BEHIND);
    expect(readDraft(store, "t1")).toBeNull();
    expect(readDraft(store, `t${MAX_LEFT_BEHIND + 3}`)?.deck.name).toBe(`Deck ${MAX_LEFT_BEHIND + 3}`);
  });

  it("treats the old shared slot as a closed tab's deck", async () => {
    const store = new MemoryStore();
    const legacyCard = { card: { name: "Lost Soul", set: "Roots" }, quantity: 2, isReserve: true };
    store.setItem(
      LEGACY_DECK_KEY,
      JSON.stringify({ name: "Old Deck", cards: [legacyCard], createdAt: 0, updatedAt: 5000 })
    );
    store.setItem(LEGACY_SNAPSHOT_KEY, "snap-old");
    const { env: e } = env({ store });

    const tab = await openDraftTab(true, e);

    expect(tab.draft?.deck.name).toBe("Old Deck");
    expect(tab.draft?.deck.cards[0].zone).toBe("reserve");
    expect(tab.draft?.savedSnapshot).toBe("snap-old");
    expect(store.getItem(LEGACY_DECK_KEY)).toBeNull();
    expect(store.getItem(LEGACY_SNAPSHOT_KEY)).toBeNull();
  });
});

describe("writeDraft / readDraft", () => {
  it("round-trips the deck with its dates and saved snapshot", () => {
    const store = new MemoryStore();
    writeDraft(store, "t1", deckNamed("Deck A", 1, { updatedAt: new Date(1234) }), "snap");

    const draft = readDraft(store, "t1");

    expect(draft?.deck.updatedAt).toEqual(new Date(1234));
    expect(draft?.savedSnapshot).toBe("snap");
  });

  it("updates only the saved snapshot after a save that did not change the deck", () => {
    const store = new MemoryStore();
    writeDraft(store, "t1", deckNamed("Deck A"), null);

    writeDraftSnapshot(store, "t1", "after-save");

    expect(readDraft(store, "t1")?.savedSnapshot).toBe("after-save");
    expect(readDraft(store, "t1")?.deck.name).toBe("Deck A");
  });
});
