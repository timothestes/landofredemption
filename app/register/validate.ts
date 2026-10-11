import { NATIONALS_CONFIG } from "@/app/config/nationals";
import type { RegistrationData } from "./actions";

const NAME_MAX = 60;
const EMAIL_MAX = 254;
const DISCORD_MAX = 40;
// Anything URL-shaped. Real names never carry a link; the Oct 2026 form-spam
// run put a bit.ly ad in every name field.
const LINK_PATTERN = /http|www\.|\//i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ValidationResult =
  | { ok: true; data: RegistrationData }
  | { ok: false; error: string };

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function name(v: unknown, label: string): string | { error: string } {
  const s = text(v);
  if (!s) return { error: `${label} is required.` };
  if (LINK_PATTERN.test(s)) return { error: `${label} can't contain a link.` };
  if (s.length > NAME_MAX) return { error: `${label} is too long (max ${NAME_MAX} characters).` };
  return s;
}

function eventValue(v: unknown, day: keyof typeof NATIONALS_CONFIG.events): string | null {
  const s = text(v);
  return NATIONALS_CONFIG.events[day].some((e) => e.value === s) ? s : null;
}

export function validateRegistration(input: RegistrationData): ValidationResult {
  const firstName = name(input.firstName, "First name");
  if (typeof firstName !== "string") return { ok: false, error: firstName.error };
  const lastName = name(input.lastName, "Last name");
  if (typeof lastName !== "string") return { ok: false, error: lastName.error };

  const email = text(input.email).toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const discordUsername = text(input.discordUsername).slice(0, DISCORD_MAX);

  const thursdayEvent = eventValue(input.thursdayEvent, "thursday");
  const fridayEvent = eventValue(input.fridayEvent, "friday");
  const saturdayEvent = eventValue(input.saturdayEvent, "saturday");
  if (!thursdayEvent || !fridayEvent || !saturdayEvent) {
    return { ok: false, error: "Please select an option for each day's event." };
  }

  const allowedNights = new Set(NATIONALS_CONFIG.overnightStayNights.map((n) => n.value));
  const overnightStayNights = Array.isArray(input.overnightStayNights)
    ? input.overnightStayNights.filter((n): n is string => typeof n === "string" && allowedNights.has(n))
    : [];

  return {
    ok: true,
    data: {
      firstName,
      lastName,
      email,
      discordUsername: discordUsername || undefined,
      thursdayEvent,
      fridayEvent,
      saturdayEvent,
      fantasyDraftOptIn: Boolean(input.fantasyDraftOptIn),
      firstNationals: Boolean(input.firstNationals),
      needsAirportTransportation: Boolean(input.needsAirportTransportation),
      needsHotelTransportation: Boolean(input.needsHotelTransportation),
      ironManInterest: Boolean(input.ironManInterest),
      stayingOvernight: Boolean(input.stayingOvernight),
      overnightStayNights,
      lunchThursday: Boolean(input.lunchThursday),
      lunchFriday: Boolean(input.lunchFriday),
      lunchSaturday: Boolean(input.lunchSaturday),
      lunchSaturdayNoPickles: Boolean(input.lunchSaturdayNoPickles),
    },
  };
}
