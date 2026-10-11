import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyTurnstileToken } from "../turnstile";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.TURNSTILE_SECRET_KEY = "secret-123";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TURNSTILE_SECRET_KEY;
});

function reply(body: unknown, ok = true) {
  fetchMock.mockResolvedValueOnce({ ok, json: async () => body });
}

describe("verifyTurnstileToken", () => {
  it("passes a token Cloudflare accepts, sending the secret, token and ip", async () => {
    reply({ success: true });
    await expect(verifyTurnstileToken("tok", "1.2.3.4")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = init.body as URLSearchParams;
    expect(body.get("secret")).toBe("secret-123");
    expect(body.get("response")).toBe("tok");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });

  it("rejects a token Cloudflare refuses", async () => {
    reply({ success: false, "error-codes": ["invalid-input-response"] });
    await expect(verifyTurnstileToken("tok", "1.2.3.4")).resolves.toBe(false);
  });

  it("rejects when no token was supplied, without calling Cloudflare", async () => {
    await expect(verifyTurnstileToken(null, "1.2.3.4")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is not configured", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    await expect(verifyTurnstileToken("tok", "1.2.3.4")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when Cloudflare returns a non-2xx response", async () => {
    reply({}, false);
    await expect(verifyTurnstileToken("tok", "1.2.3.4")).resolves.toBe(false);
  });

  it("omits remoteip when the ip is unknown", async () => {
    reply({ success: true });
    await verifyTurnstileToken("tok", "unknown");
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.has("remoteip")).toBe(false);
  });
});
