import { describe, it, expect } from "vitest";
import { deckFromCloud } from "../useDeckState";

/**
 * Opening someone else's public deck in the builder by URL gives the viewer a
 * fresh private "Copy of …" to save as their own. That copy must not inherit the
 * original owner's folder: a deck's folder_id is never owner-checked, so the
 * copy would have been filed into a stranger's folder — and since saveDeckAction
 * now refuses a folder the caller doesn't own, it would also fail to save.
 */
const cloudRow = {
  id: "d1",
  name: "Angels",
  description: "Flying things",
  format: "Type 1",
  paragon: null,
  folder_id: "owner-folder",
  is_public: true,
  visibility: "public" as const,
  preview_card_1: null,
  preview_card_2: null,
  cards: [],
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
};

describe("deckFromCloud", () => {
  it("gives a non-owner a private copy with no folder", () => {
    const deck = deckFromCloud(cloudRow, false);

    expect(deck.id).toBeUndefined();
    expect(deck.name).toBe("Copy of Angels");
    expect(deck.visibility).toBe("private");
    expect(deck.folderId).toBeUndefined();
  });

  it("gives the owner their deck as-is, folder included", () => {
    const deck = deckFromCloud(cloudRow, true);

    expect(deck.id).toBe("d1");
    expect(deck.name).toBe("Angels");
    expect(deck.visibility).toBe("public");
    expect(deck.folderId).toBe("owner-folder");
  });
});
