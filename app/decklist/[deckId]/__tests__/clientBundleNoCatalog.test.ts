import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * The public deck page must not ship the card catalog to the browser.
 *
 * The catalog (lib/cards/generated/cardData.json) is ~360 KB compressed. Any
 * static import chain from the deck page's client component to it puts that
 * chunk in front of first paint for every visitor. Rows are joined to the
 * catalog on the server (enrichDeckCards) and anything that genuinely needs the
 * whole catalog in the browser must load through next/dynamic or import().
 *
 * This walks static `import`/`export ... from` edges only (type-only imports and
 * dynamic import() are skipped, as the bundler skips them). A `"use server"`
 * module is a boundary: a client component that imports one gets action
 * references, not the module's own imports. Fails with the offending chains.
 */
const ROOT = process.cwd();
const ENTRY = path.join(ROOT, "app/decklist/[deckId]/client.tsx");
const CATALOG = /lib\/cards\/(lookup\.ts|generated\/cardData\.(ts|json))$|card-search\/data\/cardIndex\.ts$/;
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".json"];

function resolveSpec(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // package import
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, "index" + e))];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

/** Specifiers of every runtime import/re-export in a module. */
function runtimeImports(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*(import|export)\s+([^;]*?)\s*from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[4]) { out.push(m[4]); continue; }
    const clause = m[2].trim();
    if (clause.startsWith("type ")) continue; // import type { … } / export type { … }
    const braces = clause.match(/^\{([^}]*)\}$/);
    if (braces && braces[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[3]);
  }
  return out;
}

function chainsToCatalog(entry: string): string[] {
  const parent = new Map<string, string | null>();
  const queue: Array<[string, string | null]> = [[entry, null]];
  // Every importer -> catalog edge, not just the first one found, so a failure
  // names each offending import rather than one at a time.
  const edges = new Set<string>();
  while (queue.length) {
    const [file, from] = queue.shift()!;
    if (CATALOG.test(file)) { edges.add(`${from}\u0000${file}`); continue; }
    if (parent.has(file)) continue;
    parent.set(file, from);
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    if (/^\s*["']use server["']/.test(src)) continue;
    for (const spec of runtimeImports(src)) {
      const resolved = resolveSpec(file, spec);
      if (resolved) queue.push([resolved, file]);
    }
  }
  return [...edges].sort().map((edge) => {
    const [importer, target] = edge.split("\u0000");
    const chain: string[] = [path.relative(ROOT, target)];
    for (let f: string | null | undefined = importer; f; f = parent.get(f)) chain.unshift(path.relative(ROOT, f));
    return chain.join(" -> ");
  });
}

describe("public deck page client bundle", () => {
  it("has no static import path to the card catalog", () => {
    expect(chainsToCatalog(ENTRY)).toEqual([]);
  });
});
