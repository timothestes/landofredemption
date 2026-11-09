import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn(), requireElder: vi.fn() }));

import { revalidatePath } from "next/cache";
import { requireElder, requireForge } from "@/app/forge/lib/auth";
import { denyProposal, acceptProposal, getOpenProposalDiffs } from "../proposals";
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

describe("acceptProposal", () => {
  it("marks a stale accept as closed, so the dialog won't offer a retry", async () => {
    (requireElder as any).mockResolvedValue(ctx());
    const r = await acceptProposal("p1");
    expect(r.ok).toBe(false);
    expect(r.closed).toBe(true);
  });

  it("does not mark an RPC failure as closed", async () => {
    (requireElder as any).mockResolvedValue(ctx({ message: "nope" }));
    expect(await acceptProposal("p1")).toEqual({ ok: false, error: "Could not accept proposal" });
  });
});

describe("getOpenProposalDiffs", () => {
  function reads(rows: Record<string, any[]>) {
    return {
      supabase: {
        from: (table: string) => {
          const chain: any = { select: () => chain, eq: () => chain, in: () => chain, order: () => chain };
          chain.then = (done: any) => done({ data: rows[table] ?? [] });
          return chain;
        },
      },
    };
  }

  // The reviewer's first question. listProposals had this; the open list did not.
  it("names who proposed each open proposal", async () => {
    (requireForge as any).mockResolvedValue(reads({
      card_proposals: [{ id: "p1", card_id: "c1", base_version_id: "v3", status: "open", created_by: "u2", created_at: "2026-09-01T00:00:00Z" }],
      card_versions: [{ id: "v3", data: { name: "Invented" } }],
      playtest_members: [{ user_id: "u2", display_name: "Rhoda" }],
    }));
    const [d] = await getOpenProposalDiffs("c1");
    expect(d.proposal.proposerName).toBe("Rhoda");
    expect(d.current).toEqual({ name: "Invented" });
  });
});
