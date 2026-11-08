import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { getSet } from "@/app/forge/lib/sets";
import { listSetApprovedCards } from "@/app/forge/lib/play";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import RevealGrid, { type RevealItem } from "./RevealGrid";

export const dynamic = "force-dynamic";

export default async function ForgePlaySetPage({
  params,
  searchParams,
}: {
  params: Promise<{ setId: string }>;
  searchParams: Promise<{ card?: string | string[] }>;
}) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const { setId } = await params;
  const set = await getSet(setId); // RLS hides sets the caller can't see → 404
  if (!set) notFound();
  const cards = await listSetApprovedCards(setId);
  const items: RevealItem[] = cards.map((c) => ({
    cardId: c.cardId,
    data: c.data,
    artUrl: c.hasApprovedArt ? `/forge/api/art/${c.cardId}?v=approved` : null,
    finishedUrl: c.hasApprovedFinished ? `/forge/api/art/${c.cardId}?v=approved&kind=finished` : null,
    versionNumber: c.versionNumber,
  }));
  // Only a card already in this list opens. Any other id is ignored, with nothing said about it.
  const { card } = await searchParams;
  const initialCardId = items.find((it) => it.cardId === card)?.cardId;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <ForgeBreadcrumbs items={[
        { label: "The Forge", href: "/forge" },
        { label: "Sets", href: ctx.role === "playtester" ? "/forge/play/sets" : "/forge/sets" },
        { label: set.name },
      ]} />
      <h1 className="text-xl font-semibold">{set.name}</h1>
      <p className="text-sm text-muted-foreground">Cards shared for playtesting</p>
      <RevealGrid items={items} currentUserId={ctx.user.id} initialCardId={initialCardId} />
    </div>
  );
}
