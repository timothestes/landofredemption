// Printed cards use curly quotation marks; a keyboard types straight ones. Pure helpers
// shared by the card editor (typing, "Make curly") and the Forge text searches.

const OPENS_AFTER = /[\s([{–—“‘]$|(^|\s)…$/;

/** The curly mark a straight one stands for, given the text to its left: an opening mark at
 *  the start, after a space, an opening bracket, a dash, another opening mark or the ellipsis
 *  an excerpt starts with; otherwise a closing mark (which, for the single, is also the
 *  apostrophe). */
export function curlyFor(before: string, mark: '"' | "'"): string {
  const opening = before === "" || OPENS_AFTER.test(before);
  if (mark === '"') return opening ? "“" : "”";
  return opening ? "‘" : "’";
}

export function hasStraightQuotes(text: string): boolean {
  return /["']/.test(text);
}

/** Every straight mark made curly, each decided from the converted text to its left. */
export function curlAll(text: string): string {
  let out = "";
  for (const ch of text) out += ch === '"' || ch === "'" ? curlyFor(out, ch) : ch;
  return out;
}

/** Curly marks made straight, so a search typed on a keyboard finds text written either way. */
export function foldQuotes(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}
