import { describe, it, expect, vi, beforeEach } from "vitest";

// Must match the specifier actions.ts imports, or the mock silently doesn't
// apply and this test hits the network.
vi.mock("../../../utils/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/utils/deckcheck", () => ({
  checkDeck: vi.fn(async () => ({ valid: true, issues: [] })),
}));

import { createClient } from "../../../utils/supabase/server";
import {
  loadPublicDecksAction,
  loadSharedFolderAction,
  loadPublicFoldersAction,
  moveDeckToFolderAction,
  saveDeckAction,
  duplicateDeckAction,
} from "../actions";

/**
 * A shared folder lists decks by folder_id. Nothing in the schema ties a
 * deck's folder_id to a folder its OWNER owns: folder ids are public (the
 * folder page, the Community strip, the sitemap) and the decks UPDATE policy
 * only checks the deck's user_id. So another user can file their own deck
 * into your shared folder, and it would render under your name with no way
 * for you to remove it. Every folder read must therefore also filter on the
 * folder owner's user_id, and the write paths must refuse a folder the caller
 * doesn't own.
 *
 * The fake below is a tiny in-memory PostgREST: eq/in filters, update/insert/
 * delete applied on resolve, count/head. Assertions are about which rows come
 * back, not which builder methods were called.
 */

type Row = Record<string, any>;

function makeQuery(rows: Row[]) {
  const filters: Array<(r: Row) => boolean> = [];
  let head = false;
  let wantCount = false;
  let pendingUpdate: Row | null = null;
  let pendingInsert: Row[] | null = null;
  let pendingDelete = false;
  const q: any = {};
  q.select = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
    if (opts?.head) head = true;
    if (opts?.count) wantCount = true;
    return q;
  };
  q.eq = (col: string, val: any) => { filters.push((r) => r[col] === val); return q; };
  q.in = (col: string, vals: any[]) => { filters.push((r) => vals.includes(r[col])); return q; };
  q.gte = (col: string, val: number) => { filters.push((r) => r[col] >= val); return q; };
  q.lte = (col: string, val: number) => { filters.push((r) => r[col] <= val); return q; };
  q.or = () => { throw new Error("or() is not modelled by this fake"); };
  q.not = () => { throw new Error("not() is not modelled by this fake"); };
  q.order = () => q;
  q.range = () => q;
  q.limit = () => q;
  q.update = (values: Row) => { pendingUpdate = values; return q; };
  q.insert = (values: Row | Row[]) => { pendingInsert = Array.isArray(values) ? values : [values]; return q; };
  q.delete = () => { pendingDelete = true; return q; };

  const resolve = () => {
    if (pendingInsert) {
      const inserted = pendingInsert.map((r, i) => ({ id: `new-${rows.length + i}`, ...r }));
      rows.push(...inserted);
      return { data: inserted, error: null, count: null };
    }
    const matched = rows.filter((r) => filters.every((f) => f(r)));
    if (pendingUpdate) for (const r of matched) Object.assign(r, pendingUpdate);
    if (pendingDelete) for (const r of matched) rows.splice(rows.indexOf(r), 1);
    return { data: head ? null : matched, error: null, count: wantCount ? matched.length : null };
  };
  q.single = async () => {
    const first = resolve().data?.[0];
    return first
      ? { data: first, error: null }
      : { data: null, error: { code: "PGRST116", message: "0 rows" } };
  };
  q.maybeSingle = async () => ({ data: resolve().data?.[0] ?? null, error: null });
  q.then = (onFulfilled: any, onRejected: any) => Promise.resolve(resolve()).then(onFulfilled, onRejected);
  return q;
}

function fakeClient(userId: string | null, tables: Record<string, Row[]>) {
  return {
    auth: {
      getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
    },
    from: (table: string) => makeQuery((tables[table] ??= [])),
    rpc: async () => ({ data: [], error: null }),
  } as any;
}

const VICTIM = "victim-user";
const ATTACKER = "attacker-user";
const FOLDER = "victim-folder";
const ATTACKER_FOLDER = "attacker-folder";

/** The victim's public folder holding one of their own unlisted decks and one deck an attacker filed into it. */
function seed() {
  return {
    deck_folders: [
      { id: FOLDER, name: "Contender Decks", visibility: "public", user_id: VICTIM, created_at: "2026-10-26T00:00:00Z" },
      { id: ATTACKER_FOLDER, name: "Mine", visibility: "private", user_id: ATTACKER, created_at: "2026-10-26T00:00:00Z" },
    ],
    decks: [
      { id: "d-own", user_id: VICTIM, folder_id: FOLDER, visibility: "unlisted", name: "Own deck", card_count: 50 },
      { id: "d-injected", user_id: ATTACKER, folder_id: FOLDER, visibility: "public", name: "Injected deck", card_count: 50 },
      { id: "d-loose", user_id: ATTACKER, folder_id: null, visibility: "private", name: "Attacker's deck", card_count: 50 },
    ],
    profiles: [
      { id: VICTIM, username: "victim" },
      { id: ATTACKER, username: "attacker" },
    ],
  } as Record<string, Row[]>;
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
});

describe("shared folder reads list only the folder owner's decks", () => {
  it("the folder page leaves out a deck another user filed into the folder", async () => {
    vi.mocked(createClient).mockResolvedValue(fakeClient(null, seed()));

    const result = await loadPublicDecksAction({ folderId: FOLDER });

    expect(result.success).toBe(true);
    expect(result.decks.map((d: any) => d.id)).toEqual(["d-own"]);
    expect(result.totalCount).toBe(1);
  });

  it("the folder header counts only the owner's visible decks", async () => {
    vi.mocked(createClient).mockResolvedValue(fakeClient(null, seed()));

    const result = await loadSharedFolderAction(FOLDER);

    expect(result.success).toBe(true);
    if (result.success) expect(result.folder.deck_count).toBe(1);
  });

  it("the Community strip counts only the owner's decks and drops a folder holding nothing but injected decks", async () => {
    const tables = seed();
    tables.deck_folders.push({ id: "victim-empty", name: "Empty", visibility: "public", user_id: VICTIM, created_at: "2026-10-25T00:00:00Z" });
    tables.decks.push({ id: "d-injected-2", user_id: ATTACKER, folder_id: "victim-empty", visibility: "public", name: "Injected 2", card_count: 50 });
    vi.mocked(createClient).mockResolvedValue(fakeClient(null, tables));

    const result = await loadPublicFoldersAction();

    expect(result.success).toBe(true);
    expect(result.folders.map((f) => [f.id, f.deck_count])).toEqual([[FOLDER, 1]]);
  });
});

describe("filing a deck into a folder requires owning the folder", () => {
  it("moveDeckToFolderAction refuses another user's folder and leaves the deck where it was", async () => {
    const tables = seed();
    vi.mocked(createClient).mockResolvedValue(fakeClient(ATTACKER, tables));

    const result = await moveDeckToFolderAction("d-loose", FOLDER);

    expect(result.success).toBe(false);
    expect(tables.decks.find((d) => d.id === "d-loose")!.folder_id).toBeNull();
  });

  it("moveDeckToFolderAction still files a deck into the caller's own folder", async () => {
    const tables = seed();
    vi.mocked(createClient).mockResolvedValue(fakeClient(ATTACKER, tables));

    const result = await moveDeckToFolderAction("d-loose", ATTACKER_FOLDER);

    expect(result.success).toBe(true);
    expect(tables.decks.find((d) => d.id === "d-loose")!.folder_id).toBe(ATTACKER_FOLDER);
  });

  it("moveDeckToFolderAction still takes a deck out of a folder (null) without a folder check", async () => {
    const tables = seed();
    vi.mocked(createClient).mockResolvedValue(fakeClient(ATTACKER, tables));

    const result = await moveDeckToFolderAction("d-injected", null);

    expect(result.success).toBe(true);
    expect(tables.decks.find((d) => d.id === "d-injected")!.folder_id).toBeNull();
  });

  it("saveDeckAction refuses to create a deck inside another user's folder", async () => {
    const tables = seed();
    const before = tables.decks.length;
    vi.mocked(createClient).mockResolvedValue(fakeClient(ATTACKER, tables));

    const result = await saveDeckAction({ name: "Sneaky", cards: [], folderId: FOLDER });

    expect(result.success).toBe(false);
    expect(tables.decks.length).toBe(before);
  });

  it("saveDeckAction refuses to move an existing deck into another user's folder", async () => {
    const tables = seed();
    vi.mocked(createClient).mockResolvedValue(fakeClient(ATTACKER, tables));

    const result = await saveDeckAction({ deckId: "d-loose", name: "Attacker's deck", cards: [], folderId: FOLDER });

    expect(result.success).toBe(false);
    expect(tables.decks.find((d) => d.id === "d-loose")!.folder_id).toBeNull();
  });

  it("saveDeckAction still saves into the caller's own folder", async () => {
    const tables = seed();
    vi.mocked(createClient).mockResolvedValue(fakeClient(ATTACKER, tables));

    const result = await saveDeckAction({ deckId: "d-loose", name: "Attacker's deck", cards: [], folderId: ATTACKER_FOLDER });

    expect(result.success).toBe(true);
    expect(tables.decks.find((d) => d.id === "d-loose")!.folder_id).toBe(ATTACKER_FOLDER);
  });
});

describe("duplicating a deck", () => {
  it("does not file the copy of another user's public deck into their folder", async () => {
    const tables = seed();
    tables.decks.push({ id: "d-victim-public", user_id: VICTIM, folder_id: FOLDER, visibility: "public", is_public: true, name: "Victim public", card_count: 50 });
    vi.mocked(createClient).mockResolvedValue(fakeClient(ATTACKER, tables));

    const result = await duplicateDeckAction("d-victim-public");

    expect(result.success).toBe(true);
    const copy = tables.decks.find((d) => d.name === "Victim public (Copy)")!;
    expect(copy.user_id).toBe(ATTACKER);
    expect(copy.folder_id).toBeNull();
  });

  it("keeps the folder when duplicating your own deck", async () => {
    const tables = seed();
    tables.decks.find((d) => d.id === "d-loose")!.folder_id = ATTACKER_FOLDER;
    vi.mocked(createClient).mockResolvedValue(fakeClient(ATTACKER, tables));

    const result = await duplicateDeckAction("d-loose");

    expect(result.success).toBe(true);
    expect(tables.decks.find((d) => d.name === "Attacker's deck (Copy)")!.folder_id).toBe(ATTACKER_FOLDER);
  });
});
