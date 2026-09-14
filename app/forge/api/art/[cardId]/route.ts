import { createClient } from "@/utils/supabase/server";
import { notFoundResponse } from "@/app/forge/lib/auth";
import { readForgeArt } from "@/app/forge/lib/art";
import { isCurrentRenderToken, renderedCacheKey } from "@/app/forge/lib/renderVersion";

export const dynamic = "force-dynamic";

const IMMUTABLE = "private, max-age=31536000, immutable";
const NO_STORE = "private, no-store";
const MEMBER_ROLES = new Set(["superadmin", "elder", "playtester"]);
type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ cardId: string }> }
): Promise<Response> {
  const supabase = await createClient();
  const { cardId } = await params;
  const url = new URL(req.url);
  if (url.searchParams.get("kind") === "rendered") return renderedCard(supabase, cardId, url);
  const wantApproved = url.searchParams.get("v") === "approved";
  const kind = url.searchParams.get("kind") === "finished" ? "finished" : "art";
  const candidateId = url.searchParams.get("candidate");

  // One RPC does the member gate + version resolution + key lookup (SECURITY
  // INVOKER so the 057 RLS policies still decide what the caller may see —
  // migration 066). getUser() runs concurrently, not before: it validates and
  // refreshes the session cookie, while an expired/invalid token makes the RPC
  // itself return nothing. Either failure is a 404 — the area stays secret.
  // `candidate` swaps in the designer-gallery lookup (082): same 404-on-anything.
  const [{ data: userData, error: userError }, { data: artKey }] = await Promise.all([
    supabase.auth.getUser(),
    candidateId
      ? supabase.rpc("forge_candidate_art_key", { p_card_id: cardId, p_candidate_id: candidateId })
      : supabase.rpc("forge_art_key", {
          p_card_id: cardId,
          p_approved: wantApproved,
          p_kind: kind,
        }),
  ]);
  if (userError || !userData?.user) return notFoundResponse();
  if (!artKey || typeof artKey !== "string") return notFoundResponse();

  let result;
  try {
    result = await readForgeArt(artKey);
  } catch {
    return notFoundResponse();
  }
  if (!result || result.statusCode !== 200) return notFoundResponse();

  const download = url.searchParams.get("download") === "1";
  if (download) {
    try {
      await supabase.rpc("forge_log_art_download", { p_card_id: cardId });
    } catch {
      // best-effort audit; never block the download on a logging failure
    }
  }

  // `t` is a cache-buster (forge_cards.updated_at for the working view; the frozen
  // versionId in play mode), so a `t`-stamped response can be cached by the member's OWN
  // browser indefinitely. `private` forbids shared/CDN caches; auth + RLS are unchanged.
  const cacheable = !download && url.searchParams.get("t") !== null;
  const headers = new Headers({
    "Content-Type": result.blob.contentType,
    "Cache-Control": cacheable ? "private, max-age=31536000, immutable" : "private, no-store",
  });
  if (download) {
    headers.set("Content-Disposition", `attachment; filename="card-${encodeURIComponent(cardId)}"`);
  }
  return new Response(result.stream, { headers });
}

// kind=rendered: the card the server renderer draws for a released version with no uploaded
// finished image (docs/superpowers/specs/2026-09-13-forge-rendered-play-cards-design.md, Unit 5).
// RLS alone is NOT a gate here: it doesn't check membership, so a removed member's live session
// still passes the owner / granted-set policies. my_forge_role() is the member gate
// forge_art_key (066) runs; it runs in parallel with the lookup, so it adds no round trip.
async function renderedCard(supabase: Supabase, cardId: string, url: URL): Promise<Response> {
  if (url.searchParams.get("v") !== "approved" || url.searchParams.get("download") === "1") {
    return notFoundResponse();
  }
  const [{ data: userData, error: userError }, { data: role }, { data: card }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("my_forge_role"),
    supabase
      .from("forge_cards")
      .select("approved:card_versions!fk_approved(id), published:card_versions!fk_published(id)")
      .eq("id", cardId)
      .maybeSingle(),
  ]);
  if (userError || !userData?.user) return notFoundResponse();
  if (typeof role !== "string" || !MEMBER_ROLES.has(role)) return notFoundResponse();
  // The embedded version rows only come back when RLS lets the caller see them.
  // supabase-js infers these composite-FK embeds (card_versions!fk_approved / !fk_published) as
  // to-many (arrays), but PostgREST's live response is an object or null, never an array (probed
  // 2026-09-13 against a real card) — hence the `unknown` hop instead of a direct cast.
  const refs = card as unknown as { approved?: { id: string } | null; published?: { id: string } | null } | null;
  const versionId = refs?.approved?.id ?? refs?.published?.id;
  if (!versionId) return notFoundResponse();

  const cacheKey = renderedCacheKey(versionId);
  // Immutable only when the URL names this deploy's renderer: a client and server on different
  // RENDER_VERSIONs mid-deploy must not pin the other one's render for a year.
  const immutable = isCurrentRenderToken(url.searchParams.get("t"));

  let cached;
  try {
    cached = await readForgeArt(cacheKey);
  } catch {
    return notFoundResponse(); // Blob outage: transient, nothing remembered
  }
  if (cached && cached.statusCode === 200) {
    return new Response(cached.stream, {
      headers: { "Content-Type": cached.blob.contentType, "Cache-Control": immutable ? IMMUTABLE : NO_STORE },
    });
  }

  const { data: version } = await supabase
    .from("card_versions")
    .select("data, art_key, created_at")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) return notFoundResponse();

  const { renderAndStore } = await import("@/app/forge/lib/renderedCard");
  const out = await renderAndStore({
    cacheKey,
    cardId,
    versionId,
    data: version.data ?? {},
    artKey: version.art_key ?? null,
    year: new Date(version.created_at).getUTCFullYear(),
  });
  if (!out) return notFoundResponse();
  return new Response(new Uint8Array(out.jpeg), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": immutable && !out.degraded ? IMMUTABLE : NO_STORE },
  });
}
