import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getForgeDeckView } from "@/app/forge/lib/forgeDecks";
import { listGrantedForgeCards } from "@/app/forge/lib/deckPool";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import DeckViewClient from "./DeckViewClient";

export const dynamic = "force-dynamic";

// Read-only deck preview — the target of a Forge share link. RLS admits the
// owner and any member when the deck is shared; everything else 404s so the
// area stays secret. Forge card art resolves under the *viewer's* grants:
// cards from sets not shared with the viewer render as placeholder tiles.
export default async function ForgeDeckViewPage({ params }: { params: Promise<{ deckId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { deckId } = await params;
  const deck = await getForgeDeckView(deckId);
  if (!deck) notFound();
  const granted = await listGrantedForgeCards();

  return (
    <div className="mx-auto max-w-6xl p-6">
      <ForgeBreadcrumbs
        items={[
          { label: "The Forge", href: "/forge" },
          { label: "Decks", href: "/forge/play/decks" },
          { label: deck.name },
        ]}
      />
      <DeckViewClient deck={deck} granted={granted} />
    </div>
  );
}
