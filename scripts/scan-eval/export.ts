#!/usr/bin/env npx tsx
/**
 * E3 audit export: writes a label-file skeleton (the scorer's labels format) for Tim to
 * correct. One entry per scan photo; `file` is the scanId, `cards[].printing` is the
 * chosenKey the scanner picked (null for not_found), `setVisible` is null for Tim to fill.
 * Samples COMMITTED cards only (scans with outcomes); --limit counts cards. Half the sample is
 * untouched Matched cards (matched, no correction), the rest other committed cards.
 * Depends on the provisional outcomes shape (see queries.sql) until PR C ships.
 *
 * Usage: npx tsx scripts/scan-eval/export.ts --since 2026-11-10 --limit 100 \
 *          --out scripts/scan-eval/audit-2026-11-24.json
 * Reads the service-role env from .env.local (production). Read-only.
 */

import { join } from 'path';
import { writeFileSync } from 'fs';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '..', '.env.local') });

import { getSupabaseAdmin } from '../../lib/pricing/supabase-admin';

export interface Args { since: string; limit: number; out: string }

export interface LabelCard { printing: string | null; setVisible: null; inFrame: 'full' | 'partial'; grid: { row: number; col: number } | null }
export interface LabelPhoto { file: string; bucket: string; tags: string[]; otherGame: boolean; cards: LabelCard[] }

interface Detection { id?: string; status?: string; chosenKey?: string | null; grid?: { row: number; col: number } | null }
// PROVISIONAL until PR C writes outcomes: assumed shape, identical to queries.sql's `committed` CTE.
interface Outcome { id?: string; nameChanged?: boolean; printingChanged?: boolean; removedAs?: string | null; unresolved?: boolean }
interface EventRow { id: string; outcomes: Outcome[] | null; detections: Detection[] }
interface Card { scanId: string; det: Detection; untouchedMatched: boolean }

export function parseArgs(argv: string[]): Args {
  const f: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument: ${argv[i]}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${argv[i - 1]}`);
    f[argv[i - 1].slice(2)] = v;
  }
  if (!f.since || Number.isNaN(Date.parse(f.since))) throw new Error('--since <date> is required');
  if (!f.out) throw new Error('--out <file> is required');
  const limit = f.limit ? Number(f.limit) : 100;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  return { since: f.since, limit, out: f.out };
}

function shuffle<T>(a: T[]): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/**
 * Committed detections of committed scans only (outcomes not null), same predicate as the
 * `committed` CTE in queries.sql: each detection joined to its outcome by id; entries removed
 * as 'unwanted' or left unresolved are dropped. "Untouched Matched" = detection status
 * 'matched' and no correction (name/printing changed, or removed as 'wrong').
 */
export function committedCards(events: EventRow[]): Card[] {
  const cards: Card[] = [];
  for (const e of events) {
    if (!Array.isArray(e.outcomes) || !Array.isArray(e.detections)) continue;
    for (const det of e.detections) {
      const o = e.outcomes.find(x => x?.id === det.id);
      if (!o || o.removedAs === 'unwanted' || o.unresolved === true) continue;
      const corrected = o.nameChanged === true || o.printingChanged === true || o.removedAs === 'wrong';
      cards.push({ scanId: e.id, det, untouchedMatched: det.status === 'matched' && !corrected });
    }
  }
  return cards;
}

/** Half the cards from untouched Matched, the rest from other committed cards; either pool backfills. */
export function stratify(cards: Card[], limit: number): Card[] {
  const a = shuffle(cards.filter(c => c.untouchedMatched));
  const b = shuffle(cards.filter(c => !c.untouchedMatched));
  const takeA = Math.min(a.length, Math.max(Math.ceil(limit / 2), limit - b.length));
  const picked = a.slice(0, takeA);
  return picked.concat(b.slice(0, limit - picked.length));
}

/**
 * One photo entry per scan, holding only the sampled cards: the audit scores identity and
 * printing accuracy of committed cards, so a photo's other cards are deliberately absent
 * (do not read photo-level recall from an audit file).
 */
export function toSkeleton(picked: Card[]): LabelPhoto[] {
  const byScan = new Map<string, LabelPhoto>();
  for (const c of picked) {
    let p = byScan.get(c.scanId);
    if (!p) byScan.set(c.scanId, (p = { file: c.scanId, bucket: 'audit', tags: [], otherGame: false, cards: [] }));
    p.cards.push({ printing: c.det.chosenKey ?? null, setVisible: null, inFrame: 'full', grid: c.det.grid ?? null });
  }
  return [...byScan.values()];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportAudit(supabase: any, args: Args): Promise<LabelPhoto[]> {
  const rows: EventRow[] = [];
  const PAGE = 1000; // PostgREST caps a select at 1000 rows: page explicitly
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('scan_events')
      .select('id, outcomes, detections')
      .eq('source', 'player')
      .eq('status', 'done')
      .not('detections', 'is', null)
      .not('outcomes', 'is', null)
      .gte('created_at', new Date(args.since).toISOString())
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`scan_events query failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return toSkeleton(stratify(committedCards(rows), args.limit));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const skeleton = await exportAudit(getSupabaseAdmin(), args);
  writeFileSync(args.out, JSON.stringify(skeleton, null, 2) + '\n');
  console.log(`Wrote ${skeleton.length} photos (${skeleton.reduce((n, p) => n + p.cards.length, 0)} cards) to ${args.out}`);
}

if (typeof require !== 'undefined' && require.main === module) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
