// Pure helpers for the Forge verse finder's keyword search: scope presets, hit highlighting and
// the query derived from a card name. No React/Next so it runs in node tests and the browser.

export type ScopeId = "any" | "ot" | "nt" | "gospels" | "letters";
export type Scope = { id: ScopeId; label: string; range: string | null };

export const SCOPES: readonly Scope[] = [
  { id: "any", label: "Anywhere", range: null },
  { id: "ot", label: "Old Testament", range: "GEN-MAL" },
  { id: "nt", label: "New Testament", range: "MAT-REV" },
  { id: "gospels", label: "Gospels", range: "MAT-JHN" },
  { id: "letters", label: "Letters", range: "ROM-JUD" },
];

export function scopeById(id: string): Scope {
  return SCOPES.find((s) => s.id === id) ?? SCOPES[0];
}

/** How the hint and count line name a book scope: "in Psalms", though the house form for a reference is "Psalm". */
export function scopeNameFor(book: { id: string; name: string }): string {
  return book.id === "PSA" ? "Psalms" : book.name;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const STOPWORDS = new Set(["a", "an", "the", "of", "and", "in", "to", "for", "is"]);
const letters = (s: string) => s.replace(/[^\p{L}]/gu, "").length;
const WORDCH = /[\p{L}\p{N}]/u;

function tokens(words: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(words))) {
    const t = (m[1] ?? m[2]).trim().replace(/"/g, "");
    if (letters(t) >= 2 && !STOPWORDS.has(t.toLowerCase())) out.push(t);
  }
  return out;
}

// A token's pattern: it starts at a word boundary; a token of three or fewer letters must also end
// at one ("my" marks "My", never "Myself"), a longer one is a prefix ("shepherd" marks "shepherds").
function tokenPattern(t: string): string {
  const left = WORDCH.test(t[0]) ? "(?<![\\p{L}\\p{N}])" : "";
  const right = letters(t) <= 3 && WORDCH.test(t[t.length - 1]) ? "(?![\\p{L}\\p{N}])" : "";
  return `${left}${escapeRe(t)}${right}`;
}

// Splits text into alternating plain/hit segments. Stopwords never mark. Overlapping or touching
// matches merge; no segment is empty.
export function highlightSegments(text: string, words: string): { text: string; hit: boolean }[] {
  const toks = tokens(words);
  if (!text || !toks.length) return [{ text, hit: false }];
  const re = new RegExp(toks.map(tokenPattern).join("|"), "giu");
  const ranges: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const last = ranges[ranges.length - 1];
    if (last && m.index <= last[1]) last[1] = Math.max(last[1], m.index + m[0].length);
    else ranges.push([m.index, m.index + m[0].length]);
  }
  if (!ranges.length) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let pos = 0;
  for (const [a, z] of ranges) {
    if (a > pos) out.push({ text: text.slice(pos, a), hit: false });
    out.push({ text: text.slice(a, z), hit: true });
    pos = z;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}

// A card name -> a keyword query: drop [tags] and (tags), keep the part before the first , : ; – — or " - ",
// drop stopwords. Null when fewer than 2 letters remain.
export function cardNameQuery(name: string | null | undefined): string | null {
  if (!name) return null;
  const head = name.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").split(/[,:;–—]| - /)[0];
  const q = head.split(/\s+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase())).join(" ");
  return q.replace(/[^\p{L}]/gu, "").length >= 2 ? q : null;
}
