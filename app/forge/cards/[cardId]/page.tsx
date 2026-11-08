import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { playtesterCardHref } from "@/app/forge/lib/play";
import { getCard } from "@/app/forge/lib/cards";
import { listArtCandidates } from "@/app/forge/lib/artCandidates";
import { getSet, listWritableSets, listSetSiblings, canDesignSet } from "@/app/forge/lib/sets";
import { canEditArtSources, canWriteCard } from "@/app/forge/lib/setAccess";
import { sortSetCards } from "@/app/forge/lib/cardOrder";
import { filterQuery, gridHref, parseCardFilters, walkSet } from "@/app/forge/lib/cardFilters";
import { sameSnapshot } from "@/app/forge/lib/cardDiff";
import { getOpenProposalDiffs, listProposals } from "@/app/forge/lib/proposals";
import { listComments } from "@/app/forge/lib/comments";
import { listVersions, listCardEvents, listSetActivity, artChangedSince, getShelvedRecord } from "@/app/forge/lib/versions";
import { pickStudioVersion } from "@/app/forge/lib/studioVersion";
import StudioEditor from "./StudioEditor";
import ReviewPanel from "./ReviewPanel";

export const dynamic = "force-dynamic";

export default async function StudioPage({ params, searchParams }: {
  params: Promise<{ cardId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { cardId } = await params;
  if (ctx.role === "playtester") redirect(await playtesterCardHref(cardId));
  // The filters of the grid you came from, kept on the way along the arrows and back.
  const filters = parseCardFilters(await searchParams);
  const card = await getCard(cardId);
  if (!card) notFound();
  const [artCandidates, set] = await Promise.all([
    listArtCandidates(cardId),
    card.setId ? getSet(card.setId) : null,
  ]);

  const inSet = card.setId !== null;
  const sets = inSet ? [] : await listWritableSets();
  const [openDiffs, proposals, comments, versions, events, siblings] = inSet
    ? await Promise.all([
        getOpenProposalDiffs(cardId),
        listProposals(cardId),
        listComments(cardId),
        listVersions(cardId),
        listCardEvents(cardId),
        listSetSiblings(card.setId!),
      ])
    : [[], [], [], [], [], []];
  // Which controls to offer. The RPCs check again, and they are what actually decides.
  const canDesign = card.setId ? await canDesignSet(card.setId) : false;
  const who = { isOwner: card.ownerId === ctx.user.id, role: ctx.role, canDesign };
  const canEdit = canWriteCard({ status: card.status, ...who });
  const canReview = canDesign && canEdit;

  // Releasing closes every open proposal (migration 083); one that is exactly
  // this working draft is recorded as accepted instead. Classified here so the
  // release dialog can say which will happen. Wording only — the RPC decides.
  const openProposals = {
    count: openDiffs.length,
    hasMatch: openDiffs.some((d) => sameSnapshot(d.proposal.proposedSnapshot, card.snapshot ?? {})),
  };

  // The newest version playtesters have seen; draft iterations never reached them.
  // versions is newest first. The release dialog compares the live draft against it.
  const lastRelease = versions.find((v) => v.status !== "draft") ?? null;
  const releaseBase = lastRelease
    ? {
        versionNumber: lastRelease.versionNumber,
        data: lastRelease.data,
        live: lastRelease.id === card.publishedVersionId,
        artChanged: await artChangedSince(cardId, lastRelease.id),
      }
    : null;

  // Where Restore will put a shelved card, for its dialog. Wording only; the RPC decides.
  const shelved = card.status === "archived" ? await getShelvedRecord(cardId) : null;
  const restoreTarget = shelved
    ? {
        status: shelved.status,
        versionNumber: versions.find((v) => v.id === shelved.versionId)?.versionNumber ?? null,
      }
    : null;

  // The header's version pill. The text is compared on the client against the live draft; the
  // images only here, so their blob keys stay on the server. A Final card's released version
  // can be older than lastRelease, so it may need its own comparison.
  const releasedId = card.approvedVersionId ?? card.publishedVersionId;
  const moved = !releasedId
    ? false
    : releasedId === lastRelease?.id
      ? !!releaseBase?.artChanged
      : await artChangedSince(cardId, releasedId);
  const version = pickStudioVersion(card, versions, moved);

  // Prev/next arrows on the card face walk the list the grid showed: its filter, in its order.
  // No wrap: the boundary card gets null and hides that arrow. The position is shown under the
  // face so walking a set tells you where you are, and so the ←/→ shortcut is discoverable at all.
  const ordered = sortSetCards(siblings);
  const releases = inSet && filters.since ? await listSetActivity(ordered.map((c) => c.id)) : undefined;
  const { prevId, nextId, position } = walkSet(ordered, cardId, filters, releases);

  // The second is the "Created by" line in the studio header. Same member-readable name lookup as History.
  const [{ data: meRow }, { data: creatorRow }] = await Promise.all([
    ctx.supabase.from("playtest_members").select("display_name").eq("user_id", ctx.user.id).single(),
    ctx.supabase.from("playtest_members").select("display_name").eq("user_id", card.creatorId).maybeSingle(),
  ]);
  const currentUser = { userId: ctx.user.id, displayName: meRow?.display_name ?? null };
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
      walkQuery={filterQuery(filters)}
      gridHref={gridHref(card.setId, cardId, filters)}
      position={position}
      artCandidates={artCandidates}
      openProposals={openProposals}
      releaseBase={releaseBase}
      restoreTarget={restoreTarget}
      version={version}
      unresolvedComments={comments.filter((c) => c.proposalId === null && !c.resolved).length}
      canEdit={canEdit}
      canEditSources={canEditArtSources(who)}
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
