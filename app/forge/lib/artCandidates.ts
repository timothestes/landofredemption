"use server";

import { revalidatePath } from "next/cache";
import { requireElder } from "@/app/forge/lib/auth";
import { validateArtFile, uploadForgeArt, uploadForgeArtRaw, readForgeArt, readForgeUpload, deleteForgeArt } from "@/app/forge/lib/art";
import { clampCropRect, cropCardImage } from "@/app/forge/lib/imageCrop";
import { refusalOr } from "@/app/forge/lib/rpcRefusal";
import type { CropRect } from "@/app/forge/lib/cropPreview";

// Candidate ids/timestamps only — blob keys never leave the server; the client
// renders images through /forge/api/art/[cardId]?candidate=<id>.
export type ArtCandidate = { id: string; createdAt: string; isActiveSource: boolean; sourceUrl: string | null };

export async function listArtCandidates(cardId: string): Promise<ArtCandidate[]> {
  const ctx = await requireElder();
  if (!ctx) return [];
  const [{ data: rows }, { data: card }] = await Promise.all([
    ctx.supabase
      .from("forge_card_art_candidates")
      .select("id, key, created_at, source_url")
      .eq("card_id", cardId)
      .order("created_at", { ascending: true }),
    ctx.supabase
      .from("forge_cards")
      .select("working_art_key, working_art_original_key")
      .eq("id", cardId)
      .maybeSingle(),
  ]);
  const activeKey = card?.working_art_key ? card.working_art_original_key : null;
  return (rows ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    isActiveSource: !!activeKey && r.key === activeKey,
    sourceUrl: r.source_url ?? null,
  }));
}

export async function addArtCandidate(
  cardId: string,
  pathname: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  if (!pathname.startsWith("forge-art-raw/")) return { ok: false, error: "Invalid upload" };

  const raw = await readForgeUpload(pathname);
  if (!raw) return { ok: false, error: "Could not read uploaded image" };
  const invalid = validateArtFile({ type: raw.contentType, size: raw.data.length, name: pathname });
  if (invalid) {
    await deleteForgeArt(pathname);
    return { ok: false, error: invalid };
  }

  let key: string;
  try {
    key = await uploadForgeArt(raw.data);
  } catch {
    await deleteForgeArt(pathname);
    return { ok: false, error: "Could not read image file." };
  }
  await deleteForgeArt(pathname);
  const { error } = await ctx.supabase.rpc("forge_add_art_candidate", {
    p_card_id: cardId,
    p_key: key,
  });
  if (error) {
    return { ok: false, error: /limit/i.test(error.message) ? "Limit of 12 images per card." : "Could not save image" };
  }

  // First image on an art-less card becomes the artwork uncropped, preserving
  // the old one-step upload flow.
  const { data: card } = await ctx.supabase
    .from("forge_cards")
    .select("working_art_key")
    .eq("id", cardId)
    .maybeSingle();
  let activateError: { message: string } | null = null;
  if (card && !card.working_art_key) {
    const { error: setArtError } = await ctx.supabase.rpc("forge_set_working_art", {
      p_card_id: cardId,
      p_key: key,
      p_original_key: key,
    });
    activateError = setArtError;
  }
  revalidatePath(`/forge/cards/${cardId}`);
  revalidatePath("/forge/ideas");
  if (activateError) return { ok: false, error: "Image saved but could not be set as artwork" };
  return { ok: true };
}

export async function deleteArtCandidate(
  cardId: string,
  candidateId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const { error } = await ctx.supabase.rpc("forge_delete_art_candidate", { p_candidate_id: candidateId });
  if (error) {
    return { ok: false, error: /source of the current artwork/i.test(error.message) ? "This image is the source of the current artwork." : refusalOr(error, "Could not delete image") };
  }
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

export async function setArtCandidateSource(
  cardId: string,
  candidateId: string,
  sourceUrl: string | null
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const trimmed = sourceUrl?.trim() || null;
  if (trimmed) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false, error: "Enter a valid URL (starting with http:// or https://)" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "Enter a valid URL (starting with http:// or https://)" };
    }
  }
  const { error } = await ctx.supabase.rpc("forge_set_art_candidate_source", {
    p_candidate_id: candidateId,
    p_source_url: trimmed,
  });
  if (error) return { ok: false, error: "Could not save link" };
  revalidatePath(`/forge/cards/${cardId}`);
  return { ok: true };
}

async function candidateKey(
  ctx: NonNullable<Awaited<ReturnType<typeof requireElder>>>,
  cardId: string,
  candidateId: string
): Promise<string | null> {
  const { data } = await ctx.supabase
    .from("forge_card_art_candidates")
    .select("key")
    .eq("id", candidateId)
    .eq("card_id", cardId)
    .maybeSingle();
  return data?.key ?? null;
}

export async function activateCandidate(
  cardId: string,
  candidateId: string
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const key = await candidateKey(ctx, cardId, candidateId);
  if (!key) return { ok: false, error: "Image not found" };
  const { error } = await ctx.supabase.rpc("forge_set_working_art", {
    p_card_id: cardId,
    p_key: key,
    p_original_key: key,
  });
  if (error) return { ok: false, error: refusalOr(error, "Could not set artwork") };
  revalidatePath(`/forge/cards/${cardId}`);
  revalidatePath("/forge/ideas");
  return { ok: true };
}

export async function applyCrop(
  cardId: string,
  candidateId: string,
  rect: CropRect
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireElder();
  if (!ctx) return { ok: false, error: "Not authorized" };
  const clamped = clampCropRect(rect);
  if (!clamped) return { ok: false, error: "Invalid crop" };
  const key = await candidateKey(ctx, cardId, candidateId);
  if (!key) return { ok: false, error: "Image not found" };

  let input: Buffer;
  try {
    const blob = await readForgeArt(key);
    if (!blob || blob.statusCode !== 200) return { ok: false, error: "Could not read image" };
    input = Buffer.from(await new Response(blob.stream).arrayBuffer());
  } catch {
    return { ok: false, error: "Could not read image" };
  }

  let croppedKey: string;
  try {
    const cropped = await cropCardImage(input, clamped);
    croppedKey = await uploadForgeArtRaw(cropped.data, cropped.contentType);
  } catch (e) {
    return { ok: false, error: e instanceof Error && /too small/i.test(e.message) ? "Crop is too small." : "Could not crop image" };
  }

  const { error } = await ctx.supabase.rpc("forge_set_working_art", {
    p_card_id: cardId,
    p_key: croppedKey,
    p_original_key: key,
  });
  if (error) return { ok: false, error: refusalOr(error, "Could not save artwork") };
  revalidatePath(`/forge/cards/${cardId}`);
  revalidatePath("/forge/ideas");
  return { ok: true };
}
