import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "../safeRedirectPath";
import { signUpCallbackUrl, signUpFormPath } from "../signUpRedirect";

const ORIGIN = "https://example.test";

// What the auth callback does with the link's `redirect_to` (app/auth/callback/route.ts).
function landsOn(callbackUrl: string): string {
  const redirectTo = new URL(callbackUrl).searchParams.get("redirect_to");
  return redirectTo ? safeRedirectPath(redirectTo) : "/";
}

describe("signUpCallbackUrl", () => {
  it("carries a join link through the confirmation email to the callback", () => {
    const url = signUpCallbackUrl(ORIGIN, "/join/T7K2QF");
    expect(url).toBe("https://example.test/auth/callback?redirect_to=%2Fjoin%2FT7K2QF");
    expect(landsOn(url)).toBe("/join/T7K2QF");
  });

  it("keeps a destination's own query string intact", () => {
    const url = signUpCallbackUrl(ORIGIN, "/decklist/card-search?deckId=abc&tab=cards");
    expect(landsOn(url)).toBe("/decklist/card-search?deckId=abc&tab=cards");
  });

  it("is the bare callback when there is no destination", () => {
    expect(signUpCallbackUrl(ORIGIN, undefined)).toBe("https://example.test/auth/callback");
    expect(signUpCallbackUrl(ORIGIN, null)).toBe("https://example.test/auth/callback");
    expect(signUpCallbackUrl(ORIGIN, "")).toBe("https://example.test/auth/callback");
  });

  it("drops a destination that is not a path on this site", () => {
    for (const bad of [
      "https://evil.test/join/T7K2QF",
      "//evil.test",
      "/\\evil.test",
      "/@evil.test",
      "javascript:alert(1)",
      "/join\r\nSet-Cookie: a=b",
    ]) {
      expect(signUpCallbackUrl(ORIGIN, bad)).toBe("https://example.test/auth/callback");
    }
  });
});

describe("signUpFormPath", () => {
  it("returns to the form with the message and the destination", () => {
    const path = signUpFormPath("error", "Email and password are required", "/join/T7K2QF");
    const url = new URL(path, ORIGIN);
    expect(url.pathname).toBe("/sign-up");
    expect(url.searchParams.get("error")).toBe("Email and password are required");
    expect(url.searchParams.get("redirectTo")).toBe("/join/T7K2QF");
  });

  it("has only the message when there is no destination", () => {
    expect(signUpFormPath("success", "Check your inbox", undefined)).toBe(
      "/sign-up?success=Check%20your%20inbox",
    );
  });

  it("drops a destination that is not a path on this site", () => {
    expect(signUpFormPath("error", "Nope", "https://evil.test")).toBe("/sign-up?error=Nope");
  });
});
