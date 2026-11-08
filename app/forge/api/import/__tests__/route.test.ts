import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/forge/lib/auth", () => ({
  requireElder: vi.fn(),
  notFoundResponse: () => new Response("Not Found", { status: 404 }),
}));
vi.mock("@/app/forge/lib/art", () => ({
  uploadForgeFinished: vi.fn(async () => "forge-finished/key"),
  validateArtFile: vi.fn(() => null),
}));

import { POST } from "@/app/forge/api/import/route";
import { requireElder } from "@/app/forge/lib/auth";
import { uploadForgeFinished } from "@/app/forge/lib/art";

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const EXISTING = {
  id: "card-1",
  title: "Existing",
  status: "draft",
  working_snapshot: {
    name: "Existing", rawText: "Old text", alignment: "Good_Evil", cardType: ["Hero"],
    strength: 8, scripture: "A typed verse",
  },
};

function rig(rows = [EXISTING]) {
  const rpc = vi.fn(async (fn: string) => ({
    data: fn === "forge_create_card" ? "new-card" : "2026-11-08T00:00:00Z",
    error: null as null | { message: string },
  }));
  const q: any = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    filter: vi.fn(async () => ({ data: rows, error: null })),
  };
  asMock(requireElder).mockResolvedValue({ supabase: { rpc, from: () => q } });
  return { rpc, q };
}

function post(body: Record<string, unknown>, files: Record<string, File> = {}) {
  const fd = new FormData();
  fd.set("payload", JSON.stringify({ setId: "set-1", ...body }));
  for (const [k, f] of Object.entries(files)) fd.set(k, f);
  return POST(new Request("http://localhost/forge/api/import", { method: "POST", body: fd }));
}

const results = async (res: Response) => (await res.json()).results;
const image = () => new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });

beforeEach(() => vi.clearAllMocks());

describe("POST /forge/api/import overwrite (U-02)", () => {
  it("changes only the fields the row carries", async () => {
    const { rpc } = rig();
    const res = await post({
      overwrite: true,
      cards: [{ name: "Existing", snapshot: { name: "Existing", rawText: "New", specialAbility: "New" }, derived: [] }],
    });
    expect((await results(res))[0]).toMatchObject({ ok: true, cardId: "card-1", updated: true });
    expect(rpc.mock.calls).toEqual([[
      "forge_save_card_fields",
      { p_card_id: "card-1", p_set: { rawText: "New", specialAbility: "New" }, p_remove: [] },
    ]]);
  });

  it("never calls the whole-snapshot save on an existing card", async () => {
    const { rpc } = rig();
    await post({ overwrite: true, cards: [{ name: "Existing", snapshot: { name: "Existing", strength: 9 } }] });
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("forge_save_card");
  });

  it("doesn't write an alignment the parser derived", async () => {
    const { rpc } = rig();
    const res = await post({
      overwrite: true,
      cards: [{ name: "Existing", snapshot: { name: "Existing", cardType: ["Hero"], alignment: "Good" }, derived: ["alignment"] }],
    });
    expect((await results(res))[0]).toMatchObject({ unchanged: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("writes nothing and reports unchanged when a row changes nothing", async () => {
    const { rpc } = rig();
    const res = await post({
      overwrite: true,
      cards: [{ name: "Existing", snapshot: { name: "Existing", rawText: "Old text", specialAbility: "Old text", strength: 8 } }],
    });
    const [row] = await results(res);
    expect(row).toMatchObject({ ok: true, cardId: "card-1", unchanged: true });
    expect(row.updated).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("counts an image as a change even when the fields match, without touching the fields", async () => {
    const { rpc } = rig();
    const res = await post(
      { overwrite: true, cards: [{ name: "Existing", snapshot: { name: "Existing" }, fileField: "file-0" }] },
      { "file-0": image() },
    );
    expect((await results(res))[0]).toMatchObject({ updated: true });
    expect(uploadForgeFinished).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["forge_set_working_finished"]);
  });

  it("refuses an image for a promoted card, even when the fields match", async () => {
    const { rpc } = rig([{ ...EXISTING, status: "promoted" }]);
    const res = await post(
      { overwrite: true, cards: [{ name: "Existing", snapshot: { name: "Existing" }, fileField: "file-0" }] },
      { "file-0": image() },
    );
    expect((await results(res))[0]).toEqual({ name: "Existing", ok: false, error: "a promoted card is read-only" });
    expect(uploadForgeFinished).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a refused merge as a failed row", async () => {
    const { rpc } = rig();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "a promoted card is read-only" } } as any);
    const res = await post({ overwrite: true, cards: [{ name: "Existing", snapshot: { name: "Existing", strength: 9 } }] });
    expect((await results(res))[0]).toEqual({ name: "Existing", ok: false, error: "a promoted card is read-only" });
  });

  it("still skips an existing card when overwrite is off", async () => {
    const { rpc } = rig();
    const res = await post({ cards: [{ name: "Existing", snapshot: { name: "Existing", strength: 9 } }] });
    expect((await results(res))[0]).toMatchObject({ skipped: true, cardId: "card-1" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still creates a new card from its whole snapshot, derived fields included", async () => {
    const { rpc } = rig([]);
    const snapshot = { name: "Fresh", cardType: ["Hero"], alignment: "Good" };
    await post({ overwrite: true, cards: [{ name: "Fresh", snapshot, derived: ["alignment"] }] });
    expect(rpc).toHaveBeenCalledWith("forge_save_card", { p_card_id: "new-card", p_snapshot: snapshot });
  });
});

describe("POST /forge/api/import finding existing cards", () => {
  // postgrest-js's .in() doesn't escape a double quote, which silently drops every value after
  // it, so those rows would look new and an overwrite would create a second card.
  it("escapes a quoted Lost Soul name in the lookup", async () => {
    const { q } = rig([]);
    await post({
      overwrite: true, preview: true,
      cards: [{ name: 'Lost Soul "Invented" [Gen 1:1]', snapshot: {} }, { name: "Plain Card", snapshot: {} }],
    });
    expect(q.filter).toHaveBeenCalledWith("title", "in", '("Lost Soul \\"Invented\\" [Gen 1:1]","Plain Card")');
  });
});

describe("POST /forge/api/import preview", () => {
  const cards = [
    { name: "Existing", snapshot: { name: "Existing", strength: 9 } },
    { name: "Existing", snapshot: { name: "Existing", strength: 8 } },
    { name: "Fresh", snapshot: { name: "Fresh" } },
  ];

  it("says what each row would do", async () => {
    rig();
    const rows = await results(await post({ overwrite: true, preview: true, cards }));
    expect(rows.map((r: any) => r.preview)).toEqual(["changed", "unchanged", "new"]);
  });

  it("writes nothing at all", async () => {
    const { rpc } = rig();
    await post({ overwrite: true, preview: true, cards });
    expect(rpc).not.toHaveBeenCalled();
    expect(uploadForgeFinished).not.toHaveBeenCalled();
  });

  it("still refuses a row the import would refuse", async () => {
    rig();
    const rows = await results(await post({ overwrite: true, preview: true, cards: [{ name: "x".repeat(201), snapshot: {} }] }));
    expect(rows[0]).toMatchObject({ ok: false, error: "Invalid card name" });
    expect(rows[0].preview).toBeUndefined();
  });

  it("is a 404 for a non-elder, like the rest of the route", async () => {
    asMock(requireElder).mockResolvedValue(null);
    const res = await post({ overwrite: true, preview: true, cards });
    expect(res.status).toBe(404);
  });
});
