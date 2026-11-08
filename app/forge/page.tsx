import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "./lib/auth";
import { listSets } from "./lib/sets";
import { LifecycleFlow } from "./components/LifecycleFlow";
import NewIdeaTile from "./components/NewIdeaTile";
import SharedSetList from "./play/sets/SharedSetList";

export const dynamic = "force-dynamic";

export default async function ForgeHomePage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const isPlaytester = ctx.role === "playtester";
  // RLS returns only the sets granted to the caller, and only their released cards to count.
  const sharedSets = isPlaytester ? await listSets() : [];

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>The Forge</h1>

      {isPlaytester ? (
        <>
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-medium">Sets shared with you</h2>
              {sharedSets.length > 0 && (
                <p className="text-sm text-muted-foreground">Open a set to read its cards and leave comments for the designers.</p>
              )}
            </div>
            <SharedSetList sets={sharedSets} />
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <Link href="/forge/play/decks/new" className="rounded-lg border p-3 hover:bg-muted/50 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20 [.jayden_&]:hover:border-primary/60">
              <div className="text-sm font-medium">Build a deck</div>
              <div className="text-xs text-muted-foreground">Mix the cards shared with you and the full pool.</div>
            </Link>
            <Link href="/forge/play" className="rounded-lg border p-3 hover:bg-muted/50 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20 [.jayden_&]:hover:border-primary/60">
              <div className="text-sm font-medium">Find a game</div>
              <div className="text-xs text-muted-foreground">Host or join a private playtest game.</div>
            </Link>
          </section>
        </>
      ) : (
        <>
          <LifecycleFlow />

          <section className="space-y-3">
            <NewIdeaTile />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Link href="/forge/import" className="rounded-lg border p-3 hover:bg-muted/50 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20 [.jayden_&]:hover:border-primary/60">
                <div className="text-sm font-medium">Import a set</div>
                <div className="text-xs text-muted-foreground">Bring in a Lackey zip, carddata.txt, or spreadsheet.</div>
              </Link>
              <Link href="/forge/sets" className="rounded-lg border p-3 hover:bg-muted/50 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20 [.jayden_&]:hover:border-primary/60">
                <div className="text-sm font-medium">New set</div>
                <div className="text-xs text-muted-foreground">Gather cards toward print.</div>
              </Link>
              <Link href="/forge/play/decks" className="rounded-lg border p-3 hover:bg-muted/50 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20 [.jayden_&]:hover:border-primary/60">
                <div className="text-sm font-medium">Build a deck</div>
                <div className="text-xs text-muted-foreground">Test new cards.</div>
              </Link>
              {(ctx.role === "superadmin" || ctx.role === "elder") && (
                <Link href="/forge/admin" className="rounded-lg border p-3 hover:bg-muted/50 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20 [.jayden_&]:hover:border-primary/60">
                  <div className="text-sm font-medium">Admin</div>
                  <div className="text-xs text-muted-foreground">Invites &amp; roles.</div>
                </Link>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
