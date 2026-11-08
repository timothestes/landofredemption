import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { DESIGNER_PAGE_LANDING } from "@/app/forge/lib/playtesterLanding";
import { listSets } from "@/app/forge/lib/sets";
import SetsIndex from "./SetsIndex";

export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect(DESIGNER_PAGE_LANDING);
  const sets = await listSets();
  return <SetsIndex sets={sets} canCreate={ctx.role === "elder" || ctx.role === "superadmin"} />;
}
