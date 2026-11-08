import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { DESIGNER_PAGE_LANDING } from "@/app/forge/lib/playtesterLanding";
import { getSet, listSetCards } from "@/app/forge/lib/sets";
import { listSetApprovedArt } from "@/app/forge/lib/setArtwork";
import { computeProgress } from "@/app/forge/lib/progress";
import ProgressDashboard from "./ProgressDashboard";

export const dynamic = "force-dynamic";

export default async function SetProgressPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect(DESIGNER_PAGE_LANDING);
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound();
  const cards = await listSetCards(setId);
  const model = computeProgress(cards.map((c) => ({ snapshot: c.snapshot, status: c.status })), set.targetCounts);
  // Server-side boolean only — the art list carries blob keys and must not reach the client.
  const hasApprovedArt = (await listSetApprovedArt(setId)).length > 0;

  return <ProgressDashboard setId={setId} model={model} hasApprovedArt={hasApprovedArt} />;
}
