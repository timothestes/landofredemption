import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/forge/lib/auth", () => ({ requireForge: vi.fn() }));

import { requireForge } from "@/app/forge/lib/auth";
import { authorizeForgeSeat } from "../playDecks";

const ctx = { supabase: {}, user: { id: "u1" }, role: "playtester" as const };

// Typed as the call authorizeForgeSeat makes so `mock.calls[0]` destructures below;
// an untyped vi.fn(async () => ...) has zero parameters and its calls tuple is `[]`.
type FetchCall = (
  url: string,
  init: { headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean }>;

function mockFetchOk() {
  const fetchMock = vi.fn<FetchCall>(async () => ({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("authorizeForgeSeat", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SPACETIMEDB_SERVER_TOKEN = "test-token";
    process.env.NEXT_PUBLIC_SPACETIMEDB_HOST = "wss://stdb.test";
    process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME = "redemption-multiplayer";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("rejects when requireForge returns null, without calling fetch", async () => {
    (requireForge as any).mockResolvedValue(null);
    const fetchMock = mockFetchOk();
    const r = await authorizeForgeSeat({ code: "ABCD", identityHex: "abcdef0123456789" });
    expect(r).toEqual({ ok: false, error: "Not authorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a bad code without calling fetch", async () => {
    (requireForge as any).mockResolvedValue(ctx);
    const fetchMock = mockFetchOk();
    const r = await authorizeForgeSeat({ code: "AB!D", identityHex: "abcdef0123456789" });
    expect(r).toEqual({ ok: false, error: "Invalid request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a bad identityHex without calling fetch", async () => {
    (requireForge as any).mockResolvedValue(ctx);
    const fetchMock = mockFetchOk();
    const r = await authorizeForgeSeat({ code: "ABCD", identityHex: "not-hex" });
    expect(r).toEqual({ ok: false, error: "Invalid request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("happy path: calls fetch once with Bearer token and positional [code, identityHex] body, lowercasing the hex", async () => {
    (requireForge as any).mockResolvedValue(ctx);
    const fetchMock = mockFetchOk();
    const r = await authorizeForgeSeat({ code: "abcd", identityHex: "ABCDEF0123456789" });
    expect(r).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1/database/");
    expect(url).toContain("/call/forge_authorize_seat");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(init.body).toBe(JSON.stringify(["ABCD", "abcdef0123456789"]));
  });
});
