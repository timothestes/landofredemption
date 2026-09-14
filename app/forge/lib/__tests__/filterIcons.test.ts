import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { CARD_TYPES, BRIGADES, CLASSES, ICONS } from "../designCard";
import {
  typeIconSrc, brigadeIconSrc, multiBrigadeIconSrc, glyphIconSrc,
  typeLabel, brigadeLabel,
} from "../filterIcons";

// Every src these helpers return is a public/ URL, so the strongest check is that
// the file is actually on disk — a typo'd map entry ("GoodGold" vs "Good Gold")
// would otherwise only show up as a broken image in the editor.
const onDisk = (src: string) =>
  existsSync(path.join(process.cwd(), "public", decodeURIComponent(src)));

describe("filterIcons", () => {
  it("resolves every card type to art that exists", () => {
    for (const t of CARD_TYPES) {
      const src = typeIconSrc(t, "Good");
      expect(onDisk(src), `${t} -> ${src}`).toBe(true);
    }
  });

  it("picks the evil art for Dominant and Fortress on an evil card", () => {
    expect(typeIconSrc("Dominant", "Evil")).toContain("Evil%20Dominant");
    expect(typeIconSrc("Fortress", "Evil")).toContain("Evil%20Fortress");
    expect(onDisk(typeIconSrc("Dominant", "Evil"))).toBe(true);
    expect(onDisk(typeIconSrc("Fortress", "Evil"))).toBe(true);
  });

  it("falls back to the good art when alignment is unset or not evil", () => {
    expect(typeIconSrc("Dominant", undefined)).toContain("Good%20Dominant");
    expect(typeIconSrc("Fortress", "Neutral")).toContain("Good%20Fortress");
  });

  it("resolves every brigade to art that exists, keeping the Color= prefix literal", () => {
    for (const b of BRIGADES) {
      const src = brigadeIconSrc(b);
      expect(src, b).toContain("/filter-icons/Color=");
      expect(onDisk(src), `${b} -> ${src}`).toBe(true);
    }
  });

  it("spells the two-word brigades the way the art files do", () => {
    expect(brigadeIconSrc("GoodGold")).toContain("Color=Good%20Gold");
    expect(brigadeIconSrc("EvilGold")).toContain("Color=Evil%20Gold");
    expect(brigadeIconSrc("PaleGreen")).toContain("Color=Pale%20Green");
  });

  it("resolves both Multi foils to art that exists", () => {
    for (const side of ["Good", "Evil"] as const) {
      const src = multiBrigadeIconSrc(side);
      expect(onDisk(src), `${side} Multi -> ${src}`).toBe(true);
    }
  });

  it("resolves every class and icon to a frame-kit glyph that exists", () => {
    for (const name of [...CLASSES, ...ICONS]) {
      const src = glyphIconSrc(name);
      expect(src, name).toContain("/forge/frames/icons/");
      expect(onDisk(src), `${name} -> ${src}`).toBe(true);
    }
  });

  it("spaces the run-together labels for display, leaving the stored value alone", () => {
    expect(typeLabel("EvilCharacter")).toBe("Evil Character");
    expect(typeLabel("LostSoul")).toBe("Lost Soul");
    expect(typeLabel("Hero")).toBe("Hero");
    expect(brigadeLabel("GoodGold")).toBe("Good Gold");
    expect(brigadeLabel("PaleGreen")).toBe("Pale Green");
    expect(brigadeLabel("Blue")).toBe("Blue");
  });
});
