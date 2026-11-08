import { notFound } from "next/navigation";
import { requireElder } from "@/app/forge/lib/auth";
import { getMissiveDirectory, listRecentMissives } from "@/app/forge/lib/missives";
import AnnouncementComposer from "./AnnouncementComposer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Sequential sends + 600ms spacing for up to 100 recipients can exceed the default
// function timeout (Next.js applies the page's segment config to server actions invoked from it).
export const maxDuration = 300;

export default async function ForgeAnnouncementsPage() {
  const ctx = await requireElder();
  if (!ctx) notFound();
  const [{ members, sets }, recent] = await Promise.all([getMissiveDirectory(), listRecentMissives()]);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Announcements
      </h1>
      <AnnouncementComposer members={members} sets={sets} recent={recent} callerId={ctx.user.id} />
    </div>
  );
}
