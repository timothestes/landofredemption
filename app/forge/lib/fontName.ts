// The family name a font file registers under in resvg's font database (fontdb): the
// typographic family (name ID 16) when the font has one, else the legacy family (name ID 1).
// Probe 2026-09-13: font-family "Mukta" (ID 16) selected Mukta-ExtraBold.ttf, while
// "Mukta ExtraBold" (ID 1) silently fell back to the default font.
export function fontFamilyName(font: Buffer): string | null {
  if (font.length < 12) return null;
  const numTables = font.readUInt16BE(4);
  let nameTable = -1;
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (record + 16 > font.length) return null;
    if (font.toString("latin1", record, record + 4) === "name") {
      nameTable = font.readUInt32BE(record + 8);
      break;
    }
  }
  if (nameTable < 0 || nameTable + 6 > font.length) return null;
  const count = font.readUInt16BE(nameTable + 2);
  const stringsStart = nameTable + font.readUInt16BE(nameTable + 4);
  const found = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const r = nameTable + 6 + i * 12;
    if (r + 12 > font.length) break;
    const platform = font.readUInt16BE(r);
    const language = font.readUInt16BE(r + 4);
    const nameId = font.readUInt16BE(r + 6);
    const length = font.readUInt16BE(r + 8);
    const offset = font.readUInt16BE(r + 10);
    if (nameId !== 16 && nameId !== 1) continue;
    const start = stringsStart + offset;
    if (start + length > font.length) continue;
    const raw = font.subarray(start, start + length);
    if (platform === 3 && language === 0x409) found.set(`${nameId}:win`, utf16be(raw));
    else if (platform === 1 && language === 0) found.set(`${nameId}:mac`, raw.toString("latin1"));
  }
  const name = found.get("16:win") ?? found.get("16:mac") ?? found.get("1:win") ?? found.get("1:mac");
  return name ? name : null;
}

function utf16be(raw: Buffer): string {
  if (raw.length % 2 === 1) return "";
  return Buffer.from(raw).swap16().toString("utf16le"); // copy first: swap16 is in place
}
