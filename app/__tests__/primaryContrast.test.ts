import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../globals.css"), "utf8");

// Reads "H S% L%" for a token out of one theme's block in globals.css.
function token(selector: string, name: string): [number, number, number] {
  const block = css.slice(css.indexOf(`${selector} {`));
  const match = block.slice(0, block.indexOf("}")).match(new RegExp(`${name}:\\s*([\\d.]+) ([\\d.]+)% ([\\d.]+)%`));
  if (!match) throw new Error(`${name} not found in ${selector}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance([h, s, l]: [number, number, number]): number {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("primary token contrast", () => {
  it.each([
    ["light", ":root"],
    ["dark", ".dark"],
    ["jayden", ".jayden"],
  ])("%s: text on a primary button reaches 4.5:1", (_name, selector) => {
    expect(contrast(token(selector, "--primary"), token(selector, "--primary-foreground"))).toBeGreaterThanOrEqual(4.5);
  });

  it("dark: green used as text on the page reaches 4.5:1", () => {
    expect(contrast(token(".dark", "--primary"), token(".dark", "--background"))).toBeGreaterThanOrEqual(4.5);
  });
});
