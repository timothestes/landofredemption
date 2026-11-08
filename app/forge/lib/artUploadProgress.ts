// A batch of art uploads, for the panel's tiles and hint. Pure, for testing in node. The tiles
// count what the page has been given, not what has finished uploading: a finished upload's image
// only arrives with the next refresh, and until then it has to keep looking like work in progress.

export type UploadBatch = {
  done: number;     // uploads finished; equal to total once none are left
  total: number;
  name: string;     // the file uploading now
  failed: number;
  before: number;   // how many images the card had when the batch started
};

export function pendingTiles(batch: UploadBatch, candidateCount: number): number {
  return Math.max(0, batch.total - batch.failed - (candidateCount - batch.before));
}

export function uploadHint(batch: UploadBatch): string {
  return batch.done < batch.total ? `Uploading ${batch.done + 1} of ${batch.total} — ${batch.name}` : "Adding to the card…";
}
