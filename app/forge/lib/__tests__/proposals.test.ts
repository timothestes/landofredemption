import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));

import { revalidatePath } from "next/cache";
import { requireElder } from "@/app/forge/lib/auth";
import { acceptProposal, denyProposal } from "../proposals";
import { ACCEPT_NEEDS_NAME_AND_TYPE } from "../proposeCopy";

function ctx(error: any = null) {
  return { role: "elder", user: { id: "u1" }, supabase: { rpc: vi.fn(async () => ({ data: null, error })) } };
}
beforeEach(() => vi.clearAllMocks());

describe("acceptProposal", () => {
  it("says why when the proposal would release a card with no name or type", async () => {
    (requireElder as any).mockResolvedValue(ctx({ message: "a card needs a name and a type before it can be released" }));
    expect(await acceptProposal("p1")).toEqual({ ok: false, error: ACCEPT_NEEDS_NAME_AND_TYPE });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps any other refusal general", async () => {
    (requireElder as any).mockResolvedValue(ctx({ message: "proposal is not open" }));
    expect(await acceptProposal("p1")).toEqual({ ok: false, error: "Could not accept proposal" });
  });

  it("calls the RPC by its deployed name", async () => {
    const c = ctx();
    c.supabase.rpc.mockResolvedValue({ data: "v1", error: null } as any);
    (requireElder as any).mockResolvedValue(c);
    expect(await acceptProposal("p1")).toEqual({ ok: true });
    expect(c.supabase.rpc.mock.calls[0]).toEqual(["forge_accept_proposal", { p_proposal_id: "p1" }]);
  });
});

describe("denyProposal", () => {
  it("keeps the deployed RPC and its named arguments when leaving the draft alone", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    expect(await denyProposal("p1", "c1", "no")).toEqual({ ok: true });
    expect(c.supabase.rpc.mock.calls[0]).toEqual(["forge_deny_proposal", { p_proposal_id: "p1", p_reason: "no" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/forge/cards/c1");
  });

  it("calls the restoring RPC when asked, and refreshes set views for the new title", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    expect(await denyProposal("p1", "c1", "no", true)).toEqual({ ok: true });
    expect(c.supabase.rpc.mock.calls[0]).toEqual(["forge_deny_proposal_restore_draft", { p_proposal_id: "p1", p_reason: "no" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/forge", "layout");
  });

  it("requires a reason before calling anything", async () => {
    const c = ctx();
    (requireElder as any).mockResolvedValue(c);
    expect((await denyProposal("p1", "c1", "   ", true)).ok).toBe(false);
    expect(c.supabase.rpc).not.toHaveBeenCalled();
  });

  it("surfaces an RPC error", async () => {
    (requireElder as any).mockResolvedValue(ctx({ message: "nope" }));
    expect((await denyProposal("p1", "c1", "no", true)).ok).toBe(false);
  });
});
