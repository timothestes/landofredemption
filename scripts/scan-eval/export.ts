#!/usr/bin/env npx tsx
/**
 * E3 audit export: writes a label-file skeleton (the scorer's labels format) for Tim to
 * correct. One entry per scan photo; `file` is the scanId, `cards[].printing` is the
 * chosenKey the scanner picked (null for not_found), `setVisible` is null for Tim to fill.
 * Sampling over-samples untouched Matched rows: half of the sample comes from scans with
 * no outcomes, the rest from scans that have them (either pool backfills the other).
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

interface EventRow { id: string; outcomes: unknown; detections: Array<{ chosenKey?: string | null; grid?: { row: number; col: number } | null }> }

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

/** Half the sample from rows with no outcome, the rest from rows with one; backfill from whichever has more. */
export function stratify(untouched: EventRow[], touched: EventRow[], limit: number): EventRow[] {
  const half = Math.ceil(limit / 2);
  const a = shuffle(untouched);
  const b = shuffle(touched);
  const takeA = Math.min(a.length, Math.max(half, limit - b.length));
  const pickedA = a.slice(0, takeA);
  return pickedA.concat(b.slice(0, limit - pickedA.length));
}

export function toSkeleton(e: EventRow): LabelPhoto {
  return {
    file: e.id,
    bucket: 'audit',
    tags: [],
    otherGame: false,
    cards: e.detections.map(d => ({ printing: d.chosenKey ?? null, setVisible: null, inFrame: 'full' as const, grid: d.grid ?? null })),
  };
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
      .gte('created_at', new Date(args.since).toISOString())
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`scan_events query failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  const usable = rows.filter(r => Array.isArray(r.detections) && r.detections.length > 0);
  const picked = stratify(usable.filter(r => r.outcomes == null), usable.filter(r => r.outcomes != null), args.limit);
  return picked.map(toSkeleton);
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
