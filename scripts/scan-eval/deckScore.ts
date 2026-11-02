/**
 * Deck-photo scorer: labels-deck.json against `run.ts --mode deck` outputs.
 * Name-stem multiset precision/recall per photo (any printing of the labeled card counts), Lost Soul and group-size
 * errors, and whether the default Reserve group is right. Pure apart from main().
 *
 *   npx tsx scripts/scan-eval/deckScore.ts --labels scripts/scan-eval/labels-deck.json \
 *     --outputs scripts/scan-eval/outputs/deck-<arm>/ [--rematch]
 *
 * --rematch ignores the recorded match fields and runs the current matcher and classifier over the recorded reads, with no
 * prices (as cropReplay.ts does), so a matcher change can be scored on saved outputs without a model call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CARDS } from '@/lib/cards/lookup';
import { getScanIndex } from '@/lib/scan/stemIndex';
import { cardKey } from '@/lib/scan/vocab';
import { defaultReserveGroups, IDENTIFIED_KINDS, type GroupSize } from '@/lib/scan/deck';
import { classifyDeckRead, deckReadToDetection, type DeckDetection, type DeckScanResponse } from '@/lib/scan/deckClassify';
import type { DeckRead } from '@/lib/scan/deckSchema';
import { matchDetection } from '@/lib/scan/match';
import { capDetection } from '@/lib/scan/schema';

export interface DeckLabel {
  photo: string;
  cards: { name: string; qty: number }[];
  lostSouls: number;
  reserveSize: number;
  unreadable: number;
}

export interface DeckPhotoScore {
  photo: string;
  precision: number;
  recall: number;
  invented: number;
  lostSoulError: number;
  reserveDefaultRight: boolean;
  groupCountError: number;
  costUsd: number | null;
  latencyMs: number | null;
  /** Groups the crop pass re-read; null when the output predates the crop pass. */
  crops: number | null;
}

let byKey: Map<string, (typeof CARDS)[number]> | null = null;
let byName: Map<string, (typeof CARDS)[number]> | null = null;

function lookups() {
  if (!byKey || !byName) {
    byKey = new Map();
    byName = new Map();
    for (const c of CARDS) {
      byKey.set(cardKey(c), c);
      if (!byName.has(c.name)) byName.set(c.name, c);
    }
  }
  return { byKey, byName };
}

const add = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

export function scoreDeckPhoto(label: DeckLabel, resp: DeckScanResponse): DeckPhotoScore {
  const idx = getScanIndex();
  const { byKey, byName } = lookups();

  // Keyed by the identity's normalized name stem: a deck needs the card, and the exact printing is a non-goal.
  const truth = new Map<string, number>();
  let truthTotal = 0;
  for (const { name, qty } of label.cards) {
    const card = byName.get(name);
    if (!card) throw new Error(`${label.photo}: unknown card name "${name}"`);
    add(truth, idx.identityOf(card).normalizedStem, qty);
    truthTotal += qty;
  }

  const pred = new Map<string, number>();
  let predTotal = 0;
  let lostSoulSeen = 0;
  for (const d of resp.detections) {
    if (d.kind === 'lost_soul') {
      lostSoulSeen++;
      continue;
    }
    if ((d.kind !== 'matched' && d.kind !== 'which') || !d.deckKey) continue;
    const card = byKey.get(d.deckKey);
    if (!card) continue;
    const id = idx.identityOf(card);
    if (id.lostSoul) {
      lostSoulSeen++;
      continue;
    }
    add(pred, id.normalizedStem);
    predTotal++;
  }

  let hits = 0;
  let invented = 0;
  for (const [k, n] of pred) {
    hits += Math.min(n, truth.get(k) ?? 0);
    if (!truth.has(k)) invented += n;
  }

  const sizes: GroupSize[] = resp.groups.map(g => ({
    key: `0:${g.id}`,
    orientation: g.orientation,
    count: resp.detections.filter(d => d.group === g.id).length,
    bbox: g.bbox,
    identified: resp.detections.filter(d => d.group === g.id && IDENTIFIED_KINDS.has(d.kind)).length,
  }));
  // By size only: the labels do not say which group is the Reserve, so a wrong group of the right size passes.
  const reserve = new Set(defaultReserveGroups(sizes));
  const reserveDefaultRight = sizes.filter(g => reserve.has(g.key)).reduce((n, g) => n + g.count, 0) === label.reserveSize;

  // label.cards already leaves out the unreadable cards, so truthTotal is the recall denominator as is.
  const denom = truthTotal;
  return {
    photo: label.photo,
    precision: predTotal ? hits / predTotal : 1,
    recall: denom ? Math.min(1, hits / denom) : 1,
    invented,
    lostSoulError: Math.abs(lostSoulSeen - label.lostSouls),
    reserveDefaultRight,
    groupCountError: sizes.reduce((n, g, i) => n + Math.abs(resp.groups[i].cardCount - g.count), 0),
    costUsd: typeof resp.usage?.costUsd === 'number' ? resp.usage.costUsd : null,
    latencyMs: typeof resp.usage?.latencyMs === 'number' ? resp.usage.latencyMs : null,
    crops: Array.isArray(resp.crops?.cropped) ? resp.crops.cropped.length : null,
  };
}

/** The recorded reads matched and classified again by the current code, with no prices; every match field is replaced. */
export function rematchResponse(resp: DeckScanResponse): DeckScanResponse {
  const detections: DeckDetection[] = resp.detections.map(d => {
    const deckRead: DeckRead = {
      title: d.read.title, strength: d.read.strength, toughness: d.read.toughness, type: d.read.type,
      brigade: d.read.brigade, reference: d.read.reference,
      group: d.group, position: d.position, titleBox: d.titleBox, confidence: d.read.confidence,
    };
    const read = capDetection(deckReadToDetection(deckRead));
    const m = matchDetection(read, {});
    const c = classifyDeckRead(deckRead, m);
    return {
      id: d.id, group: d.group, position: d.position, titleBox: d.titleBox, read,
      status: m.status, nameReason: m.nameReason, printingReason: m.printingReason,
      chosenKey: m.chosen?.key ?? null, kind: c.kind, deckKey: c.key,
      ...(c.identityCandidates ? { identityCandidates: c.identityCandidates } : {}),
      ...(m.near ? { near: m.near } : {}),
      scores: m.scores, candidates: m.candidates,
    };
  });
  return { ...resp, detections };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function parseArgs(argv: string[]) {
  const f: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    if (a === '--rematch') { f.rematch = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    f[a.slice(2)] = v;
  }
  if (typeof f.labels !== 'string') throw new Error('--labels is required');
  if (typeof f.outputs !== 'string') throw new Error('--outputs is required');
  return { labels: f.labels, outputs: f.outputs, rematch: f.rematch === true };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const labels: DeckLabel[] = JSON.parse(fs.readFileSync(o.labels, 'utf8'));
  const scores: DeckPhotoScore[] = [];
  const missing: string[] = [];
  for (const l of labels) {
    const f = path.join(o.outputs, `${l.photo}.json`);
    if (!fs.existsSync(f)) {
      missing.push(l.photo);
      continue;
    }
    const recorded: DeckScanResponse = JSON.parse(fs.readFileSync(f, 'utf8'));
    const s = scoreDeckPhoto(l, o.rematch ? rematchResponse(recorded) : recorded);
    scores.push(s);
    console.log(
      `${s.photo}  P ${s.precision.toFixed(3)}  R ${s.recall.toFixed(3)}  invented ${s.invented}  LS err ${s.lostSoulError}  ` +
        `reserve ${s.reserveDefaultRight ? 'ok' : 'WRONG'}  group err ${s.groupCountError}  ` +
        `crops ${s.crops ?? ''}  $${s.costUsd?.toFixed(4) ?? '?'}  ${s.latencyMs ?? '?'}ms`,
    );
  }
  if (missing.length) console.warn(`labeled photos with no output (${missing.length}): ${missing.join(', ')}`);
  const costs = scores.map(s => s.costUsd).filter((x): x is number => x !== null);
  const lats = scores.map(s => s.latencyMs).filter((x): x is number => x !== null);
  console.log(
    `\n${scores.length} photos  mean P ${mean(scores.map(s => s.precision)).toFixed(3)}  mean R ${mean(scores.map(s => s.recall)).toFixed(3)}  ` +
      `mean invented ${mean(scores.map(s => s.invented)).toFixed(2)}  mean LS err ${mean(scores.map(s => s.lostSoulError)).toFixed(2)}  ` +
      `reserve right ${scores.filter(s => s.reserveDefaultRight).length}/${scores.length}  mean group err ${mean(scores.map(s => s.groupCountError)).toFixed(2)}  ` +
      `mean $${mean(costs).toFixed(4)}  mean ${Math.round(mean(lats))}ms`,
  );
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
