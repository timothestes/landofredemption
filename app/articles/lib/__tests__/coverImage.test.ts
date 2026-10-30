import { afterEach, describe, expect, it, vi } from "vitest";
import { coverImageProps, postCoverUrl, withVideoCovers } from "../coverImage";

const BLOB = "https://abc123.public.blob.vercel-storage.com/posts/x/shot name.png";

describe("coverImageProps", () => {
  it("routes Blob covers through the optimizer with a w-descriptor srcSet", () => {
    const p = coverImageProps(BLOB, [128, 256, 384]);
    expect(p.src).toBe(`/_next/image?url=${encodeURIComponent(BLOB)}&w=256&q=75`);
    expect(p.srcSet).toBe(
      [128, 256, 384].map((w) => `/_next/image?url=${encodeURIComponent(BLOB)}&w=${w}&q=75 ${w}w`).join(", "),
    );
  });

  it("leaves hosts the optimizer rejects untouched", () => {
    expect(coverImageProps("https://example.com/a.png", [128, 256])).toEqual({ src: "https://example.com/a.png" });
  });

  it("leaves non-URLs untouched", () => {
    expect(coverImageProps("/local.png", [128])).toEqual({ src: "/local.png" });
  });
});

const VIDEO_ID = "pk4dGdX5fEc";
const VIDEO = `Watch this:\n\nhttps://youtu.be/${VIDEO_ID}`;

describe("postCoverUrl", () => {
  it("prefers the post's own cover", () => {
    expect(postCoverUrl({ cover_image_url: BLOB, cover_video_id: VIDEO_ID })).toBe(BLOB);
  });

  it("borrows the video's thumbnail when there is no cover", () => {
    expect(postCoverUrl({ cover_image_url: null, cover_video_id: VIDEO_ID })).toBe(`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
    expect(postCoverUrl({ cover_image_url: "", cover_video_id: VIDEO_ID }, "thumb")).toBe(`https://i.ytimg.com/vi/${VIDEO_ID}/mqdefault.jpg`);
  });

  it("is null with neither", () => {
    expect(postCoverUrl({ cover_image_url: null })).toBeNull();
  });
});

describe("withVideoCovers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sets cover_video_id only for an uncovered post whose video thumbnail exists", async () => {
    const fetch = vi.fn(async (url: string) => new Response(null, { status: url.includes(VIDEO_ID) ? 200 : 404 }));
    vi.stubGlobal("fetch", fetch);
    const posts = await withVideoCovers([
      { cover_image_url: null, body_md: VIDEO },
      { cover_image_url: null, body_md: "https://youtu.be/Idkiq6PLzwA" },
      { cover_image_url: BLOB, body_md: VIDEO },
      { cover_image_url: null, body_md: "Just words." },
    ]);
    expect(posts.map((p) => p.cover_video_id)).toEqual([VIDEO_ID, null, null, null]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("treats a failed check as no video", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const [post] = await withVideoCovers([{ cover_image_url: null, body_md: VIDEO }]);
    expect(post.cover_video_id).toBeNull();
  });
});
