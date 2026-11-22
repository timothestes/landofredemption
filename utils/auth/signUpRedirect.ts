import { safeRedirectPath } from "./safeRedirectPath";

/**
 * Where the sign-up confirmation email sends a new user: the auth callback,
 * carrying the page they were headed to (a tournament join link, say) as
 * `redirect_to`, which the callback already honours. Anything that is not a
 * plain path on this site is dropped.
 */
export function signUpCallbackUrl(origin: string | null, redirectTo: unknown): string {
  const path = safeRedirectPath(redirectTo, "");
  const callback = `${origin}/auth/callback`;
  return path ? `${callback}?redirect_to=${encodeURIComponent(path)}` : callback;
}

/** Back to the sign-up form with a message, without losing where the user was headed. */
export function signUpFormPath(
  type: "error" | "success",
  message: string,
  redirectTo: unknown,
): string {
  const path = safeRedirectPath(redirectTo, "");
  const base = `/sign-up?${type}=${encodeURIComponent(message)}`;
  return path ? `${base}&redirectTo=${encodeURIComponent(path)}` : base;
}

// The confirmation email's link comes from a template in the Supabase dashboard
// (`/auth/callback?token_hash=…&type=signup&redirect_to=/decklist/community`) that
// leaves out the `redirect_to` set above and carries its own fixed one instead.
// So the destination is also stored on the new account, and the callback reads it
// back from the user the link confirms. This works whichever browser the email app
// opens the link in.
const SIGN_UP_REDIRECT_KEY = "signup_redirect_to";

/** User metadata for `signUp` that remembers where the new user was headed. */
export function signUpRedirectData(redirectTo: unknown): Record<string, string> {
  const path = safeRedirectPath(redirectTo, "");
  return path ? { [SIGN_UP_REDIRECT_KEY]: path } : {};
}

/**
 * Where the auth callback sends someone once their link checks out: for a
 * sign-up confirmation, the page stored at sign-up (it has to beat the
 * template's fixed `redirect_to`); else the link's own `redirect_to`; else home.
 */
export function callbackDestination(
  redirectParam: string | null | undefined,
  type: string | null,
  userMetadata: Record<string, unknown> | undefined,
): string {
  if (type === "signup" || type === "email") {
    const stored = safeRedirectPath(userMetadata?.[SIGN_UP_REDIRECT_KEY], "");
    if (stored) return stored;
  }
  if (redirectParam) return safeRedirectPath(redirectParam);
  return "/";
}
