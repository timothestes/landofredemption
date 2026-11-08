import { describe, it, expect, vi } from "vitest";
import { withDeadline } from "../withDeadline";

describe("withDeadline", () => {
  it("passes through an answer that arrives in time", async () => {
    expect(await withDeadline(Promise.resolve("real"), "fallback", 50)).toBe("real");
  });
  it("gives the fallback for an action that rejects", async () => {
    expect(await withDeadline(Promise.reject(new Error("offline")), "fallback", 50)).toBe("fallback");
  });
  it("gives the fallback for an action that never settles", async () => {
    vi.useFakeTimers();
    const r = withDeadline(new Promise<string>(() => {}), "fallback", 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await r).toBe("fallback");
    vi.useRealTimers();
  });
});
