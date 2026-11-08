import { notFound, redirect } from "next/navigation";
import { requireForge } from "@/app/forge/lib/auth";
import { DESIGNER_PAGE_LANDING } from "@/app/forge/lib/playtesterLanding";
import { listWritableSets } from "@/app/forge/lib/sets";
import ImportWizard from "./ImportWizard";

export const metadata = { title: "Import a set — The Forge" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function ForgeImportPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireForge();
  if (!ctx) notFound(); // non-members must not learn this exists
  if (ctx.role === "playtester") redirect(DESIGNER_PAGE_LANDING);
  // ?set=<id> — arriving from a set's cards page preselects "add to that set".
  const [sets, { set }] = await Promise.all([listWritableSets(), searchParams]);
  return <ImportWizard sets={sets} initialSetId={typeof set === "string" ? set : undefined} />;
}
