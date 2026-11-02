/**
 * Crop-pass replay: re-runs the deck crop pass on recorded first passes (outputs of `run.ts --mode deck`),
 * calling Claude directly, so the pass can be tuned without the deployed preview. Needs SCANNER_ANTHROPIC_API_KEY
 * (loaded from .env.local, or the file named by ENV_FILE). Score the result with deckScore.ts.
 *
 *   npx tsx scripts/scan-eval/cropReplay.ts --in scripts/scan-eval/outputs/deck-<arm>/ \
 *     --photos scripts/scan-eval/photos-deck --out scripts/scan-eval/outputs/deck-<arm>-crops/ \
 *     [--only <file>,<file>] [--deadline-ms 140000] [--skip-cropped 1]
 *
 * --only takes photo file names (e.g. 20260811_134449.webp), comma separated; --deadline-ms is each photo's crop budget.
 * --skip-cropped leaves the groups the recording already cropped as they are (their reads are crop reads, not a first
 * pass), so a recording from the route replays only what a changed crop rule adds. A recording of a turned photo
 * (`rotation` in the response) is replayed turned the same way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { runCropPass } from '@/lib/scan/cropPass';
import { inferSidewaysRows } from '@/lib/scan/crop';
import { encodeForScan, type Turn } from '@/lib/scan/image';
import { matchDetection } from '@/lib/scan/match';
import { capDetection } from '@/lib/scan/schema';
import { DECK_DETECTION_CAP, type DeckOutput, type DeckRead } from '@/lib/scan/deckSchema';
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
  if (!f.in) throw new Error('--in is required');
  const deadlineMs = f['deadline-ms'] ? Number(f['deadline-ms']) : 140_000;
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw new Error('--deadline-ms must be a positive number');
  return {
    in: f.in,
    photos: f.photos ?? 'scripts/scan-eval/photos-deck',
    out: f.out ?? `${f.in.replace(/\/+$/, '')}-crops`,
    only: f.only ? new Set(f.only.split(',').map(s => s.trim()).filter(Boolean)) : null,
    deadlineMs,
    skipCropped: f['skip-cropped'] === '1',
  };
}

/** The first pass as the crop pass takes it: groups as stored, each detection back to the read it came from. */
function toDeckOutput(rec: { photoQuality: DeckOutput['photoQuality']; groups: DeckOutput['groups']; detections: DeckDetection[] }): DeckOutput {
  const cards: DeckRead[] = rec.detections.map(d => ({
    title: d.read.title, strength: d.read.strength, toughness: d.read.toughness, type: d.read.type,
    brigade: d.read.brigade, reference: d.read.reference,
    group: d.group, position: d.position, titleBox: d.titleBox, confidence: d.read.confidence,
  }));
  return { photoQuality: rec.photoQuality, groups: rec.groups, cards };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const files = fs.readdirSync(o.in)
    .filter(f => f.endsWith('.json') && f !== 'errors.jsonl')
    .map(f => f.slice(0, -'.json'.length))
    .filter(f => !o.only || o.only.has(f))
    .sort();
  console.log(`${files.length} photos`);
  fs.mkdirSync(o.out, { recursive: true });

  let total = 0;
  for (const file of files) {
    const rec = JSON.parse(fs.readFileSync(path.join(o.in, `${file}.json`), 'utf8'));
    const photo = path.join(o.photos, file);
    if (!fs.existsSync(photo)) {
      console.warn(`${file}: photo not found at ${photo}, skipped`);
      continue;
    }
    const t0 = Date.now();
    const bytes = fs.readFileSync(photo);
    // A recording of a turned photo has its groups in the turned frame: the replay turns the photo the same way.
    const turn = (rec.rotation ?? 0) as Turn;
    const { width, height } = await encodeForScan(bytes, 'high', turn);
    const first = toDeckOutput(rec);
    const out = { ...first, groups: inferSidewaysRows(first.groups, width, height) };
    // Groups left out of the crop pass's input keep their reads unchanged (runCropPass passes unlisted groups through).
    const done = new Set<number>(o.skipCropped ? rec.crops?.cropped ?? [] : []);
    const cp = await runCropPass({ upload: bytes, turn }, { ...out, groups: out.groups.filter(g => !done.has(g.id)) }, { width, height }, Date.now() + o.deadlineMs);
    for (const { group, code, detail } of cp.failures) console.error(`  crop failed group ${group}: ${code}`, detail ?? '');

    // Classified exactly as the route does, with an empty price map.
    const detections: DeckDetection[] = cp.cards.slice(0, DECK_DETECTION_CAP).map((deckRead, i) => {
      const read = capDetection(deckReadToDetection(deckRead));
      const m = matchDetection(read, {});
      const c = classifyDeckRead(deckRead, m);
      return {
        id: `${rec.scanId}:${i}`,
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

    const wall = Date.now() - t0;
    const record = {
      scanId: rec.scanId,
      mode: 'deck',
      photoQuality: rec.photoQuality,
      rotation: turn,
      imageSize: { width, height },
      groups: out.groups.filter(g => !cp.merged.includes(g.id)),
      detections,
      crops: { cropped: [...done, ...cp.cropped].sort((a, b) => a - b), failed: cp.failed, skipped: cp.skipped, merged: cp.merged },
      usage: { model: rec.usage?.model, latencyMs: cp.latencyMs, attempts: cp.calls, costUsd: cp.costUsd },
      file, status: 200, latencyMs: wall, attempts: cp.calls,
    };
    fs.writeFileSync(path.join(o.out, `${file}.json`), JSON.stringify(record, null, 2));
    total += cp.costUsd;
    console.log(`${file}  cropped [${cp.cropped}]  merged [${cp.merged}]  failed [${cp.failed}]  skipped [${cp.skipped}]  $${cp.costUsd.toFixed(4)}  ${wall}ms  (total $${total.toFixed(4)})`);
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
