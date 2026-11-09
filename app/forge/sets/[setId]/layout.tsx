import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { DESIGNER_PAGE_LANDING } from "@/app/forge/lib/playtesterLanding";
import { getSet, canDesignSet } from "@/app/forge/lib/sets";
import ForgeBreadcrumbs from "@/app/forge/components/ForgeBreadcrumbs";
import PrivateBadge from "@/app/forge/components/PrivateBadge";
import SetTabs from "./SetTabs";
import SetRealtime from "./SetRealtime";
import SetNameHeader from "./SetNameHeader";

export const dynamic = "force-dynamic";

export default async function SetLayout({ children, params }: { children: React.ReactNode; params: Promise<{ setId: string }> }) {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect(DESIGNER_PAGE_LANDING);
  const { setId } = await params;
  const [set, canRename] = await Promise.all([getSet(setId), canDesignSet(setId)]);
  if (!set) notFound(); // RLS hides sets the caller can't see → 404
  return (
    <div className="mx-auto max-w-6xl p-4">
      <div className="mb-4">
        {/* From sm up. On a phone the Forge tabs sit right above it and the title just below. */}
        <ForgeBreadcrumbs className="max-sm:hidden" items={[
          { label: "The Forge", href: "/forge" },
          { label: "Sets", href: "/forge/sets" },
          { label: set.name },
        ]} />
        <div className="flex items-center gap-2">
          <SetNameHeader setId={setId} name={set.name} canRename={canRename} />
          {set.isPrivate && <PrivateBadge />}
          {set.status === "released" && (
            <span className="rounded-full border border-emerald-600/40 bg-emerald-600/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Released
            </span>
          )}
        </div>
        <SetTabs setId={setId} showPromote={ctx.role === "superadmin"} />
      </div>
      <SetRealtime setId={setId} />
      {children}
    </div>
  );
}
