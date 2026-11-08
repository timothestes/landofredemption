import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "@/app/forge/lib/auth";
import { listSets } from "@/app/forge/lib/sets";

export const dynamic = "force-dynamic";

export default async function ForgePlaySetsPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  // RLS returns only sets the caller may see — for a playtester, exactly their granted sets.
  const sets = await listSets();

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>Playtest</h1>
      <h2 className="mt-6 text-sm font-medium">Sets shared with you</h2>
      {sets.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No sets have been shared with you yet.</p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {sets.map((s) => (
            <li key={s.id}>
              <Link href={`/forge/play/${s.id}`} className="block rounded-lg border p-4 hover:bg-muted/50">
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-muted-foreground">{s.total} card{s.total === 1 ? "" : "s"}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
