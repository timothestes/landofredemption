/**
 * Shared card image URL utilities.
 *
 * Consolidates the many duplicate definitions of sanitizeImgFile() and
 * getCardImageUrl() that were scattered across the codebase.
 */

import imgVersions from "@/lib/cards/generated/imgVersions.json";

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

/** CSS aspect-ratio of the card images getCardImageUrl points at: the blob
 *  store's cards are 345×495 (the size catalogRow.ts's CARD_IMAGE_WIDTH /
 *  CARD_IMAGE_HEIGHT normalize released art to). Set it on an <img> to reserve
 *  the card's height before the image loads. */
export const CARD_IMAGE_ASPECT_RATIO = '345 / 495';

// imgFile → replacement version (catalog editor). Keyed on SANITIZED names;
// non-empty entries append ?v= so a deploy busts every cached replaced image.
const IMG_VERSIONS = imgVersions as Record<string, number>;

function versionSuffix(sanitized: string): string {
  const v = IMG_VERSIONS[sanitized];
  return v ? `?v=${v}` : "";
}

/** Strip trailing .jpg / .jpeg and map path-breaking slashes, so we can append
 *  a canonical extension. Slash→underscore matches how the legacy deck-preview
 *  builders (and the blob store's actual filenames) always treated slashes. */
export function sanitizeImgFile(f: string): string {
  return f.replace(/\//g, "_").replace(/\.jpe?g$/i, "");
}

/**
 * Build the full Vercel Blob URL for a card image.
 *
 * - Paths that already start with `/` are returned as-is (local assets).
 * - Empty strings return `''`.
 */
export function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  if (imgFile.startsWith('forge:')) return ''; // opaque Forge ref — resolved via the forge resolver, never the public CDN
  if (imgFile.startsWith('/')) return imgFile;
  const sanitized = sanitizeImgFile(imgFile);
  return `${BLOB_BASE_URL}/card-images/${sanitized}.jpg${versionSuffix(sanitized)}`;
}

/**
 * Nullable variant — useful for optional preview-card fields.
 *
 * Returns `null` when `imgFile` is nullish or the blob base URL is missing.
 */
export function getCardImageUrlOrNull(imgFile: string | null | undefined): string | null {
  if (!imgFile) return null;
  if (imgFile.startsWith('forge:')) return null;
  if (imgFile.startsWith('/')) return imgFile; // local assets & same-origin proxy URLs
  if (!BLOB_BASE_URL) return null;
  const sanitized = sanitizeImgFile(imgFile);
  return `${BLOB_BASE_URL}/card-images/${sanitized}.jpg${versionSuffix(sanitized)}`;
}
