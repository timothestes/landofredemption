"use server";

import { encodedRedirect } from "../utils/utils";
import { createClient } from "../utils/supabase/server";
import { safeRedirectPath } from "../utils/auth/safeRedirectPath";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const signUpAction = async (formData: FormData) => {
  const email = formData.get("email")?.toString();
  const password = formData.get("password")?.toString();
  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  if (!email || !password) {
    return encodedRedirect(
      "error",
      "/sign-up",
      "Email and password are required",
    );
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    console.error(error.code + " " + error.message);
    return encodedRedirect("error", "/sign-up", error.message);
  } else {
    // Supabase deliberately returns no error when the email already belongs to a
    // confirmed account, and sends no verification email — so a bare "check your
    // email" here strands people who already have an account (they wait on a mail
    // that never arrives). Cover both cases without confirming whether the account
    // exists, which is what the obfuscation is protecting against.
    return encodedRedirect(
      "success",
      "/sign-up",
      "Thanks for signing up! If this email is new, check your inbox for a verification link. If you already have an account, no email was sent — sign in instead, or reset your password if you've forgotten it.",
    );
  }
};

export const signInAction = async (formData: FormData) => {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const redirectTo = formData.get("redirectTo") as string | null;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const searchParams = new URLSearchParams();
    searchParams.append('email', email);

    // Map Supabase error to user-friendly message
    let friendlyMessage = error.message;
    if (error.message === 'Invalid login credentials') {
      friendlyMessage = 'Incorrect email or password. Please try again.';
    }

    searchParams.append('error', friendlyMessage);
    if (redirectTo) searchParams.append('redirectTo', redirectTo);
    return redirect(`/sign-in?${searchParams.toString()}`);
  }

  return redirect(safeRedirectPath(redirectTo));
};

export const forgotPasswordAction = async (formData: FormData) => {
  const email = formData.get("email")?.toString();
  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const callbackUrl = formData.get("callbackUrl")?.toString();

  if (!email) {
    return encodedRedirect("error", "/forgot-password", "Email is required");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/tracker/reset-password`,
  });

  if (error) {
    console.error(error.message);
    return encodedRedirect(
      "error",
      "/forgot-password",
      "Could not reset password",
    );
  }

  const safeCallbackUrl = safeRedirectPath(callbackUrl, "");
  if (safeCallbackUrl) {
    return redirect(safeCallbackUrl);
  }

  return encodedRedirect(
    "success",
    "/forgot-password",
    "Check your email for a link to reset your password.",
  );
};

export const resetPasswordAction = async (formData: FormData) => {
  const supabase = await createClient();

  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || !confirmPassword) {
    encodedRedirect(
      "error",
      "/tracker/reset-password",
      "Password and confirm password are required",
    );
  }

  if (password !== confirmPassword) {
    encodedRedirect(
      "error",
      "/tracker/reset-password",
      "Passwords do not match",
    );
  }

  const { error } = await supabase.auth.updateUser({
    password: password,
  });

  if (error) {
    encodedRedirect(
      "error",
      "/tracker/reset-password",
      "Password update failed. Try using a different password.",
    );
  }

  encodedRedirect("success", "/tracker/reset-password", "Password updated");
};

export const signOutAction = async (_formData: FormData) => {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect("/sign-in");
};
