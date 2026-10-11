import { describe, it, expect } from "vitest";
import { NATIONALS_CONFIG } from "@/app/config/nationals";
import { validateRegistration } from "../validate";

const thu = NATIONALS_CONFIG.events.thursday[0].value;
const fri = NATIONALS_CONFIG.events.friday[0].value;
const sat = NATIONALS_CONFIG.events.saturday[0].value;

function valid() {
  return {
    firstName: "  Ada ",
    lastName: "Lovelace",
    email: "Ada@Example.com ",
    discordUsername: "ada#1",
    thursdayEvent: thu,
    fridayEvent: fri,
    saturdayEvent: sat,
    fantasyDraftOptIn: true,
    firstNationals: false,
    needsAirportTransportation: false,
    needsHotelTransportation: false,
    ironManInterest: false,
    stayingOvernight: true,
    overnightStayNights: [NATIONALS_CONFIG.overnightStayNights[0].value, "bogus"],
    lunchThursday: true,
    lunchFriday: false,
    lunchSaturday: false,
    lunchSaturdayNoPickles: false,
  };
}

describe("validateRegistration", () => {
  it("accepts a normal registration and trims the text fields", () => {
    const r = validateRegistration(valid());
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.data.firstName).toBe("Ada");
    expect(r.data.email).toBe("ada@example.com");
  });

  it("drops overnight nights that are not in the config", () => {
    const r = validateRegistration(valid());
    if (r.ok === false) throw new Error(r.error);
    expect(r.data.overnightStayNights).toEqual([NATIONALS_CONFIG.overnightStayNights[0].value]);
  });

  it("rejects a name that carries a link (the Oct 5 spam payload)", () => {
    const r = validateRegistration({
      ...valid(),
      firstName: "⚡70k TL bonusun anahtari! Hemen basla! https://bit.ly/3T62BNG ⚡",
    });
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.error).toMatch(/link/i);
  });

  it("rejects a name over 60 characters", () => {
    const r = validateRegistration({ ...valid(), lastName: "x".repeat(61) });
    expect(r.ok).toBe(false);
  });

  it("rejects an empty name", () => {
    const r = validateRegistration({ ...valid(), firstName: "   " });
    expect(r.ok).toBe(false);
  });

  it("rejects a malformed email", () => {
    const r = validateRegistration({ ...valid(), email: "not-an-email" });
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.error).toMatch(/email/i);
  });

  it("rejects an event value that is not one of the configured options", () => {
    const r = validateRegistration({ ...valid(), fridayEvent: "free_money" });
    expect(r.ok).toBe(false);
  });

  it("coerces the flags to real booleans", () => {
    const r = validateRegistration({ ...valid(), lunchFriday: "yes" as unknown as boolean });
    if (r.ok === false) throw new Error(r.error);
    expect(r.data.lunchFriday).toBe(true);
    expect(r.data.firstNationals).toBe(false);
  });
});
