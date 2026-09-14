import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// /forge has no middleware — every page/layout/route must call a gate itself.
function listForgeRouteFiles(): string[] {
  const root = join(process.cwd(), "app/forge");
  return walk(root)
    .map((p) => p.replace(process.cwd() + "/", ""))
    .filter((p) => /\/(page|layout)\.tsx$/.test(p) || /\/route\.ts$/.test(p))
    .filter((p) => !p.includes("__tests__"));
}

const GATE = /require(Forge|Elder|ForgeSuperadmin)\s*\(/;
// Pure redirect with no data exposure — intentionally has no gate.
const ALLOW_NO_GATE = new Set([
  "app/forge/art/page.tsx",
  "app/forge/ideas/[cardId]/page.tsx",
  "app/forge/play/games/page.tsx", // bare redirect to /forge/play (lobby moved)
]);
// Routes whose gate lives elsewhere must match EVERY one of their gate calls.
const ALT_GATE: Record<string, RegExp[]> = {
  // Member role check + RLS run inside the forge_art_key RPC (migration 066); a null key 404s.
  // The kind=rendered branch runs the same role check itself (my_forge_role), because RLS alone
  // lets a removed member's live session through. This is only a substring check; the real
  // guard is route.test.ts "404s a signed-in non-member even when RLS returns the card".
  "app/forge/api/art/[cardId]/route.ts": [/rpc[(] *["']forge_art_key["']/, /rpc[(] *["']my_forge_role["']/],
};

describe("forge gate-first guardrail", () => {
  const files = listForgeRouteFiles().filter((f) => !ALLOW_NO_GATE.has(f));

  it("finds the forge route files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} calls a Forge gate`, () => {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      const gates = ALT_GATE[f] ?? [GATE];
      for (const gate of gates) {
        expect(gate.test(src), `${f} must call its Forge gate (${gate})`).toBe(true);
      }
    });
  }
});
