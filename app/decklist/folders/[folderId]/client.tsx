"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeckCard, PublicDeck } from "../../community/client";
import type { SharedFolder } from "../../actions";

interface Props {
  folder: SharedFolder;
  decks: PublicDeck[];
  isOwner: boolean;
  currentUserId?: string;
  privateDeckCount: number;
}

export default function SharedFolderClient({ folder, decks, isOwner, currentUserId, privateDeckCount }: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-3 md:px-4 py-4 md:py-8 overflow-x-hidden">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-muted-foreground">Deck folder</p>
          <h1 className="font-cinzel text-3xl font-bold tracking-tight mb-2 break-words">{folder.name}</h1>
          <p className="text-muted-foreground">
            {decks.length} {decks.length === 1 ? "deck" : "decks"}
            {folder.username && (
              <>
                {" · shared by "}
                <Link
                  href={`/decklist/community?username=${encodeURIComponent(folder.username)}`}
                  className="text-foreground hover:underline"
                >
                  {folder.username}
                </Link>
              </>
            )}
          </p>
        </div>
        <button
          onClick={copyLink}
          className="flex-shrink-0 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>

      {isOwner && (
        <div className="mb-6 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {folder.visibility === "private"
            ? "This folder is private — only you can see this page. Share it from My Decks to get a link."
            : `This folder is ${folder.visibility}.`}
          {folder.visibility !== "private" && privateDeckCount > 0 &&
            ` ${privateDeckCount} private ${privateDeckCount === 1 ? "deck is" : "decks are"} hidden from visitors.`}
          {" "}
          <Link href="/decklist/my-decks" className="text-foreground hover:underline">
            Manage in My Decks
          </Link>
        </div>
      )}

      {decks.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">No decks to show in this folder yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {decks.map((deck) => (
            <DeckCard
              key={deck.id}
              deck={deck}
              currentUserId={currentUserId}
              onUsernameClick={(username) =>
                router.push(`/decklist/community?username=${encodeURIComponent(username)}`)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
