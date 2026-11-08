import Link from "next/link";
import { notFound } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listForgeDecks, listSharedForgeDecks } from "@/app/forge/lib/forgeDecks";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import DeckList from "./DeckList";

export const dynamic = "force-dynamic";

export default async function ForgeDecksPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const [decks, shared] = await Promise.all([listForgeDecks(), listSharedForgeDecks()]);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <ForgeBreadcrumbs items={[{ label: "The Forge", href: "/forge" }, { label: "Decks" }]} />
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>Decks</h1>
      <p className="mt-1 text-sm text-muted-foreground">Build with the cards shared with you, plus the full card pool.</p>

      <section>
        <h2 className="mt-6 text-lg font-medium">Your decks</h2>
        <DeckList decks={decks} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Shared with the Forge</h2>
        <p className="mt-1 text-sm text-muted-foreground">Decks other members have shared with everyone here.</p>
        {shared.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing shared yet. Share one of yours to get things going.</p>
        ) : (
          <ul className="mt-4 divide-y rounded-lg border">
            {shared.map((d) => (
              <li key={d.id}>
                <Link href={`/forge/play/decks/${d.id}/view`} className="flex items-center justify-between p-4 hover:bg-muted/50">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{d.name}</div>
                    <div className="text-sm text-muted-foreground">
                      by {d.ownerName} · {d.format} · {d.cardCount} card{d.cardCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <span className="ml-4 flex-shrink-0 text-sm text-muted-foreground">
                    {new Date(d.updatedAt).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
