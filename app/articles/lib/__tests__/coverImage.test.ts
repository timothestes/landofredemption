import { describe, expect, it } from "vitest";
import { coverImageProps } from "../coverImage";

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
