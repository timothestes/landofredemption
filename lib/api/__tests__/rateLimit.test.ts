import { describe, it, expect, vi, beforeEach } from "vitest";

// The limiters are only built when one is first used, so these stand-ins record what each was built with
// and which identifier it was asked about.
const limitCalls: Array<{ prefix: string; tokens: number; window: string; id: string }> = [];
vi.mock("@upstash/redis", () => ({ Redis: class {} }));
vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow(tokens: number, window: string) {
      return { tokens, window };
    }
    constructor(private cfg: { prefix: string; limiter: { tokens: number; window: string } }) {}
    async limit(id: string) {
      limitCalls.push({ prefix: this.cfg.prefix, ...this.cfg.limiter, id });
      return { success: true, remaining: this.cfg.limiter.tokens - 1, reset: 60_000 };
    }
  },
}));

import { extractClientIp, rateLimitForJoinIp, rateLimitForUnauthIp } from "../rateLimit";

describe("extractClientIp", () => {
  function reqWith(headers: Record<string, string>) {
    return { headers: new Headers(headers) } as Request;
  }

  it("uses x-vercel-forwarded-for when present", () => {
    expect(extractClientIp(reqWith({ "x-vercel-forwarded-for": "1.2.3.4" })))
      .toBe("1.2.3.4");
  });

  it("returns the first IP if the header is a comma list", () => {
    expect(extractClientIp(reqWith({ "x-vercel-forwarded-for": "1.2.3.4, 10.0.0.1" })))
      .toBe("1.2.3.4");
  });

  it("falls back to x-forwarded-for (first value)", () => {
    expect(extractClientIp(reqWith({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })))
      .toBe("5.6.7.8");
  });

  it("returns 'unknown' when no forwarded header is present", () => {
    expect(extractClientIp(reqWith({}))).toBe("unknown");
  });
});

describe("rateLimitForJoinIp", () => {
  beforeEach(() => {
    limitCalls.length = 0;
    process.env.KV_REST_API_URL = "https://kv.test";
    process.env.KV_REST_API_TOKEN = "test-token";
  });

  it("is an allowance of its own: nothing the shared per-connection limiter counts is spent", async () => {
    await rateLimitForUnauthIp("1.2.3.4");
    await rateLimitForJoinIp("lookup", "1.2.3.4");
    const [shared, join] = limitCalls;
    expect(join.prefix).not.toBe(shared.prefix);
  });

  it("lets a full room through in a minute: more than one event's 250 guest spots", async () => {
    const r = await rateLimitForJoinIp("lookup", "1.2.3.4");
    expect(limitCalls[0].window).toBe("1 m");
    expect(limitCalls[0].tokens).toBeGreaterThanOrEqual(250);
    expect(r.limit).toBe(limitCalls[0].tokens);
  });

  it("counts page loads and guest joins apart, each per connection", async () => {
    await rateLimitForJoinIp("lookup", "1.2.3.4");
    await rateLimitForJoinIp("guest-join", "1.2.3.4");
    await rateLimitForJoinIp("lookup", "5.6.7.8");
    expect(new Set(limitCalls.map((c) => c.id)).size).toBe(3);
  });
});
