import { Metadata } from "next";
import Link from "next/link";
import { createClient } from "../../utils/supabase/server";
import { canScan as canScanGate } from "../../lib/scan/gate";
import CollectionClient from "./client";
import { justAddedKeys } from "./justAdded";

export const metadata: Metadata = {
  title: "My Collection",
  description: "Track which Redemption cards you own",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ format?: string | string[]; added?: string | string[] }>;
}) {
  const params = await searchParams;
  const format = Array.isArray(params.format) ? params.format[0] : params.format;
  const added = Array.isArray(params.added) ? params.added.join(",") : params.added;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="w-full max-w-2xl mx-auto px-4 py-16 text-center">
        <svg
          className="mx-auto h-20 w-20 text-muted-foreground mb-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
        <h1 className="font-cinzel text-3xl font-bold tracking-tight mb-3">My Collection</h1>
        <p className="text-muted-foreground text-lg mb-6">
          Sign in to track which cards you own, see set completion, and skip
          cards you already have when buying decks.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/sign-in?redirectTo=/collection"
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="px-6 py-3 border border-border rounded-lg font-medium hover:bg-muted transition-colors"
          >
            Create an account
          </Link>
        </div>
      </div>
    );
  }

  const ids = added
    ? added.split(",").filter((id) => UUID_RE.test(id)).slice(0, 150)
    : [];

  const [canScan, scanRows] = await Promise.all([
    canScanGate(user.id, {
      isSuperuser: async () => {
        const { data, error } = await supabase.rpc("is_superuser");
        return !error && data === true;
      },
    }),
    // User client: RLS limits this to the viewer's own scan events.
    ids.length > 0
      ? supabase.from("scan_events").select("id, outcomes").in("id", ids)
      : Promise.resolve({ data: null }),
  ]);

  // Order by the scan ids' order in the URL.
  const order = new Map(ids.map((id, i) => [id, i]));
  const rows = [...(scanRows.data ?? [])].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );
  const addedKeys = justAddedKeys(rows.flatMap((row) => (Array.isArray(row.outcomes) ? row.outcomes : [])));

  return <CollectionClient canScan={canScan} initialFormat={format} justAddedKeys={addedKeys} />;
}
