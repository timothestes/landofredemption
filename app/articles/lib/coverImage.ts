// Covers are uploaded as-is (often 3-5 MB PNG screenshots), so every <img>
// that points at the raw Blob file ships megabytes into a 96px thumbnail.
// Routing them through /_next/image gets WebP/AVIF at the width actually shown.
// Widths must be in next.config.js deviceSizes/imageSizes; quality must be 75.

const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL;

/** Only hosts next.config.js allows in `images.remotePatterns` — anything else would 400. */
export function isOptimizableUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (BLOB_BASE) {
    try {
      return host === new URL(BLOB_BASE).hostname;
    } catch {
      return false;
    }
  }
  return host.endsWith(".public.blob.vercel-storage.com");
}

const optimizerUrl = (url: string, w: number) => `/_next/image?url=${encodeURIComponent(url)}&w=${w}&q=75`;

/**
 * `src` + `srcSet` for a cover. Returns just the original `src` (no srcSet) for
 * hosts the optimizer won't accept, so those render exactly as before.
 * `widths` is ascending; the middle one is the fallback `src`.
 */
export function coverImageProps(url: string, widths: readonly number[]): { src: string; srcSet?: string } {
  if (!isOptimizableUrl(url)) return { src: url };
  return {
    src: optimizerUrl(url, widths[Math.floor(widths.length / 2)]),
    srcSet: widths.map((w) => `${optimizerUrl(url, w)} ${w}w`).join(", "),
  };
}
