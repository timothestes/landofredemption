import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@vercel/blob", () => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@/app/forge/lib/imageNormalize", () => ({ normalizeCardImage: vi.fn() }));

import { put, get } from "@vercel/blob";
import { normalizeCardImage } from "@/app/forge/lib/imageNormalize";
import {
  validateArtFile, MAX_ART_BYTES, uploadForgeArt, uploadForgeFinished, uploadForgeArtRaw,
  readForgeUpload, uploadForgeRendered,
} from "../art";

describe("validateArtFile", () => {
  it("accepts a normal PNG", () => {
    expect(validateArtFile({ type: "image/png", size: 1024 })).toBeNull();
  });

  it("rejects a non-image type", () => {
    expect(validateArtFile({ type: "application/pdf", size: 1024 })).toMatch(/Invalid file type/);
  });

  it("rejects a file over the size cap", () => {
    expect(validateArtFile({ type: "image/png", size: MAX_ART_BYTES + 1 })).toMatch(/too large/i);
  });

  it("accepts a .tif with a proper image/tiff MIME type", () => {
    expect(validateArtFile({ type: "image/tiff", size: 1024, name: "scan.tif" })).toBeNull();
  });

  it("accepts a .tiff with an empty MIME type (common browser behavior)", () => {
    expect(validateArtFile({ type: "", size: 1024, name: "scan.tiff" })).toBeNull();
  });

  it("accepts a .tif with a generic application/octet-stream MIME type", () => {
    expect(validateArtFile({ type: "application/octet-stream", size: 1024, name: "scan.tif" })).toBeNull();
  });

  it("still rejects a .png with an empty MIME type (extension fallback is TIFF-only)", () => {
    expect(validateArtFile({ type: "", size: 1024, name: "scan.png" })).toMatch(/Invalid file type/);
  });

  it("still rejects a non-image file with a .tif-like name but no name field at all", () => {
    expect(validateArtFile({ type: "application/octet-stream", size: 1024 })).toMatch(/Invalid file type/);
  });

  it("rejects a JPEG unchanged", () => {
    expect(validateArtFile({ type: "image/jpeg", size: 1024 })).toBeNull();
  });

  it("enforces the same 50MB cap for TIFF, with a TIFF-specific message", () => {
    const msg = validateArtFile({ type: "image/tiff", size: MAX_ART_BYTES + 1, name: "scan.tif" });
    expect(msg).toMatch(/tiff/i);
    expect(msg).toMatch(/50\s*MB/i);
  });

  it("names the cap 50MB, not a stale hardcoded number", () => {
    expect(MAX_ART_BYTES).toBe(50 * 1024 * 1024);
  });
});

const inputBuf = Buffer.from([1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  (put as any).mockResolvedValue({ pathname: "forge-art/some-key" });
  (normalizeCardImage as any).mockResolvedValue({
    data: Buffer.from("normalized"),
    contentType: "image/jpeg",
  });
});

describe("uploadForgeArt / uploadForgeFinished", () => {
  it("uploads the NORMALIZED bytes as image/jpeg, not the original buffer", async () => {
    await uploadForgeArt(inputBuf);
    expect(normalizeCardImage).toHaveBeenCalledWith(inputBuf);
    const [key, body, opts] = (put as any).mock.calls[0];
    expect(String(key)).toMatch(/^forge-art\//);
    expect(Buffer.from(body).toString()).toBe("normalized");
    expect(opts.contentType).toBe("image/jpeg");
  });

  it("uploadForgeFinished stores under forge-finished/ with normalized bytes", async () => {
    (put as any).mockResolvedValue({ pathname: "forge-finished/some-key" });
    await uploadForgeFinished(inputBuf);
    const [key, body, opts] = (put as any).mock.calls[0];
    expect(String(key)).toMatch(/^forge-finished\//);
    expect(Buffer.from(body).toString()).toBe("normalized");
    expect(opts.contentType).toBe("image/jpeg");
  });

  it("propagates decode failures without uploading anything", async () => {
    (normalizeCardImage as any).mockRejectedValue(new Error("unsupported image format"));
    await expect(uploadForgeArt(inputBuf)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});

describe("uploadForgeArtRaw", () => {
  beforeEach(() => vi.clearAllMocks());
  it("puts the buffer as-is under forge-art/ without normalizing", async () => {
    (put as ReturnType<typeof vi.fn>).mockResolvedValue({ pathname: "forge-art/raw-key" });
    const buf = Buffer.from([9, 9, 9]);
    const key = await uploadForgeArtRaw(buf, "image/jpeg");
    expect(key).toBe("forge-art/raw-key");
    expect(normalizeCardImage).not.toHaveBeenCalled();
    const [putKey, putData, putOpts] = (put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(putKey).toMatch(/^forge-art\//);
    expect(putData).toBe(buf);
    expect(putOpts.contentType).toBe("image/jpeg");
    expect(putOpts.access).toBe("private");
  });
});

describe("readForgeUpload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the raw bytes and contentType when the blob is found", async () => {
    (get as ReturnType<typeof vi.fn>).mockResolvedValue({
      statusCode: 200,
      stream: new Blob([new Uint8Array([7, 8, 9])]).stream(),
      blob: { contentType: "image/png" },
    });
    const result = await readForgeUpload("forge-art-raw/x.tif");
    expect(get).toHaveBeenCalledWith("forge-art-raw/x.tif", expect.objectContaining({ access: "private" }));
    expect(Array.from(result!.data)).toEqual([7, 8, 9]);
    expect(result!.contentType).toBe("image/png");
  });

  it("returns null when the blob is missing", async () => {
    (get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(await readForgeUpload("forge-art-raw/missing")).toBeNull();
  });

  it("returns null on a non-200 status", async () => {
    (get as ReturnType<typeof vi.fn>).mockResolvedValue({ statusCode: 404 });
    expect(await readForgeUpload("forge-art-raw/gone")).toBeNull();
  });
});

describe("uploadForgeRendered", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores the JPEG privately under its exact key, overwriting an identical concurrent render", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    await uploadForgeRendered("forge-rendered/r1/v1.jpg", jpeg);
    expect(put).toHaveBeenCalledWith("forge-rendered/r1/v1.jpg", jpeg, expect.objectContaining({
      access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg",
    }));
    // forgeAuth must ride along, or the SDK falls back to the PUBLIC store's default token.
    const opts = (put as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect("token" in opts || "storeId" in opts).toBe(true);
  });

  it("refuses any key outside forge-rendered/", async () => {
    await expect(uploadForgeRendered("forge-art/x", Buffer.from([1]))).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});
