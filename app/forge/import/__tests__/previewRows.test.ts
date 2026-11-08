import { describe, it, expect, vi, afterEach } from "vitest";
import { previewOverwrite, previewRows } from "../useImportRunner";
import type { RowPreview } from "../overwrite";

type Payload = { setId: string; overwrite?: boolean; preview?: boolean; cards: { name: string }[] };

const cards = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `Card ${i}`, snapshot: { name: `Card ${i}` }, derived: [], entryName: null }));

function stubRoute(answer: (name: string) => RowPreview, opts: { failOn?: string; slowFirst?: boolean } = {}) {
  const calls: Payload[] = [];
  let first = true;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const payload = JSON.parse((init.body as FormData).get("payload") as string) as Payload;
    calls.push(payload);
    if (opts.slowFirst && first) { first = false; await new Promise((r) => setTimeout(r, 20)); }
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (opts.failOn && payload.cards.some((c) => c.name === opts.failOn)) {
      return new Response(JSON.stringify({ error: "No access" }), { status: 400 });
    }
    return new Response(JSON.stringify({
      results: payload.cards.map((c) => ({ name: c.name, ok: true, preview: answer(c.name) })),
    }));
  }));
  return calls;
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("previewRows (U-58)", () => {
  it("answers per row, in row order, even when batches finish out of order", async () => {
    stubRoute((name) => (name === "Card 0" || name === "Card 17" ? "changed" : "new"), { slowFirst: true });
    const rows = await previewRows("set-1", cards(20));
    expect(rows).toHaveLength(20);
    expect(rows[0]).toBe("changed");
    expect(rows[17]).toBe("changed");
    expect(rows.filter((r) => r === "new")).toHaveLength(18);
  });

  it("always asks in preview mode, which writes nothing, and sends no images", async () => {
    const calls = stubRoute(() => "new");
    await previewRows("set-1", cards(20));
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) {
      expect(c.preview).toBe(true);
      expect(c.setId).toBe("set-1");
      expect(c.cards.length).toBeLessThanOrEqual(12); // the route's per-batch cap
      for (const card of c.cards) expect(card).not.toHaveProperty("fileField");
    }
  });

  it("throws when a batch can't be read, rather than reporting a partial answer", async () => {
    stubRoute(() => "new", { failOn: "Card 9" });
    await expect(previewRows("set-1", cards(20))).rejects.toThrow("No access");
  });

  it("gives up past its deadline and aborts every request still in flight", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    // A route that never answers, as a dropped connection looks from the page.
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      signals.push(init.signal!);
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })));
    const pending = previewRows("set-1", cards(150), undefined, 20_000);
    const outcome = expect(pending).rejects.toThrow("Checking the set took too long.");
    await vi.advanceTimersByTimeAsync(19_999);
    expect(signals.every((s) => !s.aborted)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(signals).toHaveLength(4); // one per worker, none started a second batch
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it("stops asking once aborted", async () => {
    const calls = stubRoute(() => "new");
    const ctl = new AbortController();
    ctl.abort();
    await expect(previewRows("set-1", cards(150), ctl.signal)).rejects.toThrow();
    expect(calls.length).toBeLessThanOrEqual(4); // at most the first of each concurrent worker
  });
});

describe("previewOverwrite still summarizes the same answer (U-02)", () => {
  it("counts rows the way the confirm dialog expects", async () => {
    stubRoute((name) => (name === "Card 0" ? "changed" : name === "Card 1" ? "unchanged" : "new"));
    const list = cards(3).map((c, i) => ({ ...c, entryName: i === 1 ? "img.png" : null }));
    expect(await previewOverwrite("set-1", list)).toEqual({ changed: 2, unchanged: 0, created: 1, images: 1 });
  });
});
