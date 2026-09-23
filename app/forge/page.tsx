import { notFound } from "next/navigation";
import Link from "next/link";
import { requireForge } from "./lib/auth";
import { LifecycleFlow } from "./components/LifecycleFlow";

export const dynamic = "force-dynamic";

export default async function ForgeHomePage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  const isPlaytester = ctx.role === "playtester";

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>The Forge</h1>

      {isPlaytester ? (
        <section className="space-y-3">
          <Link href="/forge/play/decks" className="block rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:bg-muted/50 hover:shadow [.jayden_&]:bg-gradient-to-br [.jayden_&]:from-[hsla(0,80%,25%,0.15)] [.jayden_&]:via-[hsla(270,60%,20%,0.1)] [.jayden_&]:to-[hsla(230,80%,30%,0.15)] [.jayden_&]:border-primary/30">
            <div className="font-medium">Build a deck</div>
            <div className="text-sm text-muted-foreground">Mix the cards shared with you and the full pool.</div>
          </Link>
          <Link href="/forge/play" className="block rounded-lg border p-3 hover:bg-muted/50 [.jayden_&]:bg-card/80 [.jayden_&]:backdrop-blur-sm [.jayden_&]:border-primary/20 [.jayden_&]:hover:border-primary/60">
            <div className="text-sm font-medium">Find a game</div>
            <div className="text-xs text-muted-foreground">Host or join a private playtest game.</div>
          </Link>
        </section>
      ) : (
        <>
          <LifecycleFlow />

          <section className="space-y-3">
            <Link href="/forge/ideas" className="block rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:bg-muted/50 hover:shadow [.jayden_&]:bg-gradient-to-br [.jayden_&]:from-[hsla(0,80%,25%,0.15)] [.jayden_&]:via-[hsla(270,60%,20%,0.1)] [.jayden_&]:to-[hsla(230,80%,30%,0.15)] [.jayden_&]:border-primary/30">
              <div className="font-medium">New idea</div>
              <div className="text-sm text-muted-foreground">Sketch a card in your private ideas.</div>
            </Link>
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
    </main>
  );
}
