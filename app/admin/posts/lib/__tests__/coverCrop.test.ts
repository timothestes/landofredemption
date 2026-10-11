import { describe, it, expect } from "vitest";
import { cropOutputSize, cropOutputType, croppedFileName, typeFromUrl, COVER_ASPECT } from "../coverCrop";

describe("cropOutputSize", () => {
  it("keeps a rect that already fits", () => {
    expect(cropOutputSize({ width: 1600, height: 900 })).toEqual({ width: 1600, height: 900 });
  });
  it("scales a wide rect down to the max width, keeping the aspect", () => {
    expect(cropOutputSize({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
  });
  it("never scales up", () => {
    expect(cropOutputSize({ width: 320, height: 180 })).toEqual({ width: 320, height: 180 });
  });
  it("rounds to integers and clamps to at least 1px", () => {
    expect(cropOutputSize({ width: 1000.4, height: 562.7 })).toEqual({ width: 1000, height: 563 });
    expect(cropOutputSize({ width: 0.2, height: 0.1 })).toEqual({ width: 1, height: 1 });
  });
  it("honours a custom max width", () => {
    expect(cropOutputSize({ width: 1000, height: 500 }, 100)).toEqual({ width: 100, height: 50 });
  });
  it("offers the 16:9 frame", () => expect(COVER_ASPECT).toBeCloseTo(16 / 9));
});

describe("cropOutputType", () => {
  it("keeps png for transparency", () => expect(cropOutputType("image/png")).toBe("image/png"));
  it.each(["image/jpeg", "image/webp", "image/gif", ""])("re-encodes %j as jpeg", (t) => {
    expect(cropOutputType(t)).toBe("image/jpeg");
  });
});

describe("typeFromUrl", () => {
  it("spots a png by extension, ignoring the query string", () => {
    expect(typeFromUrl("https://x.public.blob.vercel-storage.com/posts/1/cover-abc.PNG?v=2")).toBe("image/png");
  });
  it("defaults to jpeg", () => {
    expect(typeFromUrl("https://x/posts/1/photo.jpg")).toBe("image/jpeg");
    expect(typeFromUrl("https://x/posts/1/photo.webp")).toBe("image/jpeg");
    expect(typeFromUrl("not a url")).toBe("image/jpeg");
  });
});

describe("croppedFileName", () => {
  it("suffixes the source base name and swaps the extension", () => {
    expect(croppedFileName("My Photo.jpeg", "image/jpeg")).toBe("My Photo-cover.jpg");
    expect(croppedFileName("logo.PNG", "image/png")).toBe("logo-cover.png");
  });
  it("uses a plain name when there is no source name (re-cropping an existing cover)", () => {
    expect(croppedFileName("", "image/jpeg")).toBe("cover.jpg");
    expect(croppedFileName(".png", "image/png")).toBe("cover.png");
  });
});
