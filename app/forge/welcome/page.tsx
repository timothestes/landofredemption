import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import OnboardingForm from "./OnboardingForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeWelcomePage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  // Skip onboarding if the profile is already set.
  const { data } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .single();
  if (data?.display_name) redirect("/forge");
  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Welcome to The Forge
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your invite is accepted. Pick a display name so other members recognize you.
      </p>
      <OnboardingForm />
    </div>
  );
}
