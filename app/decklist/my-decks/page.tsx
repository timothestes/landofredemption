import { Metadata } from "next";
import MyDecksClient from "./client";
import { createClient } from "../../../utils/supabase/server";
import Link from "next/link";

export const metadata: Metadata = {
  title: "My Decks",
  description: "View and manage your Redemption deck collection",
};

export default async function MyDecksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
        <h1 className="font-cinzel text-3xl font-bold tracking-tight mb-3">My Decks</h1>
        <p className="text-muted-foreground text-lg mb-6">
          Sign in to save, manage, and share your Redemption decks.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/sign-in"
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
        <p className="mt-8 text-sm text-muted-foreground">
          You can still <Link href="/decklist/card-search?new=true" className="text-blue-600 dark:text-blue-400 underline">build a deck</Link> without an account — signing in lets you save it to the cloud.
        </p>
      </div>
    );
  }

  return <MyDecksClient />;
}
