import { Metadata } from "next";
import CommunityClient from "./client";
import { loadPublicDecksAction, loadPublicFoldersAction } from "../actions";
import { createClient } from "../../../utils/supabase/server";

export const metadata: Metadata = {
  title: "Community Decks",
  description: "Browse public Redemption decks shared by the community",
  alternates: { canonical: "/decklist/community" },
};

export default async function CommunityDecksPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [result, { count: tournamentDeckCount }, foldersResult] = await Promise.all([
    loadPublicDecksAction({ page: 1, pageSize: 24, sort: "newest" }),
    supabase
      .from("tournament_decklists")
      .select("id, tournaments!inner(decklists_published)", { count: "exact", head: true })
      .eq("tournaments.decklists_published", true)
      .not("published_deck_id", "is", null),
    loadPublicFoldersAction(),
  ]);
  const initialDecks = result.success ? result.decks : [];
  const initialCount = result.success ? result.totalCount : 0;

  return (
    <CommunityClient
      initialDecks={initialDecks}
      initialCount={initialCount}
      initialFolders={foldersResult.folders}
      currentUserId={user?.id}
      showTournamentFilter={(tournamentDeckCount ?? 0) > 0}
    />
  );
}
