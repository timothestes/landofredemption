import { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { loadPublicDecksAction, loadSharedFolderAction } from "../../actions";
import SharedFolderClient from "./client";

interface PageProps {
  params: Promise<{ folderId: string }>;
}

// Shared folders are hand-curated lists, so one page holds them all.
const MAX_DECKS = 200;

const loadFolder = cache((folderId: string) => loadSharedFolderAction(folderId));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { folderId } = await params;
  const result = await loadFolder(folderId);
  if (!result.success) return { title: "Folder Not Found" };

  const { folder } = result;
  const description = [
    `${folder.deck_count} Redemption ${folder.deck_count === 1 ? "deck" : "decks"}`,
    folder.username ? `shared by ${folder.username}` : "",
  ].filter(Boolean).join(" ");

  return {
    title: `${folder.name} - Redemption Deck Folder`,
    description,
    // Unlisted (and the owner's own private view) must not be indexed.
    ...(folder.visibility !== "public" && { robots: { index: false, follow: false } }),
    openGraph: { title: folder.name, description, siteName: "Land of Redemption" },
  };
}

export default async function SharedFolderPage({ params }: PageProps) {
  const { folderId } = await params;
  const result = await loadFolder(folderId);
  if (!result.success) notFound();

  const decksResult = await loadPublicDecksAction({ folderId, pageSize: MAX_DECKS, sort: "name" });

  return (
    <SharedFolderClient
      folder={result.folder}
      decks={decksResult.success ? decksResult.decks : []}
      isOwner={result.isOwner}
      currentUserId={result.currentUserId}
      privateDeckCount={result.privateDeckCount}
    />
  );
}
