// Server-only helpers for Forge private card art.
// DO NOT import this module into a "use client" component — it uses
// server-only credentials and a PRIVATE-access Vercel Blob store. Art is uploaded with
// access:'private' under unguessable UUID keys and read back server-side; the
// browser only ever sees the /forge/api/art proxy URL.
//
// IMPORTANT: `access: 'private'` requires a store CONFIGURED for private access.
// Art lives in a dedicated private store (FORGE_BLOB_STORE_ID), isolated from the
// app's public card-image store. See `forgeAuth` below for how requests authenticate.
import { randomUUID } from "crypto";
import { put, get, del, type GetBlobResult } from "@vercel/blob";
import { normalizeCardImage } from "@/app/forge/lib/imageNormalize";

/**
 * Auth for the PRIVATE Forge store. Production uses Vercel OIDC (no static secret):
 * the SDK reads VERCEL_OIDC_TOKEN automatically and pairs it with the store id. Local
 * dev sets FORGE_BLOB_READ_WRITE_TOKEN (OIDC isn't enabled for the dev environment),
 * which the SDK prefers when present — so prod stays on OIDC as long as that var is
 * left unset there.
 */
const forgeAuth: { token: string } | { storeId: string } =
  process.env.FORGE_BLOB_READ_WRITE_TOKEN
    ? { token: process.env.FORGE_BLOB_READ_WRITE_TOKEN }
    : { storeId: process.env.FORGE_BLOB_STORE_ID! };

const ART_PREFIX = "forge-art/";
const FINISHED_PREFIX = "forge-finished/";
const RENDERED_PREFIX = "forge-rendered/";
export const ALLOWED_ART_TYPES = ["image/jpeg", "image/png", "image/webp", "image/tiff", "image/tif"] as const;
export const MAX_ART_BYTES = 50 * 1024 * 1024; // 50MB — was 15MB; raised because uploads now go
// straight to Blob from the browser, bypassing Vercel's 4.5MB Function body cap that made the
// old 15MB figure unreachable in practice for anything routed through a Server Action.
const MAX_ART_MB = MAX_ART_BYTES / (1024 * 1024);

const TIFF_NAME_RE = /\.tiff?$/i;
// Browsers frequently report an empty (or generic) MIME type for .tif/.tiff files
// rather than "image/tiff" — fall back to the extension ONLY for those generic types,
// and ONLY for TIFF; jpeg/png/webp still require a correct MIME type.
const GENERIC_MIME_TYPES = new Set(["", "application/octet-stream"]);

function isTiffByExtension(file: { type: string; name?: string }): boolean {
  return !!file.name && GENERIC_MIME_TYPES.has(file.type) && TIFF_NAME_RE.test(file.name);
}

/** Returns an error string if the file is unacceptable, or null if valid. Pure. */
export function validateArtFile(file: { type: string; size: number; name?: string }): string | null {
  const isTiff = file.type === "image/tiff" || file.type === "image/tif" || isTiffByExtension(file);
  if (!isTiff && !ALLOWED_ART_TYPES.includes(file.type as (typeof ALLOWED_ART_TYPES)[number])) {
    return "Invalid file type. Accepted: JPEG, PNG, WebP, TIFF.";
  }
  if (file.size > MAX_ART_BYTES) {
    return isTiff
      ? `TIFF file too large. Export at ${MAX_ART_MB}MB or smaller.`
      : `File too large. Maximum ${MAX_ART_MB}MB.`;
  }
  return null;
}

/**
 * Normalize (trim white print-bleed margins, cap 1050px tall, re-encode JPEG)
 * and upload to the PRIVATE blob store under an unguessable UUID key.
 * Throws if the file cannot be decoded as an image. Returns the stored pathname.
 */
export async function uploadForgeArt(input: Buffer): Promise<string> {
  const normalized = await normalizeCardImage(input);
  const key = `${ART_PREFIX}${randomUUID()}`;
  const blob = await put(key, normalized.data, {
    access: "private",
    addRandomSuffix: false,
    ...forgeAuth,
    contentType: normalized.contentType,
  });
  return blob.pathname;
}

/** Same normalization + upload for finished-card images under forge-finished/. */
export async function uploadForgeFinished(input: Buffer): Promise<string> {
  const normalized = await normalizeCardImage(input);
  const key = `${FINISHED_PREFIX}${randomUUID()}`;
  const blob = await put(key, normalized.data, {
    access: "private",
    addRandomSuffix: false,
    ...forgeAuth,
    contentType: normalized.contentType,
  });
  return blob.pathname;
}

/** Upload an already-processed image buffer (e.g. a crop derivative) under
 * forge-art/ WITHOUT re-normalizing — the corner-gated trim could eat a crop
 * that happens to have white corners. */
export async function uploadForgeArtRaw(data: Buffer, contentType: string): Promise<string> {
  const key = `${ART_PREFIX}${randomUUID()}`;
  const blob = await put(key, data, {
    access: "private",
    addRandomSuffix: false,
    ...forgeAuth,
    contentType,
  });
  return blob.pathname;
}

/** Store a rendered play card (renderedCard.ts) under its deterministic cache key. Overwrites
 *  on purpose: two instances can render the same version at once, and both renders are equal. */
export async function uploadForgeRendered(key: string, jpeg: Buffer): Promise<void> {
  if (!key.startsWith(RENDERED_PREFIX)) throw new Error(`not a rendered-card key: ${key}`);
  await put(key, jpeg, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    ...forgeAuth,
    contentType: "image/jpeg",
  });
}

/** Server-side read of a private art blob by its stored key. */
export function readForgeArt(key: string): Promise<GetBlobResult | null> {
  return get(key, { access: "private", ...forgeAuth });
}

/** Reads a raw client-uploaded blob back for the finalize step (private store — the
 * client-upload flow puts the file straight into Blob, bypassing the 4.5MB Vercel
 * Function body cap; this reads it back server-side so it can be normalized and
 * moved into its permanent forge-art/ or forge-finished/ key). Returns null on a
 * miss instead of throwing — callers treat that as "could not read uploaded image". */
export async function readForgeUpload(pathname: string): Promise<{ data: Buffer; contentType: string } | null> {
  const blob = await get(pathname, { access: "private", ...forgeAuth });
  if (!blob || blob.statusCode !== 200) return null;
  const data = Buffer.from(await new Response(blob.stream).arrayBuffer());
  return { data, contentType: blob.blob.contentType };
}

// The printed card faces (licensed, never committed) sit in the same private store under
// fixed keys, uploaded by scripts/forge-upload-fonts.ts and streamed to members by
// app/forge/api/fonts/[face]/route.ts.
const FONT_PREFIX = "forge-fonts/";
export const FORGE_FONT_FACES = ["title", "stat"] as const;
export type ForgeFontFace = (typeof FORGE_FONT_FACES)[number];

export function forgeFontKey(face: ForgeFontFace): string {
  return `${FONT_PREFIX}${face}.ttf`;
}

/** Server-side read of a printed card face from the private store. */
export function readForgeFont(face: ForgeFontFace): Promise<GetBlobResult | null> {
  return get(forgeFontKey(face), { access: "private", ...forgeAuth });
}

/** Best-effort delete of a private art blob (used when art is replaced). Non-fatal on failure. */
export async function deleteForgeArt(key: string): Promise<void> {
  try {
    await del(key, { ...forgeAuth });
  } catch {
    // A dangling private+UUID blob is invisible and harmless; don't fail the request.
  }
}
