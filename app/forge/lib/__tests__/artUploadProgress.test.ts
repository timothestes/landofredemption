import { describe, it, expect } from "vitest";
import { pendingTiles, uploadHint, type UploadBatch } from "../artUploadProgress";

const batch = (over: Partial<UploadBatch> = {}): UploadBatch => ({ done: 0, total: 2, name: "a.png", failed: 0, before: 3, ...over });

describe("pendingTiles", () => {
  it("shows a tile for every file in the batch to begin with", () => {
    expect(pendingTiles(batch(), 3)).toBe(2);
  });
  it("keeps a finished upload's tile until its image is in the page's list", () => {
    expect(pendingTiles(batch({ done: 1 }), 3)).toBe(2);
    expect(pendingTiles(batch({ done: 2 }), 3)).toBe(2);
  });
  it("drops a tile once its image has arrived", () => {
    expect(pendingTiles(batch({ done: 2 }), 4)).toBe(1);
    expect(pendingTiles(batch({ done: 2 }), 5)).toBe(0);
  });
  it("drops a tile for a file that failed, which will never arrive", () => {
    expect(pendingTiles(batch({ done: 2, failed: 1 }), 3)).toBe(1);
  });
  it("never goes below zero if someone else adds an image meanwhile", () => {
    expect(pendingTiles(batch({ done: 2 }), 9)).toBe(0);
  });
});

describe("uploadHint", () => {
  it("names the file while it uploads", () => {
    expect(uploadHint(batch({ done: 1, name: "b.png" }))).toBe("Uploading 2 of 2 — b.png");
  });
  it("still says it's working after the last upload, until the images are there", () => {
    expect(uploadHint(batch({ done: 2 }))).toBe("Adding to the card…");
  });
});
