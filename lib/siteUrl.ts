/**
 * Canonical origin for absolute URLs: metadataBase, the sitemap, canonical
 * links. NEXT_PUBLIC_SITE_URL wins so production pins the apex domain; after
 * that, Vercel's production hostname beats VERCEL_URL, which is the
 * per-deployment *.vercel.app host and must not leak into og:url or the
 * sitemap.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
