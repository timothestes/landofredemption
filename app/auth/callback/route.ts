import { createClient } from "../../../utils/supabase/server";
import { safeRedirectPath } from "../../../utils/auth/safeRedirectPath";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  // The `/auth/callback` route is required for the server-side auth flow implemented
  // by the SSR package. It exchanges an auth code for the user's session.
  // https://supabase.com/docs/guides/auth/server-side/nextjs
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const token_hash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const origin = requestUrl.origin;
  const redirectTo = requestUrl.searchParams.get("redirect_to")?.toString();

  const supabase = await createClient();

  let authError: string | null = null;

  if (token_hash && type) {
    // PKCE-style token_hash flow (used by custom email templates)
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as any });
    if (error) authError = error.message;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) authError = error.message;
  }

  if (authError) {
    const signInUrl = new URL("/sign-in", origin);
    signInUrl.searchParams.set("error", "Authentication failed. Please try again.");
    return NextResponse.redirect(signInUrl.toString());
  }

  if (redirectTo) {
    return NextResponse.redirect(`${origin}${safeRedirectPath(redirectTo)}`);
  }

  // URL to redirect to after sign up process completes
  return NextResponse.redirect(`${origin}/`);
}
