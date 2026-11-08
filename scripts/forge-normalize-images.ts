/**
 * One-off backfill: run every blob referenced by forge_cards/card_versions
 * through the Forge image normalizer (trim white print-bleed margins, cap
 * 1050px tall, re-encode JPEG). Conforming blobs are skipped byte-identically.
 * Rewritten images get a NEW key; referencing rows are re-pointed and the
 * card's updated_at is touched (busts the working-view `t` cache param).
 * Also sweeps 44 known-orphaned 1x1 blobs (2026-07-06 survey), re-verified
 * unreferenced at run time.
 *
 * Design: docs/superpowers/specs/2026-07-06-forge-image-normalization-design.md
 *
 * Usage: npx tsx scripts/forge-normalize-images.ts [--apply]
 * Default is dry-run: prints the plan, writes nothing.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { put, get, del } from "@vercel/blob";
import { normalizeCardImage } from "../app/forge/lib/imageNormalize";

const APPLY = process.argv.includes("--apply");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
const auth = process.env.FORGE_BLOB_READ_WRITE_TOKEN
  ? { token: process.env.FORGE_BLOB_READ_WRITE_TOKEN }
  : { storeId: process.env.FORGE_BLOB_STORE_ID! };

type Ref = { table: "forge_cards" | "card_versions"; id: string; column: string; cardId: string };

// Orphaned 1x1 JPEG blobs found in the 2026-07-06 store survey. None are
// referenced by forge_cards or card_versions (verified then and re-verified
// against live refs below before deletion).
const ORPHANED_1X1: string[] = [
  "forge-finished/022d0513-7a80-4f88-8726-f9768fb58837",
  "forge-finished/035b56cd-469a-410d-9487-ef0afa3cf8b0",
  "forge-finished/04c17b40-b699-4189-b9c9-2a148d003d98",
  "forge-finished/087c415c-fe60-415b-b4cf-0d6a7ebf1deb",
  "forge-finished/098fea86-a8d6-4468-a0c2-9d8f00adb4ca",
  "forge-finished/1918ce3f-41d1-4f47-b49d-c76e922591ca",
  "forge-finished/1c72f871-5eaa-4ad6-9bf6-890f6ace9ef1",
  "forge-finished/1d84410e-14cd-42ef-af63-b69412946d00",
  "forge-finished/2c2c78cd-cc64-4b1b-a384-ea1f2e52c07b",
  "forge-finished/31431ea6-1536-41ca-bdc6-d6afd2fca203",
  "forge-finished/40d26f6a-95d6-45cc-96e4-b87c8d0afd8e",
  "forge-finished/4cbd58ad-b590-455b-8f85-e863a5febea1",
  "forge-finished/4fc72d08-d338-4e31-a6b6-7ca0e678edb7",
  "forge-finished/6b214645-356d-450e-bc48-177ecce1bd2e",
  "forge-finished/700a0e8d-117e-4fca-87cb-bceb952eca69",
  "forge-finished/75e1a10a-ae52-4463-bef4-1b9ddeda2925",
  "forge-finished/77ceee10-a2dc-4594-96b2-46649ae4d3cc",
  "forge-finished/7b47fb10-c478-49ed-bc60-137769887ced",
  "forge-finished/805141d5-c4ed-4d04-a50b-e130f13a9ab9",
  "forge-finished/8d238df4-7629-4aa7-a8cd-614f55b7dcc4",
  "forge-finished/9542375d-9279-4839-973b-7587079d7905",
  "forge-finished/99a2cf80-c2a8-430e-ace9-8c01ccec704c",
  "forge-finished/9a313283-e34a-423e-9383-9aa9c68c238e",
  "forge-finished/9eaba425-d56e-4dab-8719-032d1a9c351f",
  "forge-finished/9f141a4a-03a3-4118-b691-5cbf7289ea60",
  "forge-finished/a797a8ff-778b-42fc-b689-5cfca6b5a9c1",
  "forge-finished/b427c7a8-55cb-40e6-ba62-f8f40d5406f4",
  "forge-finished/b64a6b56-d3b5-4f81-bef0-547efebcaceb",
  "forge-finished/c19f047f-b9ae-4899-bb13-16d64137846d",
  "forge-finished/c6121e2e-6573-4411-83d7-3b76b19abb8a",
  "forge-finished/cbd4bf29-38c5-49bd-bad8-41a87f9a7f5d",
  "forge-finished/d382c831-6855-4dc4-bd1c-49bd9dfd3226",
  "forge-finished/d451d556-d37e-42de-932f-885618bb8d69",
  "forge-finished/d576be34-4700-4980-aafb-946feedeb69a",
  "forge-finished/dedc057b-00ee-45aa-b59b-f6c54177bf25",
  "forge-finished/dfff9e02-6ea8-49fc-8631-83422e3d8ee5",
  "forge-finished/ea44811a-9596-4392-adbb-dc837ab1cacf",
  "forge-finished/e996aa36-e969-44b7-9d45-da8b846efc89",
  "forge-finished/ea461c64-0168-4eac-bb76-61bddb6c6785",
  "forge-finished/ec18221d-a1ef-4c3e-8688-a443f851c40c",
  "forge-finished/ed31e18f-2304-4a8f-be2b-4aad31607eec",
  "forge-finished/efb442d5-7e90-454d-b95c-4278cb2bba77",
  "forge-finished/f1408b2c-97b9-46d3-ac19-c7e619f59298",
  "forge-finished/fca38891-2d65-4b19-9aba-614d1aabd8da",
];

async function collectRefs(): Promise<Map<string, Ref[]>> {
  const refs = new Map<string, Ref[]>();
  const add = (key: string | null, ref: Ref) => {
    if (!key) return;
    refs.set(key, [...(refs.get(key) ?? []), ref]);
  };
  // PostgREST returns at most 1000 rows per request with no error, and both tables are past that.
  // A row missed here would keep its old key while the rewrite loop deletes that blob.
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: cards, error: cardsErr } = await supabase
      .from("forge_cards")
      .select("id, working_art_key, working_art_original_key, working_finished_key")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (cardsErr) throw cardsErr;
    for (const c of cards ?? []) {
      for (const col of ["working_art_key", "working_art_original_key", "working_finished_key"] as const) {
        add(c[col], { table: "forge_cards", id: c.id, column: col, cardId: c.id });
      }
    }
    if (!cards || cards.length < PAGE_SIZE) break;
  }
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data: versions, error: versionsErr } = await supabase
      .from("card_versions")
      .select("id, card_id, art_key, art_original_key, finished_key")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (versionsErr) throw versionsErr;
    for (const v of versions ?? []) {
      for (const col of ["art_key", "art_original_key", "finished_key"] as const) {
        add(v[col], { table: "card_versions", id: v.id, column: col, cardId: v.card_id });
      }
    }
    if (!versions || versions.length < PAGE_SIZE) break;
  }
  return refs;
}

async function download(key: string): Promise<Buffer> {
  const res = await get(key, { access: "private", ...auth });
  if (!res || res.statusCode !== 200) throw new Error(`GET ${key} -> ${res?.statusCode}`);
  const chunks: Buffer[] = [];
  for await (const chunk of res.stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main() {
  const refs = await collectRefs();
  console.log(`${refs.size} referenced blob keys; mode=${APPLY ? "APPLY" : "dry-run"}`);
  let rewritten = 0, skipped = 0, failed = 0;
  const touchedCards = new Set<string>();

  for (const [key, refList] of refs) {
    let input: Buffer;
    try {
      input = await download(key);
    } catch (e) {
      console.error(`FAIL download ${key}: ${e}`);
      failed++;
      continue;
    }
    let out: Awaited<ReturnType<typeof normalizeCardImage>>;
    try {
      out = await normalizeCardImage(input);
    } catch (e) {
      console.error(`FAIL normalize ${key} (${input.length}B): ${e}`);
      failed++;
      continue;
    }
    if (out.data.equals(input)) {
      skipped++;
      continue;
    }

    console.log(
      `rewrite ${key} (${input.length}B -> ${out.data.length}B) refs=${refList
        .map((r) => `${r.table}.${r.column}`)
        .join(",")}`
    );
    rewritten++;
    if (!APPLY) continue;

    const newKey = `${key.split("/")[0]}/${randomUUID()}`;
    await put(newKey, out.data, {
      access: "private",
      addRandomSuffix: false,
      contentType: out.contentType,
      ...auth,
    });
    for (const ref of refList) {
      // WHERE <col> = <old key> guards against an elder replacing the art between
      // collectRefs() and this write. A 0-row update is a silent no-op in
      // supabase-js (no error) — that's correct: the ref moved on, our blob dangles.
      const { error } = await supabase
        .from(ref.table)
        .update({ [ref.column]: newKey })
        .eq("id", ref.id)
        .eq(ref.column, key);
      if (error) throw new Error(`UPDATE ${ref.table}.${ref.column} for ${ref.id}: ${error.message}`);
      touchedCards.add(ref.cardId);
    }
    try {
      await del(key, { ...auth });
    } catch {
      // a dangling private+UUID blob is invisible and harmless
    }
  }

  if (APPLY) {
    for (const cardId of touchedCards) {
      const { error } = await supabase
        .from("forge_cards")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", cardId);
      if (error) console.error(`FAIL touch updated_at for ${cardId}: ${error.message}`);
    }
  }

  let swept = 0;
  for (const key of ORPHANED_1X1) {
    if (refs.has(key)) {
      console.error(`SKIP orphan ${key}: now referenced!`);
      continue;
    }
    console.log(`delete orphan ${key}`);
    if (APPLY) {
      try {
        await del(key, { ...auth });
        swept++;
      } catch (e) {
        console.error(`FAIL delete orphan ${key}: ${e}`);
      }
    }
  }

  console.log(
    `done: ${rewritten} rewritten, ${skipped} conforming (skipped), ${failed} failed, ` +
      `${APPLY ? swept : ORPHANED_1X1.length} orphans ${APPLY ? "deleted" : "to delete"}`
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
