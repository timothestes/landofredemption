"use server";

import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { rateLimitForUnauthIp, extractClientIp } from "@/lib/api/rateLimit";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { isRegistrationAdmin } from "@/utils/adminUtils";
import { sendEmail, getRegistrationConfirmationEmail } from "@/utils/email";
import { NATIONALS_CONFIG } from "@/app/config/nationals";
import { validateRegistration } from "./validate";

export interface RegistrationData {
  firstName: string;
  lastName: string;
  email: string;
  discordUsername?: string;
  thursdayEvent: string;
  fridayEvent: string;
  saturdayEvent: string;
  fantasyDraftOptIn: boolean;
  firstNationals: boolean;
  needsAirportTransportation: boolean;
  needsHotelTransportation: boolean;
  ironManInterest: boolean;
  stayingOvernight: boolean;
  overnightStayNights: string[];
  lunchThursday: boolean;
  lunchFriday: boolean;
  lunchSaturday: boolean;
  lunchSaturdayNoPickles: boolean;
}

export type SubmitRegistrationResult =
  | { success: true; emailSent: boolean }
  | { success: false; error: string };

/** The photo is uploaded client-side to the public avatars bucket; only accept
 *  a URL that points there so the stored link can't be anything else. */
function avatarUrlOrNull(url: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !base) return null;
  return url.startsWith(`${base}/storage/v1/object/public/avatars/`) ? url : null;
}

export async function submitRegistration(
  data: RegistrationData,
  photoUrl: string | null = null,
  turnstileToken: string | null = null,
): Promise<SubmitRegistrationResult> {
  if (!NATIONALS_CONFIG.registrationOpen) {
    return { success: false, error: `Registration for ${NATIONALS_CONFIG.displayName} is closed.` };
  }
  if (NATIONALS_CONFIG.adminOnly && !(await isRegistrationAdmin())) {
    return { success: false, error: "Registration is currently limited to admins." };
  }

  const ip = extractClientIp(new Request("http://x", { headers: await headers() }));

  try {
    const rl = await rateLimitForUnauthIp(ip);
    if (rl.success === false) {
      return { success: false, error: "Too many attempts. Please wait a minute and try again." };
    }
  } catch {
    // Fail open: rateLimitForUnauthIp throws when KV_REST_API_* is unset or the
    // Upstash store is gone. Turnstile below is the gate that must hold.
  }

  if (!(await verifyTurnstileToken(turnstileToken, ip))) {
    return { success: false, error: "Verification failed. Please try again." };
  }

  const validated = validateRegistration(data);
  // strict:false — truthiness doesn't narrow the union, a literal compare does.
  if (validated.ok === false) return { success: false, error: validated.error };
  const reg = validated.data;

  // Service role: the public INSERT policy on registrations is gone (migration
  // 111), so this action is the only way in and the checks above are the gate.
  const { error } = await getSupabaseAdmin().from("registrations").insert({
    first_name: reg.firstName,
    last_name: reg.lastName,
    email: reg.email,
    discord_username: reg.discordUsername || null,
    thursday_event: reg.thursdayEvent,
    friday_event: reg.fridayEvent,
    saturday_event: reg.saturdayEvent,
    fantasy_draft_opt_in: reg.fantasyDraftOptIn,
    first_nationals: reg.firstNationals,
    needs_airport_transportation: reg.needsAirportTransportation,
    needs_hotel_transportation: reg.needsHotelTransportation,
    iron_man_interest: reg.ironManInterest,
    staying_overnight: reg.stayingOvernight,
    overnight_stay_nights: reg.overnightStayNights,
    lunch_thursday: reg.lunchThursday,
    lunch_friday: reg.lunchFriday,
    lunch_saturday: reg.lunchSaturday,
    lunch_saturday_no_pickles: reg.lunchSaturdayNoPickles,
    // Lunch plans are now captured at registration, so mark the form as filled.
    // (Admins still toggle this manually for legacy/Google-Form registrants.)
    lunch_form_filled: true,
    photo_url: avatarUrlOrNull(photoUrl),
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const email = await sendEmail({
    to: reg.email,
    subject: NATIONALS_CONFIG.emailSubject,
    html: getRegistrationConfirmationEmail(
      reg.firstName,
      reg.lastName,
      reg.thursdayEvent,
      reg.fridayEvent,
      reg.saturdayEvent,
    ),
  });
  if (!email.success) {
    console.error("Registration saved but the confirmation email failed:", email.error);
  }

  return { success: true, emailSent: email.success };
}
