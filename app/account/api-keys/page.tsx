import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { ApiKeysClient, type ApiKeyRow } from "./client";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const { data } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const keys: ApiKeyRow[] = (data ?? []).map((k: any) => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.key_prefix,
    createdAt: k.created_at,
    lastUsedAt: k.last_used_at,
    revokedAt: k.revoked_at,
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-2 font-cinzel text-3xl font-bold tracking-tight">API Keys</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Generate keys to access the public deck API. The full key is shown once at creation —
        copy it immediately.
      </p>
      <ApiKeysClient initialKeys={keys} />
    </div>
  );
}
