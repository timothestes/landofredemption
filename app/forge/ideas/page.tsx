import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listForgeCards } from "@/app/forge/lib/cards";
import { listWritableSets } from "@/app/forge/lib/sets";
import IdeasLibrary from "./IdeasLibrary";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const ctx = await requireForge();
  if (!ctx) notFound();
  if (ctx.role === "playtester") redirect("/forge/play");
  const [cards, sets] = await Promise.all([listForgeCards(), listWritableSets()]);
  return <IdeasLibrary cards={cards} canCreate={ctx.role === "elder" || ctx.role === "superadmin"} sets={sets} />;
}
