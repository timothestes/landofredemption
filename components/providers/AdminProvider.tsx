"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "../../utils/supabase/client";
import { getUserSafe } from "../../utils/supabase/getUserSafe";

interface AdminState {
  isAdmin: boolean;
  isSuperuser: boolean;
  permissions: string[];
  // Forge membership is independent of app-admin status (separate
  // playtest_members table). True when the caller has any Forge role.
  isForgeMember: boolean;
  loading: boolean;
}

const AdminContext = createContext<AdminState | null>(null);

export function AdminProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AdminState>({
    isAdmin: false,
    isSuperuser: false,
    permissions: [],
    isForgeMember: false,
    loading: true,
  });
  const supabase = useRef(createClient()).current;
  const pathname = usePathname();
  // Sentinel distinct from any real user id (string) or signed-out (null), so
  // the very first run always does the full check below.
  const lastCheckedUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const user = await getUserSafe(supabase);
        const userId = user?.id ?? null;

        // Sign-in/out here run as server actions that redirect (a soft
        // navigation), which never fires `onAuthStateChange` on this client's
        // own GoTrueClient instance — that only reacts to auth calls made
        // through itself. Without this, AdminProvider (mounted once in the
        // root layout, which persists across the redirect) keeps whatever
        // isAdmin it computed before the user signed in, and the Admin nav
        // button never appears until a hard reload remounts the provider.
        // Re-deriving on every route change catches the post-redirect
        // navigation; skipping when the identity hasn't changed keeps that
        // from re-running the full permission RPC batch on every click. The
        // ref is only updated once a check actually completes below, so a
        // transient failure here doesn't poison future skips.
        if (userId === lastCheckedUserId.current) return;

        if (!user) {
          lastCheckedUserId.current = userId;
          setState({ isAdmin: false, isSuperuser: false, permissions: [], isForgeMember: false, loading: false });
          return;
        }

        // Forge membership is checked regardless of app-admin status, since a
        // Forge member (e.g. a playtester) need not be an app admin. Run it
        // alongside the admin check so it adds no extra round-trip.
        const [{ data: forgeRole }, { data: isAdminData, error: adminError }] = await Promise.all([
          supabase.rpc("my_forge_role"),
          supabase.rpc("check_admin_role"),
        ]);
        const isForgeMember =
          forgeRole === "superadmin" || forgeRole === "elder" || forgeRole === "playtester";

        if (adminError || !isAdminData) {
          lastCheckedUserId.current = userId;
          setState({ isAdmin: false, isSuperuser: false, permissions: [], isForgeMember, loading: false });
          return;
        }

        const { data: permsData, error: permsError } = await supabase.rpc("get_my_admin_permissions");
        // An RPC error (e.g. migration not yet applied in this env) leaves
        // superData undefined → treated as false. Fail-closed.
        const { data: superData } = await supabase.rpc("is_superuser");

        lastCheckedUserId.current = userId;
        setState({
          isAdmin: true,
          isSuperuser: superData === true,
          permissions: permsError ? [] : (permsData || []),
          isForgeMember,
          loading: false,
        });
      } catch {
        setState({ isAdmin: false, isSuperuser: false, permissions: [], isForgeMember: false, loading: false });
      }
    };

    checkAdminStatus();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      checkAdminStatus();
    });

    return () => {
      subscription.unsubscribe();
    };
    // pathname is intentionally a dependency: it's what re-triggers the check
    // after a post-sign-in/sign-out redirect (see comment above).
  }, [supabase, pathname]);

  return <AdminContext.Provider value={state}>{children}</AdminContext.Provider>;
}

export function useAdminContext(): AdminState {
  const ctx = useContext(AdminContext);
  if (!ctx) {
    // Rendered outside AdminProvider — treat as non-admin but not loading so
    // UI doesn't hang. This shouldn't happen in normal app flow.
    return { isAdmin: false, isSuperuser: false, permissions: [], isForgeMember: false, loading: false };
  }
  return ctx;
}
