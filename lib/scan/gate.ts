// Server-only: do not import from "use client" files.
import type { createClient } from "@/utils/supabase/server";

export interface GateDeps {
  isSuperuser: () => Promise<boolean>;
  env?: NodeJS.ProcessEnv;
}

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Who may use the card scanner: the superuser, anyone listed in
 * SCANNER_ALLOWLIST, or every signed-in user when SCANNER_OPEN is '1'.
 * isSuperuser is only awaited when the env checks do not already grant access.
 */
export async function canScan(userId: string, deps: GateDeps): Promise<boolean> {
  const env = deps.env ?? process.env;
  if (env.SCANNER_OPEN === "1") return true;
  if (parseAllowlist(env.SCANNER_ALLOWLIST).includes(userId)) return true;
  return deps.isSuperuser();
}

/**
 * Resolves the signed-in user and whether the scanner gate admits them.
 * is_superuser is called only once a user is confirmed; an RPC error counts
 * as not-superuser.
 */
export async function canScanForSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ user: { id: string } | null; allowed: boolean }> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { user: null, allowed: false };

  const allowed = await canScan(user.id, {
    isSuperuser: async () => {
      const { data, error: rpcError } = await supabase.rpc("is_superuser");
      return !rpcError && data === true;
    },
  });
  return { user: { id: user.id }, allowed };
}
