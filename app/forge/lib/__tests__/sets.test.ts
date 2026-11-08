import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));

import { requireForge, requireElder } from "@/app/forge/lib/auth";
import { revalidatePath } from "next/cache";
import { cappedQuery } from "./fixtures/cappedQuery";
import { createSet, saveSetNotes, listSets, listWritableSets, grantSet, revokeSet, bulkDeleteSets, renameSet } from "../sets";

function ctx(opts: { rpc?: any; rows?: any[] } = {}) {
  const order = vi.fn(async () => ({ data: opts.rows ?? [], error: null }));
  const eq = vi.fn(() => ({ order, eq, maybeSingle: vi.fn(async () => ({ data: (opts.rows ?? [])[0] ?? null, error: null })) }));
  const select = vi.fn(() => ({ eq, order }));
  return {
    role: "elder",
    user: { id: "u1", email: "e@x" },
    supabase: {
      rpc: vi.fn(opts.rpc ?? (async () => ({ data: "set-1", error: null }))),
      from: vi.fn(() => ({ select })),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("createSet", () => {
  it("rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await createSet("Genesis")).ok).toBe(false);
  });
  it("calls forge_create_set and returns the new id", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    const r = await createSet("Genesis");
    expect(r).toEqual({ ok: true, id: "set-1" });
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_create_set", { p_name: "Genesis", p_is_private: true }]);
  });
  it("makes the set open only when told to", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    await createSet("Genesis", false);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_create_set", { p_name: "Genesis", p_is_private: false }]);
  });
});

describe("saveSetNotes", () => {
  it("calls forge_save_set_notes and returns updatedAt", async () => {
    const c = ctx({ rpc: async () => ({ data: "2026-06-24T00:00:00Z", error: null }) });
    (requireElder as any).mockResolvedValue(c);
    const r = await saveSetNotes("set-1", "# themes");
    expect(r.ok).toBe(true);
    expect((c.supabase.rpc as any).mock.calls[0]).toEqual(["forge_save_set_notes", { p_set_id: "set-1", p_notes: "# themes" }]);
  });
});

describe("renameSet", () => {
  it("rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await renameSet("s1", "New Name")).ok).toBe(false);
  });

  it("calls forge_rename_set and revalidates broadly", async () => {
    const c = ctx({ rpc: async () => ({ data: null, error: null }) });
    (requireElder as any).mockResolvedValue(c);
    const r = await renameSet("s1", "New Name");
    expect(r).toEqual({ ok: true });
    expect(c.supabase.rpc).toHaveBeenCalledWith("forge_rename_set", { p_set_id: "s1", p_name: "New Name" });
    expect(revalidatePath).toHaveBeenCalledWith("/forge", "layout");
  });

  it("surfaces an RPC error", async () => {
    const c = ctx({ rpc: async () => ({ data: null, error: { message: "boom" } }) });
    (requireElder as any).mockResolvedValue(c);
    expect((await renameSet("s1", "New Name")).ok).toBe(false);
  });
});

describe("listSets", () => {
  it("returns [] when not a member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await listSets()).toEqual([]);
  });

  const member = (cards: ReturnType<typeof cappedQuery>) => ({
    role: "superadmin",
    user: { id: "u1" },
    supabase: {
      from: (table: string) =>
        table === "forge_cards"
          ? cards.start()
          : {
              select: () => ({
                order: async () => ({
                  data: [
                    { id: "a", name: "Set A", slug: "a", status: "open", target_counts: { total: 2000 }, is_private: false },
                    { id: "b", name: "Set B", slug: "b", status: "open", target_counts: null, is_private: true },
                  ],
                  error: null,
                }),
              }),
            },
    },
  });
  const rows = (n: number, set_id: string | null, status: string) => Array.from({ length: n }, () => ({ set_id, status }));

  it("counts every card, not only the first 1000", async () => {
    const cards = cappedQuery([...rows(1500, "a", "draft"), ...rows(700, "b", "draft"), ...rows(5, "b", "archived"), ...rows(3, null, "private_idea")]);
    (requireForge as any).mockResolvedValue(member(cards));
    const out = await listSets();
    expect(out.map((s) => [s.id, s.total])).toEqual([["a", 1500], ["b", 700]]);
    expect(out[0].statusCounts).toEqual({ draft: 1500 });
    expect(out[1].statusCounts).toEqual({ draft: 700, archived: 5 });
  });

  it("pages over a stable order and stops at the first short page", async () => {
    const cards = cappedQuery(rows(1132, "a", "draft"));
    (requireForge as any).mockResolvedValue(member(cards));
    await listSets();
    expect(cards.requests.map((r) => r.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(cards.requests.map((r) => r.orders.map(([column]) => column))).toEqual([["id"], ["id"]]);
  });

  it("gets past a total that is an exact multiple of the page size", async () => {
    const cards = cappedQuery(rows(1000, "a", "draft"));
    (requireForge as any).mockResolvedValue(member(cards));
    expect((await listSets())[0].total).toBe(1000);
    expect(cards.requests).toHaveLength(2);
  });

  it.each([["first", 0], ["later", 1]])("throws instead of counting what arrived when the %s page fails", async (_, failRequest) => {
    (requireForge as any).mockResolvedValue(member(cappedQuery(rows(1500, "a", "draft"), { failRequest })));
    await expect(listSets()).rejects.toThrow(/card counts/);
  });
});

describe("grantSet / revokeSet", () => {
  it("grantSet rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await grantSet("s1", "u1")).ok).toBe(false);
  });

  it("grantSet calls forge_grant_set and returns ok", async () => {
    const c = ctx({ rpc: async () => ({ data: null, error: null }) });
    (requireElder as any).mockResolvedValue(c);
    expect((await grantSet("s1", "u1")).ok).toBe(true);
    expect(c.supabase.rpc).toHaveBeenCalledWith("forge_grant_set", { p_set_id: "s1", p_user_id: "u1" });
  });

  it("revokeSet surfaces an RPC error", async () => {
    const c = ctx({ rpc: async () => ({ data: null, error: { message: "boom" } }) });
    (requireElder as any).mockResolvedValue(c);
    expect((await revokeSet("s1", "u1")).ok).toBe(false);
  });
});

describe("bulkDeleteSets", () => {
  it("rejects a non-elder", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect((await bulkDeleteSets(["s1"])).ok).toBe(false);
  });
  it("loops forge_delete_set per id and counts failures without stopping", async () => {
    let calls = 0;
    const rpc = vi.fn(async () => ({ data: null, error: ++calls === 2 ? { message: "boom" } : null }));
    (requireElder as any).mockResolvedValue({ role: "elder", user: { id: "u1" }, supabase: { rpc } });
    const r = await bulkDeleteSets(["s1", "s2", "s3"]);
    expect(r).toEqual({ ok: true, done: 2, failed: 1 });
    expect((rpc as any).mock.calls.map((c: any) => c[1].p_set_id)).toEqual(["s1", "s2", "s3"]);
    expect((rpc as any).mock.calls[0][0]).toBe("forge_delete_set");
  });
  it("rejects more than 100 ids", async () => {
    (requireElder as any).mockResolvedValue({ role: "elder", user: { id: "u1" }, supabase: { rpc: vi.fn() } });
    expect((await bulkDeleteSets(Array.from({ length: 101 }, (_, i) => `s${i}`))).ok).toBe(false);
  });
});

describe("listWritableSets", () => {
  const client = (rows: any[], roster: any[]) => ({
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === "forge_set_elders") return { eq: vi.fn(async () => ({ data: roster, error: null })) };
        if (table === "forge_sets") return { order: vi.fn(async () => ({ data: rows, error: null })) };
        return { order: vi.fn(() => ({ range: vi.fn(async () => ({ data: [], error: null })) })) };
      }),
    })),
  });
  const rows = [
    { id: "open", name: "Open", slug: "open", status: "open", is_private: false },
    { id: "mine", name: "Mine", slug: "mine", status: "open", is_private: true },
    { id: "granted", name: "Granted", slug: "granted", status: "open", is_private: true },
    { id: "released", name: "Released", slug: "released", status: "released", is_private: false },
  ];

  it("returns nothing to a non-member", async () => {
    (requireForge as any).mockResolvedValue(null);
    expect(await listWritableSets()).toEqual([]);
  });
  it("offers an elder the open sets and their own private ones", async () => {
    (requireForge as any).mockResolvedValue({ role: "elder", user: { id: "u1" }, supabase: client(rows, [{ set_id: "mine" }]) });
    expect((await listWritableSets()).map((s) => s.id)).toEqual(["open", "mine"]);
  });
  it("offers a superadmin every set still taking cards", async () => {
    (requireForge as any).mockResolvedValue({ role: "superadmin", user: { id: "u1" }, supabase: client(rows, []) });
    expect((await listWritableSets()).map((s) => s.id)).toEqual(["open", "mine", "granted"]);
  });
});
