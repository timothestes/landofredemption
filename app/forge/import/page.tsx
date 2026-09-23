import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { listSets } from "@/app/forge/lib/sets";
import ImportWizard from "./ImportWizard";

export const metadata = { title: "Import a set — The Forge" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function ForgeImportPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireForge();
  if (!ctx) notFound(); // non-members must not learn this exists
  if (ctx.role === "playtester") redirect("/forge/play");
  // ?set=<id> — arriving from a set's cards page preselects "add to that set".
  const [sets, { set }] = await Promise.all([listSets(), searchParams]);
  return <ImportWizard sets={sets} initialSetId={typeof set === "string" ? set : undefined} />;
}
