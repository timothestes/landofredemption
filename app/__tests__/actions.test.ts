import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "https://landofredemption.com" })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

const mockSignUp = vi.fn();
vi.mock("../../utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signUp: mockSignUp } })),
}));

import { signUpAction } from "../actions";

function form(email: string, password = "hunter22") {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

/** The message signUpAction redirected back to /sign-up with. */
async function redirectMessage(fd: FormData) {
  const err = await signUpAction(fd).catch((e: Error) => e);
  const url = new URL((err as Error).message.replace("REDIRECT ", ""), "https://x");
  expect(url.pathname).toBe("/sign-up");
  return url.searchParams.get("error");
}

describe("signUpAction", () => {
  beforeEach(() => {
    mockSignUp.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("explains a failed confirmation email instead of passing Supabase's text through", async () => {
    // Supabase's mailer rejects addresses the browser accepts, like "a..b@gmail.com",
    // and reports only that the send failed.
    mockSignUp.mockResolvedValue({
      error: { code: "unexpected_failure", message: "Error sending confirmation email" },
    });

    expect(await redirectMessage(form("a..b@gmail.com"))).toBe(
      "We couldn't send a confirmation email to that address. Check it for typos and try again.",
    );
  });

  it("passes other Supabase errors through unchanged", async () => {
    mockSignUp.mockResolvedValue({
      error: { code: "weak_password", message: "Password should be at least 6 characters." },
    });

    expect(await redirectMessage(form("a@b.com", "x"))).toBe(
      "Password should be at least 6 characters.",
    );
  });
});
