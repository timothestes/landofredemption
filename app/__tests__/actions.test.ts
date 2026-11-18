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
const mockResetPassword = vi.fn();
vi.mock("../../utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { signUp: mockSignUp, resetPasswordForEmail: mockResetPassword },
  })),
}));

vi.mock("../../lib/api/rateLimit", () => ({
  extractClientIp: vi.fn(() => "1.2.3.4"),
}));

const mockVerifyTurnstile = vi.fn();
vi.mock("../../lib/turnstile", () => ({
  verifyTurnstileToken: (...args: unknown[]) => mockVerifyTurnstile(...args),
}));

import { signUpAction, forgotPasswordAction } from "../actions";

const BOT_CHECK_FAILED =
  "We couldn't confirm you're not a bot. Wait for the check above the button to finish, then try again.";

function form(email: string, password = "hunter22", token: string | null = "tok") {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  if (token) fd.set("cf-turnstile-response", token);
  return fd;
}

/** Where the action redirected to, as a URL. */
async function redirectUrl(action: (fd: FormData) => Promise<unknown>, fd: FormData) {
  const err = await action(fd).catch((e: Error) => e);
  return new URL((err as Error).message.replace("REDIRECT ", ""), "https://x");
}

/** The message signUpAction redirected back to /sign-up with. */
async function redirectMessage(fd: FormData) {
  const url = await redirectUrl(signUpAction, fd);
  expect(url.pathname).toBe("/sign-up");
  return url.searchParams.get("error");
}

beforeEach(() => {
  mockSignUp.mockReset();
  mockResetPassword.mockReset();
  mockVerifyTurnstile.mockReset();
  mockVerifyTurnstile.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signUpAction", () => {
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

  it("creates no account and sends no email when the bot check fails", async () => {
    mockVerifyTurnstile.mockResolvedValue(false);

    expect(await redirectMessage(form("stranger@example.com"))).toBe(BOT_CHECK_FAILED);
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("checks the token the form posted, with the caller's IP", async () => {
    mockSignUp.mockResolvedValue({ error: null });

    await redirectUrl(signUpAction, form("a@b.com", "hunter22", "tok-123"));

    expect(mockVerifyTurnstile).toHaveBeenCalledWith("tok-123", "1.2.3.4");
    expect(mockSignUp).toHaveBeenCalledTimes(1);
  });

  it("treats a form with no token as a failed bot check", async () => {
    mockVerifyTurnstile.mockImplementation(async (token: unknown) => Boolean(token));

    expect(await redirectMessage(form("a@b.com", "hunter22", null))).toBe(BOT_CHECK_FAILED);
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});

describe("forgotPasswordAction", () => {
  it("sends no reset email when the bot check fails", async () => {
    mockVerifyTurnstile.mockResolvedValue(false);

    const url = await redirectUrl(forgotPasswordAction, form("stranger@example.com"));

    expect(url.pathname).toBe("/forgot-password");
    expect(url.searchParams.get("error")).toBe(BOT_CHECK_FAILED);
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("sends the reset email once the bot check passes", async () => {
    mockResetPassword.mockResolvedValue({ error: null });

    const url = await redirectUrl(forgotPasswordAction, form("a@b.com"));

    expect(mockResetPassword).toHaveBeenCalledTimes(1);
    expect(url.pathname).toBe("/forgot-password");
    expect(url.searchParams.get("success")).toBeTruthy();
  });
});
