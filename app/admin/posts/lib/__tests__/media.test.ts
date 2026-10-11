import { describe, it, expect } from "vitest";
import { validateMediaFile, mediaPathname, parseClientPayload, altFromFileName, MAX_IMAGE_BYTES, MAX_AUDIO_BYTES } from "../media";

describe("validateMediaFile", () => {
  it("accepts a small png as an image", () => expect(validateMediaFile({ type: "image/png", size: 10 }, "image")).toBeNull());
  it("rejects audio offered as an image", () => expect(validateMediaFile({ type: "audio/mpeg", size: 10 }, "image")).toMatch(/JPEG/));
  it("rejects an oversized image", () => expect(validateMediaFile({ type: "image/png", size: MAX_IMAGE_BYTES + 1 }, "image")).toMatch(/15 MB/));
  it("accepts m4a variants as audio", () => {
    expect(validateMediaFile({ type: "audio/x-m4a", size: 10 }, "audio")).toBeNull();
    expect(validateMediaFile({ type: "audio/mp4", size: 10 }, "audio")).toBeNull();
  });
  it("rejects an oversized audio file", () => expect(validateMediaFile({ type: "audio/mpeg", size: MAX_AUDIO_BYTES + 1 }, "audio")).toMatch(/200 MB/));
  it("rejects an unknown type with a clear message", () => expect(validateMediaFile({ type: "", size: 1 }, "audio")).toMatch(/MP3/));
});

describe("mediaPathname", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  it("namespaces under the post and sanitises the name", () => {
    expect(mediaPathname(id, "My Photo (final).PNG")).toBe(`posts/${id}/my-photo-final.png`);
  });
  it("handles names without an extension", () => expect(mediaPathname(id, "README")).toBe(`posts/${id}/readme.bin`));
  it("caps the base name", () => expect(mediaPathname(id, `${"a".repeat(100)}.mp3`)).toBe(`posts/${id}/${"a".repeat(40)}.mp3`));
});

describe("parseClientPayload", () => {
  const id = "11111111-1111-1111-1111-111111111111";
  it("parses a good payload", () => expect(parseClientPayload(JSON.stringify({ postId: id, kind: "audio" }))).toEqual({ postId: id, kind: "audio" }));
  it.each([null, "", "{", JSON.stringify({ postId: "x", kind: "image" }), JSON.stringify({ postId: id, kind: "video" })])(
    "rejects %j",
    (raw) => expect(parseClientPayload(raw)).toBeNull(),
  );
});

describe("altFromFileName", () => {
  it("makes a descriptive name readable", () => {
    expect(altFromFileName("my-deck_photo  final.jpg")).toBe("my deck photo final");
    expect(altFromFileName("Lost Soul.png")).toBe("Lost Soul");
  });
  it.each([
    "IMG_4821.jpeg",
    "IMG4821.JPG",
    "DSC01234.jpg",
    "PXL_20261011_131422.jpg",
    "Screenshot_20261011-131422.png",
    "Screen Shot 2026-10-11 at 3.14.22 PM.png",
    "11111111-1111-1111-1111-111111111111.png",
    "20261011.png",
    ".png",
  ])("is empty for %s", (name) => expect(altFromFileName(name)).toBe(""));
  it("keeps a name that merely starts like a camera prefix", () => {
    expect(altFromFileName("image-of-eden.png")).toBe("image of eden");
    expect(altFromFileName("dscription.png")).toBe("dscription");
  });
});
