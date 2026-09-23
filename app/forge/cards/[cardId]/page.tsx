import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getCard } from "@/app/forge/lib/cards";
import { listArtCandidates } from "@/app/forge/lib/artCandidates";
import { getSet, listSets, listSetCards } from "@/app/forge/lib/sets";
import { sortSetCards } from "@/app/forge/lib/cardOrder";
import { sameSnapshot } from "@/app/forge/lib/cardDiff";
import { getOpenProposalDiffs, listProposals } from "@/app/forge/lib/proposals";
import { listComments } from "@/app/forge/lib/comments";
import { listVersions, listCardEvents } from "@/app/forge/lib/versions";
import StudioEditor from "./StudioEditor";
import ReviewPanel from "./ReviewPanel";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params }: { params: Promise<{ cardId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const { cardId } = await params;
  const card = await getCard(cardId);
  if (!card) notFound();
  const artCandidates = await listArtCandidates(cardId);
  const set = card.setId ? await getSet(card.setId) : null;

  const inSet = card.setId !== null;
  const sets = inSet ? [] : await listSets();
  const [openDiffs, proposals, comments, versions, events, siblings] = inSet
    ? await Promise.all([
        getOpenProposalDiffs(cardId),
        listProposals(cardId),
        listComments(cardId),
        listVersions(cardId),
        listCardEvents(cardId),
        listSetCards(card.setId!),
      ])
    : [[], [], [], [], [], []];
  const canReview = ctx.role === "elder" || ctx.role === "superadmin";

  // Releasing closes every open proposal (migration 083); one that is exactly
  // this working draft is recorded as accepted instead. Classified here so the
  // release dialog can say which will happen. Wording only — the RPC decides.
  const openProposals = {
    count: openDiffs.length,
    hasMatch: openDiffs.some((d) => sameSnapshot(d.proposal.proposedSnapshot, card.snapshot ?? {})),
  };

  // Prev/next arrows on the card face walk the set in the same order as the grid.
  // No wrap: the boundary card gets null and hides that arrow.
  const ordered = sortSetCards(siblings);
  const idx = ordered.findIndex((c) => c.id === cardId);
  const prevId = idx > 0 ? ordered[idx - 1].id : null;
  const nextId = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1].id : null;
  // Shown under the face so walking a set tells you where you are, and so the ←/→
  // shortcut is discoverable at all.
  const position = idx >= 0 && ordered.length > 1 ? { index: idx + 1, total: ordered.length } : null;

  const { data: meRow } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", ctx.user.id)
    .single();
  const currentUser = { userId: ctx.user.id, displayName: meRow?.display_name ?? null };

  // "Created by" line in the studio header. Same member-readable name lookup as History.
  const { data: creatorRow } = await ctx.supabase
    .from("playtest_members")
    .select("display_name")
    .eq("user_id", card.creatorId)
    .maybeSingle();
  const creator = { name: creatorRow?.display_name ?? "Forge member", at: card.createdAt };

  // ReviewPanel is passed INTO the studio rather than rendered after it: a sticky element
  // can only travel inside its own containing block, so while the review sat outside the
  // studio's grid the card face stopped following you exactly when you reached it.
  return (
    <StudioEditor
      card={card}
      sets={sets}
      currentUser={currentUser}
      creator={creator}
      setId={card.setId ?? null}
      setName={set?.name ?? null}
      prevId={prevId}
      nextId={nextId}
      position={position}
      artCandidates={artCandidates}
      openProposals={openProposals}
      review={
        inSet ? (
          // key: React validates this as a keyless list child once it crosses the
          // server/client boundary as a named prop, and warns without one.
          <ReviewPanel
            key="review"
            card={card}
            openDiffs={openDiffs}
            proposals={proposals}
            comments={comments}
            versions={versions}
            events={events}
            canReview={canReview}
            alreadyUnderReview={openProposals.hasMatch}
          />
        ) : null
      }
    />
  );
}
