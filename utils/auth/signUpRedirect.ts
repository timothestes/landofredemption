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
