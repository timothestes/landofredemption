import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@/app/forge/lib/art", () => ({ readForgeArt: vi.fn(), readForgeFont: vi.fn(), uploadForgeRendered: vi.fn() }));
vi.mock("@/app/forge/lib/renderCard", () => {
  class RenderInputError extends Error {}
  return { renderCardImage: vi.fn(), RenderInputError };
});

import { renderAndStore, _resetRenderedCardState } from "../renderedCard";
import { renderCardImage, RenderInputError } from "@/app/forge/lib/renderCard";
import { uploadForgeRendered } from "@/app/forge/lib/art";

const job = { cacheKey: "forge-rendered/r1/v1.jpg", cardId: "c1", versionId: "v1", data: { name: "X" }, artKey: null, year: 2026 };
const io = { readPrivateFont: vi.fn(), readArt: vi.fn() };
const ok = { jpeg: Buffer.from([1, 2, 3]), degraded: false };

describe("renderAndStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetRenderedCardState();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it("renders once for concurrent requests and stores the result", async () => {
    let release!: (v: typeof ok) => void;
    (renderCardImage as Mock).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const a = renderAndStore(job, io);
    const b = renderAndStore(job, io);
    release(ok);
    expect(await a).toBe(ok);
    expect(await b).toBe(ok);
    expect(renderCardImage).toHaveBeenCalledTimes(1);
    expect(renderCardImage).toHaveBeenCalledWith({ data: job.data, artKey: null, year: 2026 }, io);
    expect(uploadForgeRendered).toHaveBeenCalledWith(job.cacheKey, ok.jpeg);
  });

  it("serves a degraded render but never stores it", async () => {
    const degraded = { jpeg: Buffer.from([9]), degraded: true };
    (renderCardImage as Mock).mockResolvedValue(degraded);
    expect(await renderAndStore(job, io)).toBe(degraded);
    expect(uploadForgeRendered).not.toHaveBeenCalled();
  });

  it("still serves the render when storing it fails", async () => {
    (renderCardImage as Mock).mockResolvedValue(ok);
    (uploadForgeRendered as Mock).mockRejectedValue(new Error("blob down"));
    expect(await renderAndStore(job, io)).toBe(ok);
  });

  it("does not remember a transient input failure", async () => {
    (renderCardImage as Mock).mockRejectedValueOnce(new RenderInputError("art blob missing")).mockResolvedValueOnce(ok);
    expect(await renderAndStore(job, io)).toBeNull();
    expect(await renderAndStore(job, io)).toBe(ok);
  });

  it("remembers a deterministic failure for five minutes", async () => {
    vi.useFakeTimers();
    (renderCardImage as Mock).mockRejectedValue(new Error("SVG data parsing failed"));
    expect(await renderAndStore(job, io)).toBeNull();
    expect(await renderAndStore(job, io)).toBeNull();
    expect(renderCardImage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    (renderCardImage as Mock).mockResolvedValue(ok);
    expect(await renderAndStore(job, io)).toBe(ok);
  });
});
