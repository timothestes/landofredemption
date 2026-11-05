import { notFound } from "next/navigation";
import { createClient } from "../../../utils/supabase/server";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ deckId: string }>;
}

// Postgres "invalid input syntax for type uuid": a malformed id in the URL is
// a miss, not a failure.
const INVALID_UUID = "22P02";

// Sits above this segment's loading.tsx boundary, so it is the only place a
// miss can still become a real 404: once the page streams under the skeleton
// the 200 shell has already gone out, and the page body's notFound() can only
// swap in the not-found UI. The check is the loader's own first step (same
// cookie-session client, same RLS): a row this client cannot see is "Deck not
// found" in loadPublicDeckAction too. A visible-but-private deck returns
// children, so the page renders its "This deck is private" view as before.
// Only a missing row or a malformed id is a 404. Any other error (PostgREST or
// network — supabase-js hands both back as `error` rather than throwing) is
// thrown to app/decklist/error.tsx instead: a real 404 during a Supabase blip
// would tell crawlers every deck is gone.
export default async function PublicDeckLayout({ children, params }: LayoutProps) {
  const { deckId } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("decks")
    .select("id")
    .eq("id", deckId)
    .maybeSingle();

  if (error && error.code !== INVALID_UUID) {
    throw error;
  }
  if (!data) {
    notFound();
  }

  return children;
}
