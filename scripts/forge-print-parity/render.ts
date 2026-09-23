// Render Forge cards through the SAME server renderer play surfaces use (renderCard.ts),
// with the licensed faces read from a local dir, so the output can be registered against the
// design team's finished images pixel for pixel. No DB, no Blob: input is a JSON list of
// { id, data } and the output is one 750x1050 JPEG per card.
//
//   npx tsx --tsconfig scripts/forge-print-parity/tsconfig.json scripts/forge-print-parity/render.ts \
//       --cards cards.json --fonts /abs/tmp --out /abs/out [--year 2026]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { renderCardImage, type RenderIO } from "@/app/forge/lib/renderCard";
import type { DesignCard } from "@/app/forge/lib/designCard";

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) {
    if (def !== undefined) return def;
    throw new Error(`missing --${name}`);
  }
  return process.argv[i + 1];
}

const cardsFile = arg("cards");
const fontDir = arg("fonts");
const outDir = arg("out");
const year = Number(arg("year", "2026"));
const FONT_FILES = { title: "SYMPHOBL.TTF", stat: "grail.ttf" } as const;

const io: RenderIO = {
  readPrivateFont: async (face) => {
    const file = path.join(fontDir, FONT_FILES[face]);
    return existsSync(file) ? readFileSync(file) : null;
  },
  readArt: async () => null,
};

async function main() {
  const cards: { id: string; data: DesignCard }[] = JSON.parse(readFileSync(cardsFile, "utf8"));
  mkdirSync(outDir, { recursive: true });
  let degraded = 0;
  const t0 = Date.now();
  for (const [i, c] of cards.entries()) {
    const out = await renderCardImage({ data: c.data, artKey: null, year }, io);
    if (out.degraded) degraded++;
    writeFileSync(path.join(outDir, `${c.id}.jpg`), out.jpeg);
    if ((i + 1) % 25 === 0) console.log(`${i + 1}/${cards.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  console.log(`rendered ${cards.length}, degraded (fallback fonts): ${degraded}`);
  if (degraded) process.exit(2);
}
main().catch((e) => { console.error(e); process.exit(1); });
