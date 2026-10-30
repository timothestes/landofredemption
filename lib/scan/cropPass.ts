import { cropBoxToPhoto, cropGroup, cropRect, keepCropRead, needsCrop, nestedGroups } from './crop';
import { DECK_INSTRUCTION, type DeckGroup, type DeckOutput, type DeckRead } from './deckSchema';
import { DECK_ARM, DECK_MODE, recognize, type Arm, type RecognizeMode, type RecognizeResult } from './recognize';

// Second pass for deck photos: re-read each sideways, upside-down or truncated group from a tight crop turned upright,
// CROP_CONCURRENCY at a time before a hard deadline, and swap that group's reads for the crop's. Server only.

export const CROP_CONCURRENCY = 4;
export const MAX_CROP_GROUPS = 12;
export const CROP_CALL_TIMEOUT_MS = 30_000;
/** A worker starts no crop, and sends none to the model, with less than this left before the deadline. */
export const MIN_CROP_REMAINING_MS = 12_000;

export const CROP_PREFIX = 'This is one group cropped from a larger deck photo and turned upright; read every card in it. Report it as a single group with id 1.\n\n';
export const CROP_MODE: RecognizeMode<DeckOutput> = { ...DECK_MODE, instruction: CROP_PREFIX + DECK_INSTRUCTION, timeoutMs: CROP_CALL_TIMEOUT_MS, retryWithinMs: 15_000 };
export const CROP_ARM: Required<Arm> = { ...DECK_ARM, effort: 'medium' };

/** Per-call timing so a crop, retry included, ends by the deadline: a retry only when a full second attempt (2 s sleep + timeoutMs) still fits. */
export function cropCallTiming(remaining: number): { timeoutMs: number; retryWithinMs: number } {
  const timeoutMs = Math.min(CROP_CALL_TIMEOUT_MS, remaining);
  return { timeoutMs, retryWithinMs: Math.min(CROP_MODE.retryWithinMs, Math.max(0, remaining - 2_000 - timeoutMs)) };
}

export interface CropPassDeps { recognize?: typeof recognize; crop?: typeof cropGroup; now?: () => number }

export interface CropPassResult {
  cards: DeckRead[];
  cropped: number[];
  failed: number[];
  skipped: number[];
  /** Groups nested in a cropped group: their cards came back in its crop, so their own reads were dropped. */
  merged: number[];
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  latencyMs: number;
  calls: number;
  failures: { group: number; code: string; detail?: unknown }[];
}

export async function runCropPass(jpeg: Buffer, out: DeckOutput, image: { width: number; height: number }, deadline: number, deps: CropPassDeps = {}): Promise<CropPassResult> {
  const rec = deps.recognize ?? recognize;
  const crop = deps.crop ?? cropGroup;
  const now = deps.now ?? Date.now;
  const started = now();
  const { width, height } = image;
  const readsOf = (id: number) => out.cards.filter(c => c.group === id);
  // The parser can repeat a group id; the first one wins, so a group is cropped and emitted once.
  const seen = new Set<number>();
  const groups = out.groups.filter(g => !seen.has(g.id) && seen.add(g.id));

  // A group nested in a group that will be cropped is read by that crop: cropping both would count its cards twice.
  const nested = nestedGroups(groups);
  const needs = (g: DeckGroup) => needsCrop(g, readsOf(g.id).length);
  const willCrop = new Set(groups.filter(needs).map(g => g.id));
  const absorbedBy = new Map([...nested].filter(([, root]) => willCrop.has(root)));
  const needy = groups.filter(g => needs(g) && !absorbedBy.has(g.id)).sort((a, b) => a.id - b.id);
  const queue = needy.slice(0, MAX_CROP_GROUPS);
  const skipped = needy.slice(MAX_CROP_GROUPS).map(g => g.id);
  const cropped: number[] = [];
  const failed: number[] = [];
  const failures: CropPassResult['failures'] = [];
  const replaced = new Map<number, DeckRead[]>();
  const usage = { inputTokens: 0, outputTokens: 0 };
  let costUsd = 0;
  let calls = 0;

  const worker = async () => {
    for (let g = queue.shift(); g; g = queue.shift()) {
      if (deadline - now() < MIN_CROP_REMAINING_MS) {
        skipped.push(g.id);
        continue;
      }
      try {
        const buf = await crop(jpeg, g, width, height);
        if (deadline - now() < MIN_CROP_REMAINING_MS) {
          skipped.push(g.id);
          continue;
        }
        const mode: RecognizeMode<DeckOutput> = { ...CROP_MODE, ...cropCallTiming(deadline - now()) };
        const r: RecognizeResult<DeckOutput> = await rec(buf, CROP_ARM, {}, mode);
        calls += r.attempts;
        if (r.usage) {
          usage.inputTokens += r.usage.inputTokens;
          usage.outputTokens += r.usage.outputTokens;
        }
        if (typeof r.costUsd === 'number') costUsd += r.costUsd;
        // tsconfig is strict:false, so `ok` does not narrow the union; `'code' in r` does.
        if ('code' in r) {
          failed.push(g.id);
          failures.push({ group: g.id, code: r.code, ...(r.detail !== undefined ? { detail: r.detail } : {}) });
        } else {
          const group = g;
          const rect = cropRect(group.bbox, width, height);
          const kept = r.output.cards.filter(read => keepCropRead(read, group, rect, width, height));
          if (kept.length === 0) {
            // Nothing of this group's came back: keep the first-pass reads rather than delete the group's cards.
            failed.push(group.id);
            failures.push({ group: group.id, code: 'empty_crop' });
          } else {
            // Crop title boxes are in the crop's frame; the contract is fractions of the whole photo. A rotated crop's frame is turned, so its boxes are dropped.
            const upright = group.orientation === 'upright';
            replaced.set(group.id, kept.map((read, i) => ({
              ...read,
              group: group.id,
              position: i + 1,
              titleBox: upright && read.titleBox ? cropBoxToPhoto(read.titleBox, rect, width, height) : null,
            })));
            cropped.push(group.id);
          }
        }
      } catch (err) {
        failed.push(g.id);
        failures.push({ group: g.id, code: 'crop_failed', detail: { message: err instanceof Error ? err.message : String(err) } });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CROP_CONCURRENCY, queue.length) }, worker));

  // Nested groups whose container's crop came back are dropped; a failed or skipped container leaves them as read.
  const merged = [...absorbedBy].filter(([, root]) => replaced.has(root)).map(([id]) => id);
  const gone = new Set(merged);

  // Rebuilt in out.groups order; reads of group 0 (and of any group not listed) go last, unchanged.
  const listed = new Set(groups.filter(g => g.id !== 0).map(g => g.id));
  const cards = [
    ...groups.filter(g => g.id !== 0 && !gone.has(g.id)).flatMap(g => replaced.get(g.id) ?? readsOf(g.id)),
    ...out.cards.filter(c => !listed.has(c.group)),
  ];
  const asc = (a: number, b: number) => a - b;
  return {
    cards,
    cropped: cropped.sort(asc),
    failed: failed.sort(asc),
    skipped: skipped.sort(asc),
    merged: merged.sort(asc),
    usage,
    costUsd,
    latencyMs: now() - started,
    calls,
    failures: failures.sort((a, b) => a.group - b.group),
  };
}
