import Link from "next/link";
import type { ForgeSetSummary } from "@/app/forge/lib/sets";

export default function SharedSetList({ sets }: { sets: ForgeSetSummary[] }) {
  if (sets.length === 0) {
    return <p className="text-sm text-muted-foreground">No sets have been shared with you yet.</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {sets.map((s) => (
        <li key={s.id}>
          <Link href={`/forge/play/${s.id}`} className="block rounded-lg border p-4 hover:bg-muted/50">
            <div className="font-medium">{s.name}</div>
            <div className="text-sm text-muted-foreground">{s.total} card{s.total === 1 ? "" : "s"}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
