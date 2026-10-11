// Server-only: natural pixel size of the images an article embeds, so the
// shared ArticleBody can emit width/height and an honest `sizes` for the image
// optimizer without ever touching sharp or the network itself.
import { unstable_cache } from "next/cache";
import sharp from "sharp";
import { isOptimizableUrl } from "./coverImage";

export interface ImageSize {
  w: number;
  h: number;
}

// PNG puts the size in the first bytes and JPEG's SOF marker normally sits well
// inside the first 64 KB, but sharp can't read a truncated WebP. Those retry with
// the whole file, capped so one huge upload can't stall a page render.
const HEAD_BYTES = 64 * 1024;
const FULL_CAP_BYTES = 8 * 1024 * 1024;

async function readUpTo(url: string, cap: number, range: boolean): Promise<Buffer | null> {
  const res = await fetch(url, {
    headers: range ? { Range: `bytes=0-${cap - 1}` } : undefined,
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok || !res.body) return null;
  // A host that ignores Range answers 200 with the whole file: stop at the cap.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= cap) {
      truncated = !range && total > cap;
      break;
    }
  }
  void reader.cancel().catch(() => {});
  return truncated ? null : Buffer.concat(chunks);
}

async function measure(buf: Buffer): Promise<ImageSize | null> {
  const { width, height, orientation } = await sharp(buf).metadata();
  if (!width || !height) return null;
  // EXIF orientations 5-8 are rotated a quarter turn when displayed.
  return orientation && orientation >= 5 ? { w: height, h: width } : { w: width, h: height };
}

async function probe(url: string): Promise<ImageSize | null> {
  try {
    const head = await readUpTo(url, HEAD_BYTES, true);
    if (head) {
      try {
        return await measure(head);
      } catch {
        /* truncated header (WebP): fall through to the full read */
      }
    }
    const full = await readUpTo(url, FULL_CAP_BYTES, false);
    return full ? await measure(full) : null;
  } catch {
    return null;
  }
}

/** Uploaded files never change under their (random-suffixed) URL, so cache for a month. */
function imageSize(url: string): Promise<ImageSize | null> {
  return unstable_cache(() => probe(url), ["article-image-size", url], { revalidate: 60 * 60 * 24 * 30 })();
}

/** Sizes keyed by URL, for the optimizable images only; misses are left out. */
export async function resolveImageSizes(urls: string[]): Promise<Record<string, ImageSize>> {
  const out: Record<string, ImageSize> = {};
  await Promise.all(
    urls.filter(isOptimizableUrl).map(async (u) => {
      const size = await imageSize(u);
      if (size) out[u] = size;
    }),
  );
  return out;
}
