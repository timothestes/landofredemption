/**
 * Local deck pipeline: runs the route's deck path (encode, first read, turn pass, crop pass, classify) against a photo
 * directory, calling Claude directly with an arm override that also reaches the turn and crop passes (model and thinking;
 * each pass keeps its own effort). For arm comparisons that the deployed route cannot make. Needs SCANNER_ANTHROPIC_API_KEY
 * (from .env.local, or the file named by ENV_FILE). Score the output with deckScore.ts.
 *
 *   npx tsx scripts/scan-eval/deckLocal.ts --photos scripts/scan-eval/photos-deck --out scripts/scan-eval/outputs/deck-<arm>/ \
 *     [--arm '{"thinking":"off"}'] [--only <file>,<file>] [--concurrency 2] [--deadline-ms 140000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { encodeForScan } from '@/lib/scan/image';
import { recognize, DECK_ARM, DECK_MODE, type Arm } from '@/lib/scan/recognize';
import { runTurnPass } from '@/lib/scan/turnPass';
import { runCropPass } from '@/lib/scan/cropPass';
import { inferSidewaysRows } from '@/lib/scan/crop';
import { matchDetection } from '@/lib/scan/match';
import { capDetection } from '@/lib/scan/schema';
import { DECK_DETECTION_CAP } from '@/lib/scan/deckSchema';
import { classifyDeckRead, deckReadToDetection, type DeckDetection } from '@/lib/scan/deckClassify';

config({ path: process.env.ENV_FILE ?? '.env.local' });

function parseArgs(argv: string[]) {
  const f: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    f[a.slice(2)] = v;
  }
  if (!f.out) throw new Error('--out is required');
  const arm: Required<Arm> = { ...DECK_ARM, ...(f.arm ? (JSON.parse(f.arm) as Partial<Arm>) : {}) };
  const deadlineMs = f['deadline-ms'] ? Number(f['deadline-ms']) : 140_000;
  const concurrency = f.concurrency ? Number(f.concurrency) : 2;
  return {
    photos: f.photos ?? 'scripts/scan-eval/photos-deck',
    out: f.out,
    arm,
    only: f.only ? new Set(f.only.split(',').map(s => s.trim()).filter(Boolean)) : null,
    deadlineMs,
    concurrency,
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function runOne(file: string, o: ReturnType<typeof parseArgs>) {
  const { arm } = o;
  // The turn and crop passes take the arm's model and thinking, keeping their own effort (high, medium).
  const rec = ((jpeg: Buffer, a: Required<Arm>, deps?: unknown, mode?: unknown) =>
    recognize(jpeg, { ...a, model: arm.model, thinking: arm.thinking }, deps as never, mode as never)) as typeof recognize;

  const upload = fs.readFileSync(path.join(o.photos, file));
  const requestStart = Date.now();
  const t0 = Date.now();
  let { jpeg, width, height } = await encodeForScan(upload, arm.tier);
  const encodeMs = Date.now() - t0;

  let r = await recognize(jpeg, arm, {}, DECK_MODE);
  for (let i = 0; !r.ok && (r.code === 'upstream_rate_limit' || r.code === 'upstream_overloaded') && i < 3; i++) {
    const wait = ((r as { retryAfterSeconds?: number }).retryAfterSeconds ?? 20) * 1000;
    console.warn(`  ${file}: ${r.code}, retrying in ${wait}ms`);
    await sleep(wait);
    r = await recognize(jpeg, arm, {}, DECK_MODE);
  }
  if (!r.ok) return { error: r.code, detail: r.detail, latencyMs: r.latencyMs, usage: r.usage, costUsd: r.costUsd };

  const deadline = requestStart + o.deadlineMs;
  const tp = await runTurnPass(upload, r.output, { width, height }, deadline, { recognize: rec });
  if (tp.failure) console.error(`  ${file}: turn failed`, tp.failure);
  ({ width, height } = tp);
  const out = { ...tp.output, groups: inferSidewaysRows(tp.output.groups, width, height) };
  const cp = await runCropPass({ upload, turn: tp.rotation }, out, { width, height }, deadline, { recognize: rec });
  for (const { group, code, detail } of cp.failures) console.error(`  ${file}: crop failed group ${group}: ${code}`, detail ?? '');

  const usage = {
    inputTokens: r.usage.inputTokens + tp.usage.inputTokens + cp.usage.inputTokens,
    outputTokens: r.usage.outputTokens + tp.usage.outputTokens + cp.usage.outputTokens,
  };
  const costUsd = r.costUsd + tp.costUsd + cp.costUsd;
  const latencyMs = r.latencyMs + tp.latencyMs + cp.latencyMs;
  const attempts = r.attempts + tp.calls + cp.calls;
  const detections: DeckDetection[] = cp.cards.slice(0, DECK_DETECTION_CAP).map((deckRead, i) => {
    const read = capDetection(deckReadToDetection(deckRead));
    const m = matchDetection(read, {});
    const c = classifyDeckRead(deckRead, m);
    return {
      id: `${file}:${i}`,
      group: deckRead.group,
      position: deckRead.position,
      titleBox: deckRead.titleBox,
      read,
      status: m.status,
      nameReason: m.nameReason,
      printingReason: m.printingReason,
      chosenKey: m.chosen?.key ?? null,
      kind: c.kind,
      deckKey: c.key,
      ...(c.identityCandidates ? { identityCandidates: c.identityCandidates } : {}),
      ...(m.near ? { near: m.near } : {}),
      scores: m.scores,
      candidates: m.candidates,
    };
  });
  return {
    scanId: file,
    mode: 'deck',
    arm,
    photoQuality: out.photoQuality,
    rotation: tp.rotation,
    imageSize: { width, height },
    groups: out.groups.filter(g => !cp.merged.includes(g.id)),
    detections,
    crops: { cropped: cp.cropped, failed: cp.failed, skipped: cp.skipped, merged: cp.merged },
    usage: { model: r.model, latencyMs, attempts, costUsd, ...usage },
    stages: {
      encodeMs,
      read: { ms: r.latencyMs, in: r.usage.inputTokens, out: r.usage.outputTokens, cards: r.output.cards.length },
      turn: { ms: tp.latencyMs, in: tp.usage.inputTokens, out: tp.usage.outputTokens, calls: tp.calls, rotation: tp.rotation },
      crop: { ms: cp.latencyMs, in: cp.usage.inputTokens, out: cp.usage.outputTokens, calls: cp.calls },
    },
    file, status: 200, latencyMs: Date.now() - requestStart, attempts,
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const files = fs.readdirSync(o.photos)
    .filter(f => /\.(jpe?g|png|webp|heic)$/i.test(f) && (!o.only || o.only.has(f)))
    .sort();
  fs.mkdirSync(o.out, { recursive: true });
  const todo = files.filter(f => !fs.existsSync(path.join(o.out, `${f}.json`)));
  console.log(`${files.length} photos, ${todo.length} to run, arm ${JSON.stringify(o.arm)}`);
  let total = 0;
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      try {
        const rec = await runOne(file, o);
        if ('error' in rec) {
          fs.appendFileSync(path.join(o.out, 'errors.jsonl'), JSON.stringify({ file, ...rec }) + '\n');
          console.log(`[${++done}/${todo.length}] ${file} FAILED ${rec.error} ${JSON.stringify(rec.detail ?? {})}`);
          continue;
        }
        fs.writeFileSync(path.join(o.out, `${file}.json`), JSON.stringify(rec, null, 2));
        total += rec.usage.costUsd;
        const s = rec.stages;
        console.log(
          `[${++done}/${todo.length}] ${file}  read ${s.read.ms}ms/${s.read.out}tok/${s.read.cards}c  turn ${s.turn.ms}ms(${s.turn.rotation})  ` +
            `crop ${s.crop.ms}ms(${rec.crops.cropped.length})  total ${rec.latencyMs}ms  $${rec.usage.costUsd.toFixed(4)}  (sum $${total.toFixed(4)})`,
        );
      } catch (e) {
        fs.appendFileSync(path.join(o.out, 'errors.jsonl'), JSON.stringify({ file, thrown: String(e) }) + '\n');
        console.log(`[${++done}/${todo.length}] ${file} THREW ${String(e).slice(0, 200)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, todo.length) }, worker));
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
