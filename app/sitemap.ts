import type { MetadataRoute } from "next";
import { createAnonClient } from "@/utils/supabase/anon";
import { fetchAllRows } from "@/utils/supabase/fetchAllRows";
import { getSupabaseAdmin } from "@/lib/pricing/supabase-admin";
import { getSiteUrl } from "@/lib/siteUrl";

const baseUrl = getSiteUrl();

// Cookie-free (createAnonClient), so this can be prerendered and revalidated
// instead of re-querying every post and deck on each crawler fetch.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createAnonClient();

  // Static public routes. The deck builder (/decklist/card-search) is an app,
  // not content, and robots.txt disallows it, so it is deliberately absent.
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/decklist`,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/decklist/community`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/rulings`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/resources`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/sponsors`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/coffee`,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/spoilers`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/tournaments`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/tournaments/results`,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/tournaments/metagame`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/tournaments/history`,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/tournaments/rnrs-points`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/register`,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/play`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/goldfish`,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/articles`,
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];

  // Dynamic routes: public community decks (unlisted decks are excluded)
  const { data: decks } = await supabase
    .from("decks")
    .select("id, updated_at")
    .eq("visibility", "public")
    .order("updated_at", { ascending: false })
    .limit(1000);

  const deckRoutes: MetadataRoute.Sitemap = (decks ?? []).map((deck) => ({
    url: `${baseUrl}/decklist/${deck.id}`,
    lastModified: deck.updated_at,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  // Dynamic routes: public spoiler cards. /spoilers/[id] is keyed by
  // spoilers.id (the old spoiler_sets.id entries all 404ed). Anon RLS already
  // limits this to visible cards whose spoil_date has passed.
  const spoilers = await fetchAllRows<{ id: string; spoil_date: string }>(
    (from, to) =>
      supabase
        .from("spoilers")
        .select("id, spoil_date")
        .order("spoil_date", { ascending: false })
        .order("id")
        .range(from, to),
  );

  const spoilerRoutes: MetadataRoute.Sitemap = spoilers.map((spoiler) => ({
    url: `${baseUrl}/spoilers/${spoiler.id}`,
    lastModified: spoiler.spoil_date,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  // Dynamic routes: published tournament results. `tournaments` has no
  // anon-readable policy (hosts only), so like loadPublicResultsIndexAction
  // this uses the service-role client, filtered to results_published = true,
  // and reads nothing beyond ids and timestamps.
  const admin = getSupabaseAdmin();
  const tournaments = await fetchAllRows<{
    id: string;
    updated_at: string | null;
    ended_at: string | null;
  }>((from, to) =>
    admin
      .from("tournaments")
      .select("id, updated_at, ended_at")
      .eq("results_published", true)
      .order("ended_at", { ascending: false, nullsFirst: false })
      .order("id")
      .range(from, to),
  );

  const resultRoutes: MetadataRoute.Sitemap = tournaments.map((t) => ({
    url: `${baseUrl}/tournaments/results/${t.id}`,
    lastModified: t.updated_at ?? t.ended_at ?? undefined,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  // Dynamic routes: published articles (the imported WordPress archive + new posts)
  const posts = await fetchAllRows<{
    slug: string;
    published_at: string | null;
    updated_at: string | null;
  }>((from, to) =>
    supabase
      .from("posts")
      .select("slug, published_at, updated_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .range(from, to),
  );

  const articleRoutes: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/articles/${post.slug}`,
    lastModified: post.updated_at ?? post.published_at ?? undefined,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [
    ...staticRoutes,
    ...deckRoutes,
    ...spoilerRoutes,
    ...resultRoutes,
    ...articleRoutes,
  ];
}
