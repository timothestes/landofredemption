#!/usr/bin/env npx tsx
/**
 * Build lib/scan/generated/printingCues.json: for every printing in a
 * multi-printing identity, read the illustrator credit, copyright year and
 * printed promo caption off the catalog image with Claude.
 *
 * Usage: npx tsx scripts/scan-eval/build-cues.ts [--only-missing] [--concurrency 3]
 * Costs about $0.0023 an image (about $4.50 for a full run).
 */

import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '..', '.env.local') });

import Anthropic from '@anthropic-ai/sdk';
import { getScanIndex } from '../../lib/scan/stemIndex';
import { cardKey } from '../../lib/scan/vocab';
import { sanitizeImgFile } from '../../app/shared/utils/cardImageUrl';
import type { PrintingCue } from '../../lib/scan/cues';

const OUT = join(__dirname, '..', '..', 'lib', 'scan', 'generated', 'printingCues.json');
const MODEL = 'claude-sonnet-5-5';
const COST_PER_IMAGE = 0.0023;

const INSTRUCTION = `This is a catalog image of one Redemption CCG trading card. Transcribe exactly as printed: the title band at the top; the artist credit line near the bottom (for example "Illus. J.J. Tissot", "Illus. © Jamison Services, Inc.", "Illus. AI Generated", "Illus. Artist Unknown"); the four-digit year in the copyright line (for example "© 2025 Cactus Game Design, Inc." gives "2025"); and the promotional caption, which is any tournament, event, placement or promo wording printed on the card other than the title, ability, verse and credits (for example "State Redemption Tournament Participant", "Seasonal Redemption Promo", "Special Promo", "2nd Place Promo National Tournament", "25th Annual Redemption National Tournament, Knoxville, TN - August 1-3 2019", or a lone "P" in the corner). Return null for anything not present or unreadable. Do not guess.`;

const S = ['string', 'null'];
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: S }, illustrator: { type: S }, copyrightYear: { type: S }, caption: { type: S },
  },
  required: ['title', 'illustrator', 'copyrightYear', 'caption'],
};

function parseArgs(argv: string[]) {
  const onlyMissing = argv.includes('--only-missing');
  const ci = argv.indexOf('--concurrency');
  const concurrency = ci >= 0 ? Math.max(1, parseInt(argv[ci + 1], 10) || 3) : 3;
  return { onlyMissing, concurrency };
}

function loadExisting(): Record<string, PrintingCue> {
  return existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
}

async function readImage(client: Anthropic, url: string): Promise<PrintingCue | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = Buffer.from(await res.arrayBuffer()).toString('base64');
  const call = () => client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
      { type: 'text', text: INSTRUCTION },
    ] }],
  });
  let msg;
  try {
    msg = await call();
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status !== undefined && (status >= 500 || status === 529)) {
      await new Promise((r) => setTimeout(r, 2000));
      msg = await call();
    } else throw e;
  }
  const block = msg.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') return null;
  const p = JSON.parse(block.text) as { illustrator: string | null; copyrightYear: string | null; caption: string | null };
  return { illustrator: p.illustrator ?? null, year: p.copyrightYear ?? null, caption: p.caption ?? null };
}

async function main() {
  const { onlyMissing, concurrency } = parseArgs(process.argv.slice(2));
  const table = loadExisting();

  const wanted: { key: string; imgFile: string }[] = [];
  for (const id of getScanIndex().identities.values()) {
    if (id.cards.length < 2) continue;
    for (const c of id.cards) wanted.push({ key: cardKey(c), imgFile: c.imgFile });
  }
  const todo = onlyMissing ? wanted.filter((w) => !(w.key in table)) : wanted;
  console.log(`${wanted.length} printings in multi-printing identities, ${todo.length} to fetch`);
  if (todo.length === 0) return;

  const base = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  const apiKey = process.env.SCANNER_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!base || !apiKey) {
    console.error('Need NEXT_PUBLIC_BLOB_BASE_URL and SCANNER_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY)');
    process.exit(1);
  }
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  let next = 0, done = 0, failed = 0;
  const stats = { illustrator: 0, year: 0, caption: 0 };
  async function worker() {
    while (next < todo.length) {
      const w = todo[next++];
      try {
        const cue = await readImage(client, `${base}/card-images/${sanitizeImgFile(w.imgFile)}.jpg`);
        if (cue) {
          table[w.key] = cue;
          if (cue.illustrator) stats.illustrator++;
          if (cue.year) stats.year++;
          if (cue.caption) stats.caption++;
          done++;
        } else failed++;
      } catch (e) {
        failed++;
        console.error(`failed ${w.key}: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const sorted: Record<string, PrintingCue> = {};
  for (const k of Object.keys(table).sort()) sorted[k] = table[k];
  writeFileSync(OUT, JSON.stringify(sorted, null, 1) + '\n');

  const pct = (n: number) => (done ? ((100 * n) / done).toFixed(1) : '0.0');
  console.log(`wrote ${Object.keys(sorted).length} entries (${done} read, ${failed} failed)`);
  console.log(`read rates: illustrator ${pct(stats.illustrator)}%, year ${pct(stats.year)}%, caption ${pct(stats.caption)}%`);
  console.log(`cost about $${(done * COST_PER_IMAGE).toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
