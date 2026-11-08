import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { DESIGNER_PAGE_LANDING } from "@/app/forge/lib/playtesterLanding";
import { getSet, listSetElders, listSetGrants } from "@/app/forge/lib/sets";
import SetPrivacyPanel from "./SetPrivacyPanel";
import SetEldersPanel from "./SetEldersPanel";
import PlaytesterGrants from "./PlaytesterGrants";
import TargetsEditor from "./TargetsEditor";

export const dynamic = "force-dynamic";

// Sharing, access and targets for a set. Split out of Progress (#382):
// designers could not find how to share a private set with another elder.
export default async function SetSettingsPage({ params }: { params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect(DESIGNER_PAGE_LANDING);
  const { setId } = await params;
  const set = await getSet(setId);
  if (!set) notFound(); // RLS hides sets the caller can't see -> 404
  const canEdit = ctx.role === "elder" || ctx.role === "superadmin";

  const elders = await listSetElders(setId);
  const isDesigner = ctx.role === "superadmin" || elders.some((e) => e.userId === ctx.user.id);
  let addable: { userId: string; displayName: string | null }[] = [];
  if (canEdit) {
    const { data: members } = await ctx.supabase.from("playtest_members").select("user_id, display_name, role").in("role", ["elder", "superadmin"]);
    const onSet = new Set(elders.map((e) => e.userId));
    addable = (members ?? []).filter((m: any) => !onSet.has(m.user_id)).map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null }));
  }

  let grants: Awaited<ReturnType<typeof listSetGrants>> = [];
  let grantablePlaytesters: { userId: string; displayName: string | null }[] = [];
  if (canEdit) {
    grants = await listSetGrants(setId);
    const { data: pts } = await ctx.supabase
      .from("playtest_members")
      .select("user_id, display_name, role")
      .eq("role", "playtester");
    const granted = new Set(grants.map((g) => g.userId));
    grantablePlaytesters = (pts ?? [])
      .filter((m: any) => !granted.has(m.user_id))
      .map((m: any) => ({ userId: m.user_id, displayName: m.display_name ?? null }));
  }

  return (
    <div className="space-y-4">
      {isDesigner && <SetPrivacyPanel setId={setId} isPrivate={set.isPrivate} />}
      {canEdit && <SetEldersPanel setId={setId} elders={elders} addable={addable} />}
      {canEdit && (
        <div className="rounded-md border p-3">
          <PlaytesterGrants setId={setId} grants={grants} grantable={grantablePlaytesters} />
        </div>
      )}
      {canEdit && (
        <div className="rounded-md border p-3 text-sm">
          <p className="mb-1 font-medium">Targets</p>
          <p className="mb-2 text-xs text-muted-foreground">How many cards of each type this set is aiming for. Drives the Progress breakdown.</p>
          <TargetsEditor setId={setId} initial={set.targetCounts} />
        </div>
      )}
    </div>
  );
}
