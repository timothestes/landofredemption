import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import TopNav from "@/components/top-nav";
import { getPendingEvent, getPublicRoundView } from "./actions";
import LiveRoundClient from "./LiveRoundClient";

// Pairings change every few minutes; never serve a cached round.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ code: string }>;
}

// generateMetadata and the page both need the same lookup; `cache` dedupes it
// within one request.
const load = cache(async (code: string) => {
  const res = await getPublicRoundView(code);
  const view = res.ok ? res.view : null;
  if (view) return { view, pending: null };
  return { view: null, pending: await getPendingEvent(code) };
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params;
  const { view, pending } = await load(code);
  const name = view?.tournament.name ?? pending?.name;
  return {
    title: name ? `${name} – Live` : "Live pairings",
    // Ephemeral event page — nothing here should be indexed.
    robots: { index: false, follow: false },
  };
}

export default async function LiveRoundPage({ params }: PageProps) {
  const { code } = await params;
  const { view, pending } = await load(code);

  if (!view && !pending) notFound();

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <LiveRoundClient code={code} initialView={view} pendingName={pending?.name ?? null} />
    </div>
  );
}
