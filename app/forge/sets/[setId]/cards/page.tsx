import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listSetCards, canDesignSet } from "@/app/forge/lib/sets";
import { listUnresolvedCommentCounts } from "@/app/forge/lib/comments";
import { listOpenProposalCounts } from "@/app/forge/lib/proposals";
import { listSetActivity } from "@/app/forge/lib/versions";
import SetCardsBrowser from "./SetCardsBrowser";
import AddCardTile from "./AddCardTile";

export const dynamic = "force-dynamic";

export default async function SetCardsPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const { setId } = await params;
  const [cards, canCreate] = await Promise.all([listSetCards(setId), canDesignSet(setId)]);
  if (cards.length === 0) {
    return (
      <div className="mx-auto mt-12 max-w-xs text-center">
        {canCreate ? (
          <>
            <div className="mx-auto mb-3 w-40 text-left">
              <AddCardTile setId={setId} />
            </div>
            <p className="text-sm text-muted-foreground">
              No cards yet. Create one here, share an idea from your ideas library, or{" "}
              <Link href={`/forge/import?set=${setId}`} className="text-primary hover:underline">import cards</Link>
              {" "}from a Lackey file or spreadsheet.
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-4 aspect-[750/1050] w-40 rounded-lg border-2 border-dashed" />
            <p className="text-sm text-muted-foreground">No cards in this set yet. Share an idea from your ideas library.</p>
          </>
        )}
      </div>
    );
  }
  const cardIds = cards.map((c) => c.id);
  const [commentCounts, proposalCounts, releases] = await Promise.all([
    listUnresolvedCommentCounts(cardIds),
    listOpenProposalCounts(cardIds),
    listSetActivity(cardIds),
  ]);
  return <SetCardsBrowser cards={cards} setId={setId} canCreate={canCreate} commentCounts={commentCounts} proposalCounts={proposalCounts} releases={releases} />;
}
