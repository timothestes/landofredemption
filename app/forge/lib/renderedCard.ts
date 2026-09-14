// SERVER-ONLY. The render-on-miss half of the art proxy's kind=rendered branch (spec Unit 5.3-5.4).
// One render per cache key per instance at a time (concurrent requests share it); good renders
// are stored in the private Forge Blob store; deterministic failures are remembered for a few
// minutes so a card that cannot render is not re-rendered on every retry (goldfish re-requests a
// failed image on every zone change). The route owns the gate: call this only after it passed.
import type { GetBlobResult } from "@vercel/blob";
import { readForgeArt, readForgeFont, uploadForgeRendered } from "@/app/forge/lib/art";
import { renderCardImage, RenderInputError, type RenderIO, type RenderOutput } from "@/app/forge/lib/renderCard";
import type { DesignCard } from "@/app/forge/lib/designCard";

export type RenderJob = {
  cacheKey: string; cardId: string; versionId: string;
  data: DesignCard; artKey: string | null; year: number;
};

const NEGATIVE_TTL_MS = 5 * 60_000;
const inflight = new Map<string, Promise<RenderOutput | null>>();
const failedUntil = new Map<string, number>();

/** Test hook. */
export function _resetRenderedCardState(): void {
  inflight.clear();
  failedUntil.clear();
}

async function blobBytes(result: GetBlobResult | null): Promise<Buffer | null> {
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export const blobRenderIO: RenderIO = {
  readPrivateFont: async (face) => blobBytes(await readForgeFont(face)),
  readArt: async (key) => blobBytes(await readForgeArt(key)),
};

/** Render a version's card and store it unless degraded. null means respond 404. */
export function renderAndStore(job: RenderJob, io: RenderIO = blobRenderIO): Promise<RenderOutput | null> {
  if ((failedUntil.get(job.cacheKey) ?? 0) > Date.now()) return Promise.resolve(null);
  let pending = inflight.get(job.cacheKey);
  if (!pending) {
    pending = run(job, io).finally(() => inflight.delete(job.cacheKey));
    inflight.set(job.cacheKey, pending);
  }
  return pending;
}

async function run(job: RenderJob, io: RenderIO): Promise<RenderOutput | null> {
  const where = { cardId: job.cardId, versionId: job.versionId };
  let out: RenderOutput;
  try {
    out = await renderCardImage({ data: job.data, artKey: job.artKey, year: job.year }, io);
  } catch (err) {
    const transient = err instanceof RenderInputError;
    if (!transient) failedUntil.set(job.cacheKey, Date.now() + NEGATIVE_TTL_MS);
    console.error("[forge] card render failed", { ...where, transient, error: String(err).slice(0, 300) });
    return null;
  }
  if (out.degraded) {
    console.error("[forge] card rendered with fallback fonts (licensed face unavailable); not cached", where);
    return out;
  }
  try {
    await uploadForgeRendered(job.cacheKey, out.jpeg);
  } catch (err) {
    console.error("[forge] storing rendered card failed", { ...where, error: String(err).slice(0, 300) });
  }
  return out;
}
