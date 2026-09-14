import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fontFamilyName } from "../fontName";

const font = (file: string) => readFileSync(path.join(process.cwd(), "public/forge/fonts", file));

describe("fontFamilyName", () => {
  it("prefers the typographic family (name ID 16), which is what resvg matches", () => {
    expect(fontFamilyName(font("Mukta-ExtraBold.ttf"))).toBe("Mukta");
  });
  it("falls back to the legacy family (name ID 1)", () => {
    expect(fontFamilyName(font("Arimo-Regular.ttf"))).toBe("Arimo");
    expect(fontFamilyName(font("Arimo-Italic.ttf"))).toBe("Arimo");
    expect(fontFamilyName(font("PTSerif-Bold.ttf"))).toBe("PT Serif");
  });
  it("returns null for bytes that are not a font", () => {
    expect(fontFamilyName(Buffer.from("definitely not a font file"))).toBeNull();
  });
});
