import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "../safeRedirectPath";
import {
  callbackDestination,
  signUpCallbackUrl,
  signUpFormPath,
  signUpRedirectData,
} from "../signUpRedirect";

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

// The confirmation email's link is built by a template in the Supabase dashboard
// (`/auth/callback?token_hash=…&type=…`), which leaves out `redirect_to`. The
// destination rides on the new account instead and comes back when the link is used.
describe("signUpRedirectData + callbackDestination", () => {
  const confirmed = (redirectTo: unknown, type = "signup") =>
    callbackDestination(null, type, signUpRedirectData(redirectTo));

  it("sends a confirmed sign-up to the join link they started from", () => {
    expect(confirmed("/join/T7K2QF")).toBe("/join/T7K2QF");
    expect(confirmed("/join/T7K2QF", "email")).toBe("/join/T7K2QF");
  });

  it("keeps a destination's own query string intact", () => {
    expect(confirmed("/decklist/card-search?deckId=abc&tab=cards")).toBe(
      "/decklist/card-search?deckId=abc&tab=cards",
    );
  });

  it("stores nothing and lands on home when there was no destination", () => {
    expect(signUpRedirectData(undefined)).toEqual({});
    expect(signUpRedirectData("")).toEqual({});
    expect(confirmed(undefined)).toBe("/");
  });

  it("never stores or follows a destination that is not a path on this site", () => {
    for (const bad of ["https://evil.test/join/T7K2QF", "//evil.test", "/@evil.test"]) {
      expect(signUpRedirectData(bad)).toEqual({});
      // Account metadata can be edited by its owner, so it is checked again on the way out.
      expect(callbackDestination(null, "signup", { signup_redirect_to: bad })).toBe("/");
    }
  });

  it("prefers the link's own redirect_to when it has one", () => {
    expect(
      callbackDestination("/tournaments/1", "signup", signUpRedirectData("/join/T7K2QF")),
    ).toBe("/tournaments/1");
  });

  it("ignores the stored destination for links that are not a sign-up confirmation", () => {
    const meta = signUpRedirectData("/join/T7K2QF");
    expect(callbackDestination(null, "recovery", meta)).toBe("/");
    expect(callbackDestination(null, null, meta)).toBe("/");
  });

  it("matches the callback's old behaviour for links with redirect_to or nothing", () => {
    expect(callbackDestination("/join/T7K2QF", null, undefined)).toBe("/join/T7K2QF");
    expect(callbackDestination("https://evil.test", null, undefined)).toBe("/");
    expect(callbackDestination(null, null, undefined)).toBe("/");
  });
});
