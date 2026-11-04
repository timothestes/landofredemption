import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "../middleware";

const SUPABASE_URL = "https://testref.supabase.co";

/** An auth cookie in @supabase/ssr's default base64url encoding, already expired. */
function expiredSessionCookie() {
  const session = {
    access_token: "expired-access-token",
    refresh_token: "refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) - 3600,
    user: { id: "user-1", aud: "authenticated", email: "a@example.com" },
  };
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  return `sb-testref-auth-token=${value}`;
}

function request(path: string, cookie?: string) {
  return new NextRequest(`https://landofredemption.com${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("updateSession", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    fetchSpy = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not reach Supabase on a public path, even with an expired session", async () => {
    const response = await updateSession(request("/decklist/community", expiredSessionCookie()));
    // The refresh fired by the client's INITIAL_SESSION load runs after the
    // response returns; give it time to start.
    await new Promise((r) => setTimeout(r, 50));

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still redirects a signed-out visitor away from a protected path", async () => {
    const response = await updateSession(request("/tracker/tournaments"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://landofredemption.com/sign-in?redirectTo=%2Ftracker%2Ftournaments",
    );
  });
});
