import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));
vi.mock("@/app/forge/lib/play", () => ({ listSetApprovedCards: vi.fn() }));

import { requireForge } from "@/app/forge/lib/auth";
import { listSetApprovedCards } from "@/app/forge/lib/play";
import { listGrantedForgeCards } from "../deckPool";
import { cappedQuery } from "./fixtures/cappedQuery";

// forge_sets gives `sets`. Every other table fails, as a failed card count would.
function member(sets: { data: unknown; error: unknown }) {
  const tables: string[] = [];
  const order = vi.fn(async () => sets);
  const select = vi.fn(() => ({ order }));
  const ctx = {
    role: "playtester",
    user: { id: "u1" },
    supabase: {
      from: (table: string) => {
        tables.push(table);
        return table === "forge_sets" ? { select } : cappedQuery([], { failRequest: 0 }).start();
      },
    },
  };
  return { ctx, tables, select, order };
}

const SETS = [{ id: "s2", name: "Newer Set" }, { id: "s1", name: "Older Set" }];

beforeEach(() => vi.clearAllMocks());

describe("listGrantedForgeCards", () => {
  it("returns nothing to a non-member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await listGrantedForgeCards()).toEqual([]);
  });

  it("reads only set ids and names, newest first, and never forge_cards", async () => {
    const m = member({ data: SETS, error: null });
    (requireForge as any).mockResolvedValue(m.ctx);
    (listSetApprovedCards as any).mockResolvedValue([]);
    await listGrantedForgeCards();
    expect(m.tables).toEqual(["forge_sets"]);
    expect(m.select).toHaveBeenCalledWith("id, name");
    expect(m.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });

  it("gathers each set's cards with the set's name, in set order", async () => {
    (requireForge as any).mockResolvedValue(member({ data: SETS, error: null }).ctx);
    (listSetApprovedCards as any).mockImplementation(async (setId: string) => [
      { cardId: `card-in-${setId}`, data: { name: "Invented" }, hasApprovedArt: true, hasApprovedFinished: false, versionId: `v-${setId}`, versionNumber: 1 },
    ]);
    expect(await listGrantedForgeCards()).toEqual([
      { cardId: "card-in-s2", setId: "s2", setName: "Newer Set", data: { name: "Invented" }, hasApprovedArt: true, hasApprovedFinished: false, versionId: "v-s2" },
      { cardId: "card-in-s1", setId: "s1", setName: "Older Set", data: { name: "Invented" }, hasApprovedArt: true, hasApprovedFinished: false, versionId: "v-s1" },
    ]);
  });

  it("returns nothing when the set read fails, the same result as before", async () => {
    (requireForge as any).mockResolvedValue(member({ data: null, error: { message: "boom" } }).ctx);
    expect(await listGrantedForgeCards()).toEqual([]);
    expect(listSetApprovedCards).not.toHaveBeenCalled();
  });
});
