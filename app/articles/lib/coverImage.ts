// Covers are uploaded as-is (often 3-5 MB PNG screenshots), so every <img>
// that points at the raw Blob file ships megabytes into a 96px thumbnail.
// Routing them through /_next/image gets WebP/AVIF at the width actually shown.
// Widths must be in next.config.js deviceSizes/imageSizes; quality must be 75.
import { embeddedYoutubeId } from "./markdown";

const BLOB_BASE = process.env.NEXT_PUBLIC_BLOB_BASE_URL;

// Only hqdefault/mqdefault exist for every video (maxresdefault 404s on some).
// hqdefault is 4:3 with letterbox bars that a 16:9 crop removes exactly;
// mqdefault is 16:9 with none, for the 4:3 thumbnails.
const ytThumb = (id: string, size: "hqdefault" | "mqdefault") => `https://i.ytimg.com/vi/${id}/${size}.jpg`;

/** Cover for cards and share previews: the post's own, else its video's thumbnail (see withVideoCovers). */
export function postCoverUrl(
  post: { cover_image_url: string | null; cover_video_id?: string | null },
  shape: "wide" | "thumb" = "wide",
): string | null {
  if (post.cover_image_url) return post.cover_image_url;
  return post.cover_video_id ? ytThumb(post.cover_video_id, shape === "thumb" ? "mqdefault" : "hqdefault") : null;
}

/**
 * Sets `cover_video_id` on each post that has no cover but embeds a YouTube
 * video that still exists. A removed video's thumbnail is a 404 whose body is
 * still a grey placeholder image, so the browser would show it — check first.
 */
export async function withVideoCovers<T extends { cover_image_url: string | null; body_md: string }>(
  posts: T[],
): Promise<(T & { cover_video_id: string | null })[]> {
  return Promise.all(
    posts.map(async (post) => {
      const id = post.cover_image_url ? null : embeddedYoutubeId(post.body_md);
      const live = id
        ? await fetch(ytThumb(id, "mqdefault"), { method: "HEAD", signal: AbortSignal.timeout(3000) }).then(
            (r) => r.ok,
            () => false,
          )
        : false;
      return { ...post, cover_video_id: live ? id : null };
    }),
  );
}

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
