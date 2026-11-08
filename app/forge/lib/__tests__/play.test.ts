import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));

import { requireForge } from "@/app/forge/lib/auth";
import { listSetApprovedCards } from "../play";

function table(rows: any[]) {
  const b: any = {};
  for (const m of ["select", "eq", "in"]) b[m] = vi.fn(() => b);
  b.then = (res: any) => Promise.resolve({ data: rows, error: null }).then(res);
  return b;
}

describe("listSetApprovedCards", () => {
  const cards = table([{ id: "c1", approved_version_id: null, published_version_id: "v3" }]);
  const versions = table([{
    id: "v3", card_id: "c1", version_number: 3, data: { name: "Invented Tyrant" },
    art_key: null, art_original_key: null, art_is_placeholder: false, finished_key: null,
  }]);

  beforeEach(() => {
    (requireForge as any).mockResolvedValue({
      supabase: { from: vi.fn((name: string) => (name === "forge_cards" ? cards : versions)) },
    });
  });

  it("returns the released version's number with the card", async () => {
    expect(await listSetApprovedCards("s1")).toEqual([{
      cardId: "c1", data: { name: "Invented Tyrant" }, hasApprovedArt: false,
      hasApprovedFinished: false, versionId: "v3", versionNumber: 3,
    }]);
  });

  it("never asks for the working draft", async () => {
    await listSetApprovedCards("s1");
    const asked = [...cards.select.mock.calls, ...versions.select.mock.calls].flat().join(",");
    expect(asked).not.toMatch(/working|updated_at/);
  });

  it("only reads released version rows", async () => {
    await listSetApprovedCards("s1");
    expect(versions.in).toHaveBeenCalledWith("status", ["published", "approved"]);
  });
});
