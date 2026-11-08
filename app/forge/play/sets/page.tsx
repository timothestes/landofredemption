import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listSets } from "@/app/forge/lib/sets";
import { designerPageNote } from "@/app/forge/lib/playtesterLanding";
import SharedSetList from "./SharedSetList";

export const dynamic = "force-dynamic";

export default async function ForgePlaySetsPage({ searchParams }: { searchParams: Promise<{ from?: string | string[] }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  // RLS returns only sets the caller may see — for a playtester, exactly their granted sets.
  const sets = await listSets();
  const note = designerPageNote((await searchParams).from);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>Playtest</h1>
      {note && <p role="status" className="mt-4 rounded-md border bg-muted px-3 py-2 text-sm">{note}</p>}
      <h2 className="mt-6 text-sm font-medium">Sets shared with you</h2>
      <div className="mt-3">
        <SharedSetList sets={sets} />
      </div>
    </div>
  );
}
