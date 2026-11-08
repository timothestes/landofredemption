import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));
vi.mock("@/app/forge/lib/art", () => ({
  validateArtFile: vi.fn(),
  uploadForgeArt: vi.fn(),
  uploadForgeFinished: vi.fn(),
  readForgeUpload: vi.fn(),
  deleteForgeArt: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { requireElder } from "@/app/forge/lib/auth";
import { deleteForgeArt } from "@/app/forge/lib/art";
import { removeFinished } from "../cards";

function ctx(result: { error: { code?: string; message: string } | null } = { error: null }) {
  return { role: "elder", user: { id: "u1" }, supabase: { rpc: vi.fn(async () => ({ data: null, ...result })) } };
}

beforeEach(() => vi.clearAllMocks());

describe("removeFinished", () => {
  it("refuses a non-elder without calling the RPC", async () => {
    (requireElder as any).mockResolvedValue(null);
    expect(await removeFinished("c1")).toEqual({ ok: false, error: "Not authorized" });
  });

  it("clears the card's pointer by passing a null key", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    expect(await removeFinished("c1")).toEqual({ ok: true });
    expect(c.supabase.rpc).toHaveBeenCalledTimes(1);
    expect(c.supabase.rpc).toHaveBeenCalledWith("forge_set_working_finished", { p_card_id: "c1", p_key: null });
    expect(revalidatePath).toHaveBeenCalledWith("/forge/cards/c1");
    expect(revalidatePath).toHaveBeenCalledWith("/forge/ideas");
  });

  it("leaves the file alone, because a released version may still point at it", async () => {
    (requireElder as any).mockResolvedValue(ctx());
    await removeFinished("c1");
    expect(deleteForgeArt).not.toHaveBeenCalled();
  });

  it("shows the RPC's refusal", async () => {
    (requireElder as any).mockResolvedValue(ctx({ error: { code: "P0001", message: "a promoted card is read-only" } }));
    expect(await removeFinished("c1")).toEqual({ ok: false, error: "A promoted card is read-only." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps anything else general", async () => {
    (requireElder as any).mockResolvedValue(ctx({ error: { message: "fetch failed" } }));
    expect(await removeFinished("c1")).toEqual({ ok: false, error: "Could not remove the finished image" });
  });
});
