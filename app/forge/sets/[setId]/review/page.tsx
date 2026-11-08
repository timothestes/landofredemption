import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { DESIGNER_PAGE_LANDING } from "@/app/forge/lib/playtesterLanding";
import { getSet } from "@/app/forge/lib/sets";
import { getSetReviewQueue } from "@/app/forge/lib/review";
import ReviewQueue from "./ReviewQueue";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect(DESIGNER_PAGE_LANDING);
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound(); // RLS hides sets the caller can't see → 404
  const { cards, items } = await getSetReviewQueue(setId);
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Review queue</h2>
      <ReviewQueue setId={setId} cards={cards} items={items} />
    </div>
  );
}
