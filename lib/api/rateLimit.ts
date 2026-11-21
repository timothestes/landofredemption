import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // unix epoch seconds
};

let _redis: Redis | null = null;
function redis(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error("KV_REST_API_URL/TOKEN not set");
    _redis = new Redis({ url, token });
  }
  return _redis;
}

let _perKeyMinute: Ratelimit | null = null;
function perKeyMinute(): Ratelimit {
  if (!_perKeyMinute) {
    _perKeyMinute = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(60, "1 m"),
      analytics: false,
      prefix: "rtt:api:key-min",
    });
  }
  return _perKeyMinute;
}

let _perKeyDay: Ratelimit | null = null;
function perKeyDay(): Ratelimit {
  if (!_perKeyDay) {
    _perKeyDay = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(10_000, "1 d"),
      analytics: false,
      prefix: "rtt:api:key-day",
    });
  }
  return _perKeyDay;
}

let _perIpUnauthMinute: Ratelimit | null = null;
function perIpUnauthMinute(): Ratelimit {
  if (!_perIpUnauthMinute) {
    _perIpUnauthMinute = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(30, "1 m"),
      analytics: false,
      prefix: "rtt:api:ip-unauth",
    });
  }
  return _perIpUnauthMinute;
}

// Players at an event share the venue's connection, and a room scans the host's QR at once. One event takes up
// to 250 guests (migration 130), so the allowance is above that. Join codes are 6 random characters out of 32
// (about a billion): this many tries a minute, kept up all day, would still need months to hit one of a few
// dozen live codes.
const JOIN_PER_IP_MINUTE = 300;

let _perIpJoinMinute: Ratelimit | null = null;
function perIpJoinMinute(): Ratelimit {
  if (!_perIpJoinMinute) {
    _perIpJoinMinute = new Ratelimit({
      redis: redis(),
      limiter: Ratelimit.slidingWindow(JOIN_PER_IP_MINUTE, "1 m"),
      analytics: false,
      prefix: "rtt:join:ip",
    });
  }
  return _perIpJoinMinute;
}

/** Vercel-verified client IP; comma-separated lists return the first entry. */
export function extractClientIp(req: Request): string {
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

/** Check both per-minute and per-day caps for an API key. Stricter wins. */
export async function rateLimitForKey(keyPrefix: string): Promise<RateLimitResult> {
  const id = `key:${keyPrefix}`;
  const [m, d] = await Promise.all([perKeyMinute().limit(id), perKeyDay().limit(id)]);
  const stricter = m.remaining <= d.remaining ? m : d;
  return {
    success: m.success && d.success,
    limit: stricter === m ? 60 : 10_000,
    remaining: stricter.remaining,
    reset: Math.ceil(stricter.reset / 1000),
  };
}

/** Pre-401 IP throttle, to slow key-guessing. */
export async function rateLimitForUnauthIp(ip: string): Promise<RateLimitResult> {
  const r = await perIpUnauthMinute().limit(`ip:${ip}`);
  return {
    success: r.success,
    limit: 30,
    remaining: r.remaining,
    reset: Math.ceil(r.reset / 1000),
  };
}

/**
 * Signed-out traffic on the tournament join page, per connection: looking a code up, and joining as a guest,
 * each counted on its own. Apart from rateLimitForUnauthIp, so a room pressing "Deck check PDF" (or anything
 * else on that shared allowance) cannot lock the next player out of joining, and the other way round.
 */
export async function rateLimitForJoinIp(bucket: "lookup" | "guest-join", ip: string): Promise<RateLimitResult> {
  const r = await perIpJoinMinute().limit(`${bucket}:${ip}`);
  return {
    success: r.success,
    limit: JOIN_PER_IP_MINUTE,
    remaining: r.remaining,
    reset: Math.ceil(r.reset / 1000),
  };
}
