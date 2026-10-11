import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock specifiers MUST match the implementation's "@/"-aliased imports
// exactly (plus "next/headers") or the mocks silently don't apply.

const state = vi.hoisted(() => ({ registrationOpen: true, adminOnly: false }));

vi.mock("@/app/config/nationals", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/app/config/nationals")>();
  return {
    NATIONALS_CONFIG: {
      ...mod.NATIONALS_CONFIG,
      get registrationOpen() {
        return state.registrationOpen;
      },
      get adminOnly() {
        return state.adminOnly;
      },
    },
  };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

const mockIsRegistrationAdmin = vi.fn();
vi.mock("@/utils/adminUtils", () => ({
  isRegistrationAdmin: () => mockIsRegistrationAdmin(),
}));

const mockRateLimit = vi.fn();
vi.mock("@/lib/api/rateLimit", () => ({
  extractClientIp: vi.fn(() => "1.2.3.4"),
  rateLimitForUnauthIp: (ip: string) => mockRateLimit(ip),
}));

const mockVerifyTurnstile = vi.fn();
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstileToken: (...args: unknown[]) => mockVerifyTurnstile(...args),
}));

const mockInsert = vi.fn();
vi.mock("@/lib/pricing/supabase-admin", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ insert: mockInsert }) }),
}));

const mockSendEmail = vi.fn();
vi.mock("@/utils/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  getRegistrationConfirmationEmail: () => "<html>confirmation</html>",
}));

import { submitRegistration } from "../actions";
import { NATIONALS_CONFIG } from "@/app/config/nationals";

const AVATARS = "https://proj.supabase.co/storage/v1/object/public/avatars/123-me.jpg";

function data(overrides: Partial<Parameters<typeof submitRegistration>[0]> = {}) {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "Ada@Example.com",
    discordUsername: "",
    thursdayEvent: NATIONALS_CONFIG.events.thursday[0].value,
    fridayEvent: NATIONALS_CONFIG.events.friday[0].value,
    saturdayEvent: NATIONALS_CONFIG.events.saturday[0].value,
    fantasyDraftOptIn: false,
    firstNationals: true,
    needsAirportTransportation: false,
    needsHotelTransportation: false,
    ironManInterest: false,
    stayingOvernight: false,
    overnightStayNights: [],
    lunchThursday: false,
    lunchFriday: false,
    lunchSaturday: false,
    lunchSaturdayNoPickles: false,
    ...overrides,
  };
}

beforeEach(() => {
  state.registrationOpen = true;
  state.adminOnly = false;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  mockIsRegistrationAdmin.mockReset().mockResolvedValue(false);
  mockRateLimit.mockReset().mockResolvedValue({ success: true });
  mockVerifyTurnstile.mockReset().mockResolvedValue(true);
  mockInsert.mockReset().mockResolvedValue({ error: null });
  mockSendEmail.mockReset().mockResolvedValue({ success: true });
});

describe("submitRegistration", () => {
  it("refuses while registration is closed, before any other work", async () => {
    state.registrationOpen = false;
    const r = await submitRegistration(data(), null, "tok");
    expect(r.success).toBe(false);
    if (r.success === true) return;
    expect(r.error).toMatch(/closed/i);
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("refuses non-admins while registration is admin-only", async () => {
    state.adminOnly = true;
    const r = await submitRegistration(data(), null, "tok");
    expect(r.success).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("lets an admin through while registration is admin-only", async () => {
    state.adminOnly = true;
    mockIsRegistrationAdmin.mockResolvedValue(true);
    const r = await submitRegistration(data(), null, "tok");
    expect(r.success).toBe(true);
  });

  it("refuses a rate-limited ip before touching Turnstile", async () => {
    mockRateLimit.mockResolvedValue({ success: false });
    const r = await submitRegistration(data(), null, "tok");
    expect(r.success).toBe(false);
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still proceeds when the rate limiter is unavailable", async () => {
    mockRateLimit.mockRejectedValue(new Error("KV_REST_API_URL/TOKEN not set"));
    const r = await submitRegistration(data(), null, "tok");
    expect(r.success).toBe(true);
  });

  it("refuses when Turnstile rejects the token", async () => {
    mockVerifyTurnstile.mockResolvedValue(false);
    const r = await submitRegistration(data(), null, "bad");
    expect(r.success).toBe(false);
    if (r.success === true) return;
    expect(r.error).toMatch(/verification/i);
    expect(mockVerifyTurnstile).toHaveBeenCalledWith("bad", "1.2.3.4");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("refuses a spam payload before inserting or emailing", async () => {
    const r = await submitRegistration(
      data({ firstName: "⚡70k TL bonusun anahtari! https://bit.ly/3T62BNG ⚡" }),
      null,
      "tok",
    );
    expect(r.success).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("inserts with the service-role client and emails the registrant", async () => {
    const r = await submitRegistration(data(), AVATARS, "tok");
    expect(r).toEqual({ success: true, emailSent: true });
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const row = mockInsert.mock.calls[0][0];
    expect(row).toMatchObject({
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      first_nationals: true,
      lunch_form_filled: true,
      photo_url: AVATARS,
    });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ada@example.com", subject: NATIONALS_CONFIG.emailSubject }),
    );
  });

  it("drops a photo url that is not from our avatars bucket", async () => {
    await submitRegistration(data(), "https://evil.example/ad.png", "tok");
    expect(mockInsert.mock.calls[0][0].photo_url).toBeNull();
  });

  it("reports a failed confirmation email without losing the registration", async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: "quota" });
    const r = await submitRegistration(data(), null, "tok");
    expect(r).toEqual({ success: true, emailSent: false });
  });

  it("surfaces the insert error and sends no email", async () => {
    mockInsert.mockResolvedValue({ error: { message: "boom" } });
    const r = await submitRegistration(data(), null, "tok");
    expect(r).toEqual({ success: false, error: "boom" });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
