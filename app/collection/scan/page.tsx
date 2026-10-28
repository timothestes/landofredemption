import { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "../../../utils/supabase/server";
import { canScanForSession } from "../../../lib/scan/gate";
import { COPY } from "./copy";
import ScanClient from "./client";

export const metadata: Metadata = {
  title: "Scan cards",
  description: "Photograph your Redemption cards to see what they're worth and add them to your collection",
};

export default async function ScanPage() {
  const supabase = await createClient();
  const { user, allowed } = await canScanForSession(supabase);

  if (!user) {
    return (
      <div className="w-full max-w-2xl mx-auto px-4 py-16 text-center">
        <svg
          className="mx-auto h-20 w-20 text-muted-foreground mb-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
        <h1 className="font-cinzel text-3xl font-bold tracking-tight mb-3">{COPY.pageTitle}</h1>
        <p className="text-muted-foreground text-lg mb-6">{COPY.gate}</p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/sign-in?redirectTo=/collection/scan"
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="px-6 py-3 border border-border rounded-lg font-medium hover:bg-muted transition-colors"
          >
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  if (!allowed) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <header className="flex items-center gap-3">
        <h1 className="font-cinzel text-2xl font-bold tracking-tight sm:text-3xl">{COPY.pageTitle}</h1>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {COPY.beta}
        </span>
      </header>
      <ScanClient userId={user.id} />
    </div>
  );
}
