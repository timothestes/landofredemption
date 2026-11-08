import { notFound } from "next/navigation";
import { requireElder } from "@/app/forge/lib/auth";
import { listMembers, listInvites } from "@/app/forge/lib/members";
import { listSets, listAllSetGrants } from "@/app/forge/lib/sets";
import AdminConsole from "./AdminConsole";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ForgeAdminPage() {
  const ctx = await requireElder();
  if (!ctx) notFound();
  const [members, invites, sets, grants] = await Promise.all([
    listMembers(),
    listInvites(),
    listSets(),
    listAllSetGrants(),
  ]);
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl" style={{ fontFamily: "Cinzel, serif" }}>
        Forge Members
      </h1>
      <AdminConsole
        callerRole={ctx.role}
        members={members}
        invites={invites}
        sets={sets.map((s) => ({ id: s.id, name: s.name }))}
        grants={grants}
      />
    </div>
  );
}
