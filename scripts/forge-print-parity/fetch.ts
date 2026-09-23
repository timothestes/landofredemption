// Pull the inputs for a print-parity A/B out of the Forge: the finished images of a set the
// design team composited from their Illustrator template (the "real" set) and the card data
// of the set the Forge renders (the "test" set), paired by card title. Reads .env.local for
// the private Blob token and the service-role key. Read-only against the DB and the store.
//
//   npx tsx --tsconfig scripts/forge-print-parity/tsconfig.json scripts/forge-print-parity/fetch.ts \
//       --real <set id> --test <set id> --out /abs/dir
//
// Writes <out>/finished/<id>.jpg (one per real card, keyed by the REAL card id),
// <out>/pairs.json (what compare.py measures against) and <out>/render-input.json (what
// render.ts draws, the test set's data under the real card's id).
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { get } from "@vercel/blob";
import { createClient } from "@supabase/supabase-js";
import type { DesignCard } from "@/app/forge/lib/designCard";
import { showsStats } from "@/app/forge/lib/frameAssets";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
}

type Row = { id: string; set_id: string; title: string | null; working_snapshot: DesignCard; working_finished_key: string | null };

const auth = process.env.FORGE_BLOB_READ_WRITE_TOKEN
  ? { token: process.env.FORGE_BLOB_READ_WRITE_TOKEN }
  : { storeId: process.env.FORGE_BLOB_STORE_ID! };

function statLabel(card: DesignCard): string | null {
  if (!showsStats(card)) return null;
  const f = (v: unknown) => (v === null || v === undefined || v === "" ? "?" : String(v));
  return `${f(card.strength)}/${f(card.toughness)}`;
}

async function main() {
  const realSet = arg("real"), testSet = arg("test"), out = arg("out");
  mkdirSync(path.join(out, "finished"), { recursive: true });
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb
    .from("forge_cards")
    .select("id,set_id,title,working_snapshot,working_finished_key")
    .in("set_id", [realSet, testSet])
    .limit(2000);
  if (error) throw error;
  const rows = data as Row[];
  const real = new Map(rows.filter((r) => r.set_id === realSet).map((r) => [r.title ?? "", r]));
  const test = rows.filter((r) => r.set_id === testSet);
  const pairs: Record<string, unknown> = {};
  const input: { id: string; data: DesignCard }[] = [];
  let downloaded = 0, missing = 0, unpaired = 0;
  for (const t of test) {
    const r = real.get(t.title ?? "");
    if (!r || !r.working_finished_key) { unpaired++; continue; }
    const file = path.join(out, "finished", `${r.id}.jpg`);
    if (!existsSync(file)) {
      const blob = await get(r.working_finished_key, { access: "private", ...auth });
      if (!blob || blob.statusCode !== 200 || !blob.stream) { missing++; continue; }
      writeFileSync(file, Buffer.from(await new Response(blob.stream).arrayBuffer()));
      downloaded++;
    }
    const card = t.working_snapshot ?? {};
    const ids = card.identifiers ?? [];
    pairs[r.id] = {
      title: card.name || t.title, test_id: t.id, types: card.cardType ?? [], brigades: card.brigades ?? null,
      stat: statLabel(card), reference: card.reference ?? null, id_text: ids.length ? ids.join(", ") : null,
    };
    input.push({ id: r.id, data: card });
  }
  writeFileSync(path.join(out, "pairs.json"), JSON.stringify(pairs, null, 1));
  writeFileSync(path.join(out, "render-input.json"), JSON.stringify(input, null, 1));
  console.log(`paired ${input.length} cards (downloaded ${downloaded}, unpaired ${unpaired}, blob missing ${missing})`);
  console.log(`wrote ${out}/pairs.json, render-input.json, finished/`);
}
main().catch((e) => { console.error(e); process.exit(1); });
