import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));

import { revalidatePath } from "next/cache";
import { requireElder } from "@/app/forge/lib/auth";
import { applySuggestion } from "../comments";

function ctx(error: any = null) {
  return { role: "elder", user: { id: "u1" }, supabase: { rpc: vi.fn(async () => ({ data: null, error })) } };
}
beforeEach(() => vi.clearAllMocks());

describe("applySuggestion", () => {
  it("says so when the card is promoted", async () => {
    (requireElder as any).mockResolvedValue(ctx({ message: "a promoted card is read-only" }));
    expect(await applySuggestion("cm1", "c1")).toEqual({ ok: false, error: "A promoted card is read-only." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps any other refusal general", async () => {
    (requireElder as any).mockResolvedValue(ctx({ message: "not authorized to edit this card" }));
    expect(await applySuggestion("cm1", "c1")).toEqual({ ok: false, error: "Could not apply suggestion" });
  });

  it("applies through the deployed RPC and refreshes the card", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    expect(await applySuggestion("cm1", "c1")).toEqual({ ok: true });
    expect(c.supabase.rpc.mock.calls[0]).toEqual(["forge_apply_suggestion", { p_comment_id: "cm1" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/forge/cards/c1");
  });
});
