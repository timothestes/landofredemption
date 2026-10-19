import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { BRIGADES, CARD_TYPES, EVIL_BRIGADES, GOOD_BRIGADES, type DesignCard } from "../designCard";
import {
  BRIGADE_HEX, BRIGADE_SLUG, SYNTHESIZED_WASHES, washPaths, washColumns, iconBox, classIcons, framePaths,
  isDualAlignment, sideStat,
  isPreviewApproximate, specialWash, showsStats,
} from "../frameAssets";
import { RECTS, CANVAS, BRIGADE_BOX_HEX, ICON_RECTS } from "../frameGeometry";

const kit = (p: string) => path.join(__dirname, "../../../../public", p);

describe("kit completeness", () => {
  it("every brigade has a box color and a wash file", () => {
    for (const b of BRIGADES) {
      expect(BRIGADE_HEX[b]).toMatch(/^#[0-9a-f]{6}$/);
      expect(existsSync(kit(washPaths({ brigades: [b] })[0]))).toBe(true);
    }
  });
  it("every special type has a wash file", () => {
    const cases: DesignCard[] = [
      { cardType: ["LostSoul"] }, { cardType: ["Artifact"] },
      { cardType: ["Dominant"], alignment: "Good" }, { cardType: ["Dominant"], alignment: "Evil" },
      { cardType: ["Fortress"], alignment: "Good" }, { cardType: ["Fortress"], alignment: "Evil" },
      { brigades: [...GOOD_BRIGADES] }, { brigades: [...EVIL_BRIGADES] },
    ];
    for (const c of cases) expect(existsSync(kit(washPaths(c)[0]))).toBe(true);
  });
  it("every boxed card type resolves to an icon or a badge that exists", () => {
    for (const t of CARD_TYPES) {
      const box = iconBox({ cardType: [t], brigades: ["Blue"], alignment: "Good" }, "left");
      if (t === "LostSoul") { expect(box).toBeNull(); continue; }
      expect(box).not.toBeNull();
      expect(box!.icon || box!.badge).toBeTruthy();
      if (box!.icon) expect(existsSync(kit(box!.icon))).toBe(true);
      if (box!.badge) expect(existsSync(kit(box!.badge))).toBe(true);
    }
    expect(existsSync(kit(iconBox({ cardType: ["Curse"] }, "right")!.badge!))).toBe(true);
  });
  it("geometry is in the 750x1050 canvas and every rect fits", () => {
    expect(CANVAS).toEqual({ w: 750, h: 1050 });
    for (const r of Object.values(RECTS)) {
      expect(r.x).toBeGreaterThanOrEqual(-40);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(790);
      expect(r.y + r.h).toBeLessThanOrEqual(1050);
    }
    expect(RECTS.art.y).toBeGreaterThan(RECTS.leftBox.y);
    expect(RECTS.textBox.y).toBeGreaterThan(RECTS.art.y + RECTS.art.h - 1);
  });
  it("synthesized washes are the ones the template lacks", () => {
    expect([...SYNTHESIZED_WASHES].sort()).toEqual(["red", "teal"]);
    expect(BRIGADE_BOX_HEX.red).not.toBe(BRIGADE_BOX_HEX.crimson);
  });
});

describe("washPaths", () => {
  it("is empty without a brigade or special type", () => {
    expect(washPaths({})).toEqual([]);
    expect(washPaths({ cardType: ["Hero"] })).toEqual([]);
  });
  it("uses one wash per brigade, every brigade, top to bottom", () => {
    expect(washPaths({ brigades: ["Red"] })).toEqual(["/forge/frames/washes/red.webp"]);
    expect(washPaths({ brigades: ["GoodGold", "Red", "Blue"] })).toEqual([
      "/forge/frames/washes/gold.webp", "/forge/frames/washes/red.webp", "/forge/frames/washes/blue.webp",
    ]);
  });
  it("a card of every brigade of one alignment (printed Multi) takes that alignment's foil", () => {
    expect(washPaths({ brigades: [...GOOD_BRIGADES] })).toEqual(["/forge/frames/badges/multi-good.webp"]);
    expect(washPaths({ brigades: [...EVIL_BRIGADES] })).toEqual(["/forge/frames/badges/multi-evil.webp"]);
    expect(washPaths({ brigades: EVIL_BRIGADES.slice(1) })).toHaveLength(EVIL_BRIGADES.length - 1);
  });
  it("special types override brigades and follow alignment", () => {
    expect(specialWash({ cardType: ["Hero", "Dominant"], alignment: "Evil" })).toBe("evil-dom");
    expect(washPaths({ cardType: ["Fortress"], brigades: ["Blue"] })).toEqual(["/forge/frames/washes/good-fort.webp"]);
    expect(washPaths({ cardType: ["LostSoul"] })).toEqual(["/forge/frames/washes/lost-soul.webp"]);
  });
  it("both golds share the gold wash", () => {
    expect(BRIGADE_SLUG.GoodGold).toBe("gold");
    expect(BRIGADE_SLUG.EvilGold).toBe("gold");
  });
});

describe("showsStats", () => {
  it("always for Heroes and Evil Characters, even before values are entered", () => {
    expect(showsStats({ cardType: ["Hero"] })).toBe(true);
    expect(showsStats({ cardType: ["EvilCharacter"], strength: null, toughness: null })).toBe(true);
  });
  it("for enhancements, Covenants and Curses only once a value is entered", () => {
    for (const t of ["GE", "EE", "Covenant", "Curse"] as const) {
      expect(showsStats({ cardType: [t] })).toBe(false);
      expect(showsStats({ cardType: [t], strength: 5 })).toBe(true);
      expect(showsStats({ cardType: [t], toughness: "X" })).toBe(true);
    }
  });
  it("never for types that cannot carry stats", () => {
    expect(showsStats({ cardType: ["Site"], strength: 5, toughness: 5 })).toBe(false);
    expect(showsStats({ cardType: ["Artifact"], strength: 5 })).toBe(false);
    expect(showsStats({ cardType: ["LostSoul"], strength: 5 })).toBe(false);
  });
});

describe("iconBox", () => {
  it("is absent until a type is chosen, and never for Lost Souls", () => {
    expect(iconBox({ brigades: ["Blue"] }, "left")).toBeNull();
    expect(iconBox({ cardType: ["LostSoul"], brigades: ["Blue"] }, "left")).toBeNull();
    expect(iconBox({ cardType: ["LostSoul"] }, "right")).toBeNull();
  });
  it("Hero: cross, stats, brigade fill; white brigade takes dark stat text", () => {
    const blue = iconBox({ cardType: ["Hero"], brigades: ["Blue"] }, "left")!;
    expect(blue.icon).toBe("/forge/frames/icons/cross.png");
    expect(blue.withStats).toBe(true);
    expect(blue.badge).toBeNull();
    expect(blue.fill).toBe(BRIGADE_HEX.Blue);
    expect(blue.bands).toEqual([]);
    expect(blue.darkText).toBe(false);
    const white = iconBox({ cardType: ["Hero"], brigades: ["White"] }, "left")!;
    expect(white.fill).toBe("#ffffff");
    expect(white.darkText).toBe(true);
  });
  it("two brigades split the one box top/bottom; there is no second box for them", () => {
    const box = iconBox({ cardType: ["Hero"], brigades: ["Blue", "Green"] }, "left")!;
    expect(box.fill).toBe(BRIGADE_HEX.Blue);
    expect(box.bands).toEqual([BRIGADE_HEX.Green]);
    expect(box.icon).toBe("/forge/frames/icons/cross.png");
    expect(iconBox({ cardType: ["Hero"], brigades: ["Blue", "Green"] }, "right")).toBeNull();
  });
  it("three or more brigades band the box in order, as printed (Army of a Million Men)", () => {
    const box = iconBox({ cardType: ["EvilCharacter"], brigades: ["Crimson", "EvilGold", "Gray"], alignment: "Evil" }, "left")!;
    expect(box.badge).toBeNull();
    expect(box.fill).toBe(BRIGADE_HEX.Crimson);
    expect(box.bands).toEqual([BRIGADE_HEX.EvilGold, BRIGADE_HEX.Gray]);
  });
  it("only a card of every brigade of one alignment uses the multi foil", () => {
    const good = iconBox({ cardType: ["GE"], brigades: [...GOOD_BRIGADES], alignment: "Good" }, "left")!;
    expect(good.badge).toBe("/forge/frames/badges/multi-good.webp");
    expect(good.bands).toEqual([]);
    const evil = iconBox({ cardType: ["EE"], brigades: [...EVIL_BRIGADES], alignment: "Evil" }, "left")!;
    expect(evil.badge).toBe("/forge/frames/badges/multi-evil.webp");
    expect(evil.icon).toBe("/forge/frames/icons/skull.png");
  });
  it("Evil Character is the dragon, Evil Enhancement the skull (as printed)", () => {
    expect(iconBox({ cardType: ["EvilCharacter"], brigades: ["Crimson"] }, "left")!.icon).toBe("/forge/frames/icons/dragon.png");
    expect(iconBox({ cardType: ["EE"], brigades: ["Crimson"] }, "left")!.icon).toBe("/forge/frames/icons/skull.png");
  });
  it("icons sit at the template's slot, dropping to the lower one when stats print", () => {
    const plain = iconBox({ cardType: ["EE"], brigades: ["Black"] }, "left")!;
    const stats = iconBox({ cardType: ["EE"], brigades: ["Black"], strength: 3 }, "left")!;
    expect(plain.icon).toBe("/forge/frames/icons/skull.png");
    expect(stats.icon).toBe("/forge/frames/icons/skull.png");
    expect(plain.iconRect).toEqual(ICON_RECTS.skull);
    expect(stats.iconRect).toEqual(ICON_RECTS.skullStats);
    expect(stats.iconRect!.y).toBeGreaterThan(plain.iconRect!.y);
    expect(iconBox({ cardType: ["Covenant"], brigades: ["Green"], strength: 5, toughness: 2 }, "left")!.iconRect).toEqual(ICON_RECTS.bibleStats);
    expect(iconBox({ cardType: ["Hero"], brigades: ["Blue"] }, "left")!.iconRect).toEqual(ICON_RECTS.cross);
    expect(iconBox({ cardType: ["Artifact"] }, "left")!.iconRect).toBeNull();
  });
  it("every icon slot is inside the left box and keeps its raster's aspect", () => {
    const box = RECTS.leftBox;
    for (const [k, r] of Object.entries(ICON_RECTS)) {
      if (k === "shield" || k === "territory") continue;
      expect(r.x, k).toBeGreaterThanOrEqual(box.x);
      expect(r.x + r.w, k).toBeLessThanOrEqual(box.x + box.w);
      expect(r.y, k).toBeGreaterThanOrEqual(box.y + 10);
      expect(r.y + r.h, k).toBeLessThanOrEqual(box.y + box.h + 1);
    }
    // The stats slots start below the strength/toughness line.
    expect(ICON_RECTS.skullStats.y).toBeGreaterThan(RECTS.statText.y + RECTS.statText.h);
    expect(ICON_RECTS.bibleStats.y).toBeGreaterThan(RECTS.statText.y + RECTS.statText.h);
    expect(ICON_RECTS.cross.y).toBeGreaterThan(RECTS.statText.y + RECTS.statText.h);
    expect(ICON_RECTS.dragon.y).toBeGreaterThan(RECTS.statText.y - 5);
    // Class icons hang below the box, off its left edge.
    expect(ICON_RECTS.shield.y).toBeGreaterThan(box.y + box.h);
    expect(ICON_RECTS.shield.x).toBeLessThan(RECTS.art.x);
  });
  it("badges anchor the way the template crops them", () => {
    expect(iconBox({ cardType: ["Artifact"] }, "left")!.badgeAlign).toBe("xMidYMax");
    expect(iconBox({ cardType: ["Curse"] }, "right")!.badgeAlign).toBe("xMidYMax");
    expect(iconBox({ cardType: ["Hero"], brigades: [...GOOD_BRIGADES], alignment: "Good" }, "left")!.badgeAlign).toBe("xMidYMin");
    expect(iconBox({ cardType: ["Dominant"], alignment: "Evil" }, "left")!.badgeAlign).toBe("xMidYMid");
  });
  it("Covenants and Curses: enhancement icon left, artifact chalice right", () => {
    const cov = iconBox({ cardType: ["Covenant"], brigades: ["Green", "Purple"], strength: 5, toughness: 2 }, "left")!;
    expect(cov.icon).toBe("/forge/frames/icons/bible.png");
    expect(cov.fill).toBe(BRIGADE_HEX.Green);
    expect(cov.bands).toEqual([BRIGADE_HEX.Purple]);
    expect(cov.withStats).toBe(true);
    const right = iconBox({ cardType: ["Covenant"], brigades: ["Green", "Purple"] }, "right")!;
    expect(right.badge).toBe("/forge/frames/badges/artifact.webp");
    expect(right.icon).toBeNull();
    expect(right.withStats).toBe(false);
    expect(iconBox({ cardType: ["Curse"] }, "right")!.badge).toBe("/forge/frames/badges/artifact.webp");
    expect(iconBox({ cardType: ["Hero"] }, "right")).toBeNull();
    expect(iconBox({ cardType: ["Artifact"] }, "right")).toBeNull();
  });
  it("badges: artifact chalice, lamb/reaper dominants, nebula fortress", () => {
    expect(iconBox({ cardType: ["Artifact"] }, "left")!.badge).toBe("/forge/frames/badges/artifact.webp");
    expect(iconBox({ cardType: ["Dominant"], alignment: "Good" }, "left")!.badge).toBe("/forge/frames/badges/lamb.webp");
    expect(iconBox({ cardType: ["Dominant"], alignment: "Evil" }, "left")!.badge).toBe("/forge/frames/badges/reaper.webp");
    const fort = iconBox({ cardType: ["Fortress"], alignment: "Evil" }, "left")!;
    expect(fort.badge).toBe("/forge/frames/badges/evil-dom.webp");
    expect(fort.icon).toBe("/forge/frames/icons/fortress.png");
  });
});

describe("classIcons / approximate", () => {
  it("stacks the shield(s) then the territory plate down the left edge, at template size", () => {
    const all = classIcons({ class: ["Warrior", "Weapon"], icons: ["Territory"] });
    expect(all.map((c) => c.src)).toEqual([
      "/forge/frames/icons/warrior.png", "/forge/frames/icons/weapon.png", "/forge/frames/icons/territory.png",
    ]);
    expect(all[0].rect).toEqual(ICON_RECTS.shield);
    expect(all[1].rect.y).toBeGreaterThan(all[0].rect.y + all[0].rect.h);
    expect(all[2].rect.y).toBeGreaterThan(all[1].rect.y + all[1].rect.h);
    expect(all[2].rect.w).toBe(ICON_RECTS.territory.w);
    for (const c of all) { expect(c.rect.x).toBe(ICON_RECTS.shield.x); expect(existsSync(kit(c.src))).toBe(true); }
    const alone = classIcons({ icons: ["Territory"] });
    expect(alone).toHaveLength(1);
    expect(alone[0].rect.y).toBe(ICON_RECTS.territory.y);
    expect(classIcons({})).toEqual([]);
  });
  it("flags the multi foil wash, Classic legality and synthesized washes", () => {
    expect(isPreviewApproximate({ brigades: ["Blue"] })).toBe(false);
    expect(isPreviewApproximate({ brigades: ["Blue", "Green", "Purple"] })).toBe(false);
    expect(isPreviewApproximate({ brigades: [...EVIL_BRIGADES] })).toBe(true);
    expect(isPreviewApproximate({ legality: "Classic" })).toBe(true);
    expect(isPreviewApproximate({ brigades: ["Teal"] })).toBe(true);
  });
});

// Dual-alignment cards print as two half-frames. Checked on Perfidy, Measured Mien, Return to
// Fight (T2C), Quake in Edom, Joab the General (II), Battle Axe, Philosophy (RR2), Defenestrated!
// (Roots) and Blood Avenger (IR): the good type's icon in a box of the good brigade on the left,
// the evil type's in a box of the evil brigade on the right, each box carrying its own side of
// the stats; the wash blends good into evil left to right; the title sits between the boxes.
describe("dual alignment", () => {
  const PERFIDY: DesignCard = { name: "Perfidy", cardType: ["GE", "EE"], brigades: ["Green", "Brown"], strength: "6 (0)", toughness: "2 (6)" };
  const JOAB: DesignCard = { name: "Joab, the General", cardType: ["Hero", "EvilCharacter"], brigades: ["Purple", "Brown"], strength: "12 (6)", toughness: "6 (12)", class: ["Warrior"] };

  it("is any card with both a good and an evil type, or whose alignment is set to Good/Evil", () => {
    expect(isDualAlignment(PERFIDY)).toBe(true);
    expect(isDualAlignment(JOAB)).toBe(true);
    expect(isDualAlignment({ ...PERFIDY, alignment: "Neutral" })).toBe(true); // the catalog files GE/EE cards as Neutral
    expect(isDualAlignment({ cardType: ["Dominant"], alignment: "Good_Evil" })).toBe(true);
    expect(isDualAlignment({ cardType: ["GE"], brigades: ["Green", "Brown"] })).toBe(false);
    expect(isDualAlignment({ cardType: ["Covenant"], brigades: ["Green"], alignment: "Good" })).toBe(false);
  });

  it("splits a paired stat between the sides; a single value prints on both (Battle Axe: 4/3 (2) → 4/3 and 4/2)", () => {
    expect(sideStat("6 (0)", "left")).toBe(6);
    expect(sideStat("6 (0)", "right")).toBe(0);
    expect(sideStat("X (0)", "left")).toBe("X");
    expect(sideStat("X (0)", "right")).toBe(0);
    expect(sideStat(4, "left")).toBe(4);
    expect(sideStat(4, "right")).toBe(4);
    expect(sideStat("X", "right")).toBe("X");
    expect(sideStat(null, "right")).toBeNull();
    expect(sideStat(undefined, "left")).toBeUndefined();
  });

  it("boxes: good type and brigade on the left, evil on the right, each with its side's stats", () => {
    const left = iconBox(PERFIDY, "left")!, right = iconBox(PERFIDY, "right")!;
    expect(left.icon).toBe("/forge/frames/icons/bible.png");
    expect(left.fill).toBe(BRIGADE_HEX.Green);
    expect(left.bands).toEqual([]);
    expect(left.stats).toBe("6/2");
    expect(left.rect).toEqual(RECTS.leftBox);
    expect(right.icon).toBe("/forge/frames/icons/skull.png");
    expect(right.fill).toBe(BRIGADE_HEX.Brown);
    expect(right.bands).toEqual([]);
    expect(right.badge).toBeNull();
    expect(right.withStats).toBe(true);
    expect(right.stats).toBe("0/6");
    expect(right.darkText).toBe(false);
  });

  it("mirrors the right box and its icon slot across the card", () => {
    const right = iconBox(PERFIDY, "right")!;
    const L = RECTS.leftBox;
    expect(right.rect).toEqual({ x: CANVAS.w - L.x - L.w, y: L.y, w: L.w, h: L.h });
    const slot = ICON_RECTS.skullStats;
    expect(right.iconRect).toEqual({ x: CANVAS.w - slot.x - slot.w, y: slot.y, w: slot.w, h: slot.h });
    // Without stats the plain slot, mirrored.
    const plain = iconBox({ cardType: ["GE", "EE"], brigades: ["Green", "Brown"] }, "right")!;
    expect(plain.stats).toBeNull();
    expect(plain.iconRect!.y).toBe(ICON_RECTS.skull.y);
  });

  it("a white side takes dark stat text, as any white box does (Measured Mien)", () => {
    const card: DesignCard = { cardType: ["GE", "EE"], brigades: ["White", "Crimson"], strength: "4 (0)", toughness: "0 (4)" };
    expect(iconBox(card, "left")!.darkText).toBe(true);
    expect(iconBox(card, "right")!.darkText).toBe(false);
  });

  it("characters: cross left, dragon right; the class shield prints under both boxes (Joab)", () => {
    expect(iconBox(JOAB, "left")!.icon).toBe("/forge/frames/icons/cross.png");
    expect(iconBox(JOAB, "left")!.stats).toBe("12/6");
    expect(iconBox(JOAB, "right")!.icon).toBe("/forge/frames/icons/dragon.png");
    expect(iconBox(JOAB, "right")!.stats).toBe("6/12");
    const shields = classIcons(JOAB);
    expect(shields.map((c) => c.src)).toEqual(["/forge/frames/icons/warrior.png", "/forge/frames/icons/warrior.png"]);
    expect(shields[0].rect).toEqual(ICON_RECTS.shield);
    expect(shields[1].rect.x).toBeCloseTo(CANVAS.w - ICON_RECTS.shield.x - ICON_RECTS.shield.w, 6);
    expect(shields[1].rect.y).toBe(shields[0].rect.y);
    // The territory plate stays on the left.
    const withPlate = classIcons({ ...JOAB, icons: ["Territory"] });
    expect(withPlate.filter((c) => c.src.endsWith("territory.png"))).toHaveLength(1);
  });

  it("a dual Dominant takes the lamb on the left and the reaper on the right, over the two nebulae", () => {
    const card: DesignCard = { cardType: ["Dominant"], alignment: "Good_Evil" };
    expect(iconBox(card, "left")!.badge).toBe("/forge/frames/badges/lamb.webp");
    expect(iconBox(card, "right")!.badge).toBe("/forge/frames/badges/reaper.webp");
    expect(washColumns(card)).toEqual([["/forge/frames/washes/good-dom.webp"], ["/forge/frames/washes/evil-dom.webp"]]);
  });

  it("washes: the good brigades' column on the left, the evil brigades' on the right", () => {
    expect(washColumns(PERFIDY)).toEqual([["/forge/frames/washes/green.webp"], ["/forge/frames/washes/brown.webp"]]);
    expect(washPaths(PERFIDY)).toEqual(["/forge/frames/washes/green.webp", "/forge/frames/washes/brown.webp"]);
    // A side with no brigade yet is an empty column; the renderers paint it neutral.
    expect(washColumns({ cardType: ["GE", "EE"], brigades: ["Green"] })).toEqual([["/forge/frames/washes/green.webp"], []]);
    // Each side bands its own brigades in listed order, the way a single-alignment card does.
    const three: DesignCard = { cardType: ["GE", "EE"], brigades: ["Green", "Purple", "PaleGreen"] };
    expect(washColumns(three)).toEqual([
      ["/forge/frames/washes/green.webp", "/forge/frames/washes/purple.webp"], ["/forge/frames/washes/pale-green.webp"],
    ]);
    expect(iconBox(three, "left")!.bands).toEqual([BRIGADE_HEX.Purple]);
    expect(iconBox(three, "right")!.fill).toBe(BRIGADE_HEX.PaleGreen);
    // Single-alignment cards are one column, unchanged.
    expect(washColumns({ brigades: ["Blue", "Green"] })).toEqual([["/forge/frames/washes/blue.webp", "/forge/frames/washes/green.webp"]]);
    expect(washColumns({})).toEqual([[]]);
  });

  it("leaves a single-alignment card with an off-side brigade banded as before", () => {
    const box = iconBox({ cardType: ["GE"], brigades: ["Green", "Brown"] }, "left")!;
    expect(box.bands).toEqual([BRIGADE_HEX.Brown]);
    expect(iconBox({ cardType: ["GE"], brigades: ["Green", "Brown"] }, "right")).toBeNull();
  });

  it("the chalice box keeps the template's right-box slot and no stats", () => {
    const right = iconBox({ cardType: ["Covenant"], brigades: ["Green"], strength: 5 }, "right")!;
    expect(right.rect).toEqual(RECTS.rightBox);
    expect(right.stats).toBeNull();
  });

  it("framePaths lists both sides' washes and icons", () => {
    const paths = framePaths(JOAB);
    for (const p of [
      "/forge/frames/washes/purple.webp", "/forge/frames/washes/brown.webp",
      "/forge/frames/icons/cross.png", "/forge/frames/icons/dragon.png", "/forge/frames/icons/warrior.png",
    ]) expect(paths).toContain(p);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
