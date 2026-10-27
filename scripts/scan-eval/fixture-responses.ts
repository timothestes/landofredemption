/**
 * Builds ScanResponse fixtures for the scan page without calling Anthropic.
 *
 *   npx tsx scripts/scan-eval/fixture-responses.ts <out.json> [n]
 *
 * Reads the recorded catalog run, maps each row's detections exactly as
 * app/api/scan/route.ts does, and writes ScanResponse[]. Prices come from the
 * live price map when .env.local allows it, else {} (candidates carry no price).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { loadPriceMap } from '../../lib/scan/prices';
import { matchDetection } from '../../lib/scan/match';
import { capDetection } from '../../lib/scan/schema';
import type { ScanResponse } from '../../app/collection/scan/types';

config({ path: '.env.local' });

async function main() {
  const [out, nArg] = process.argv.slice(2);
  if (!out) throw new Error('usage: fixture-responses.ts <out.json> [n]');
  const n = Number(nArg) || 6;

  const recorded = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'outputs', 'catalog-sonnet55-low-v4.json'), 'utf8'),
  ) as { rows: { id: string; detections: unknown[] }[] };

  let prices: Awaited<ReturnType<typeof loadPriceMap>> = {} as Awaited<ReturnType<typeof loadPriceMap>>;
  try {
    prices = await loadPriceMap();
  } catch (e) {
    console.warn('price map unavailable, using {}:', (e as Error).message);
  }

  const responses = recorded.rows.slice(0, n).map((row): ScanResponse => {
    const scanId = randomUUID();
    const detections = row.detections.map((card, i) => {
      const read = capDetection(card as Parameters<typeof capDetection>[0]);
      const m = matchDetection(read, prices);
      return {
        id: `${scanId}:${i}`,
        grid: read.grid,
        orientation: read.orientation,
        read,
        status: m.status,
        nameReason: m.nameReason,
        printingReason: m.printingReason,
        chosenKey: m.chosen?.key ?? null,
        scores: m.scores,
        candidates: m.candidates,
      };
    });
    return {
      scanId,
      photoQuality: 'ok',
      detections: detections as unknown as ScanResponse['detections'],
      usage: { model: 'claude-sonnet-5-5', latencyMs: 4000, attempts: 1 },
    };
  });

  fs.writeFileSync(out, JSON.stringify(responses, null, 2));
  const matched = responses.flatMap(r => r.detections).filter(d => d.status === 'matched');
  console.log(
    `wrote ${responses.length} responses, ${responses.flatMap(r => r.detections).length} detections, ` +
      `${matched.length} matched (${matched.filter(d => d.candidates.length >= 1).length} with candidates), ` +
      `prices: ${Object.keys(prices).length} keys`,
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
