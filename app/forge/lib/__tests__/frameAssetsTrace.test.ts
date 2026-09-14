import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { framePaths } from "../frameAssets";
import {
  ALIGNMENTS, BRIGADES, CARD_TYPES, CLASSES, ICONS, GOOD_BRIGADES, EVIL_BRIGADES, type DesignCard,
} from "../designCard";

// The server renderer reads frame assets from disk inside the art route's function bundle.
// next.config.js traces only these directories into it; an asset elsewhere would pass locally
// and fail on Vercel with ENOENT.
const TRACED = ["/forge/frames/washes/", "/forge/frames/icons/", "/forge/frames/badges/"];

function everyCard(): DesignCard[] {
  const brigadeSets: DesignCard["brigades"][] = [
    [], ...BRIGADES.map((b) => [b]), ["Blue", "Green"], ["Crimson", "EvilGold", "Gray"], [...GOOD_BRIGADES], [...EVIL_BRIGADES],
  ];
  const cards: DesignCard[] = [];
  for (const cardType of CARD_TYPES) {
    for (const alignment of ALIGNMENTS) {
      for (const brigades of brigadeSets) {
        cards.push({ cardType: [cardType], alignment, brigades, strength: 1, toughness: 1, class: [...CLASSES], icons: [...ICONS] });
      }
    }
  }
  return cards;
}

describe("frame assets the server renderer reads", () => {
  const paths = new Set(everyCard().flatMap(framePaths));

  it("covers a real spread of the kit", () => {
    expect(paths.size).toBeGreaterThan(20);
  });

  it("all sit in directories next.config.js traces into the art route", () => {
    for (const p of paths) expect(TRACED.some((dir) => p.startsWith(dir)), p).toBe(true);
    const config = readFileSync(path.join(process.cwd(), "next.config.js"), "utf8");
    for (const dir of TRACED) expect(config).toContain(`./public${dir}**`);
    expect(config).toContain("./public/forge/fonts/*.ttf");
  });

  it("all exist on disk", () => {
    for (const p of paths) expect(existsSync(path.join(process.cwd(), "public", p)), p).toBe(true);
  });
});
