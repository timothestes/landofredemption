import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSiteUrl } from "./siteUrl";

describe("getSiteUrl", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("prefers NEXT_PUBLIC_SITE_URL and strips a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://landofredemption.com/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "landofredemption.com");
    vi.stubEnv("VERCEL_URL", "lor-abc123.vercel.app");
    expect(getSiteUrl()).toBe("https://landofredemption.com");
  });

  it("falls back to the Vercel production host before the deployment host", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "landofredemption.com");
    vi.stubEnv("VERCEL_URL", "lor-abc123.vercel.app");
    expect(getSiteUrl()).toBe("https://landofredemption.com");
  });

  it("uses VERCEL_URL only when nothing better is set", () => {
    vi.stubEnv("VERCEL_URL", "lor-abc123.vercel.app");
    expect(getSiteUrl()).toBe("https://lor-abc123.vercel.app");
  });

  it("defaults to localhost", () => {
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });
});
