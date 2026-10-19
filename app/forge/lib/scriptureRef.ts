// Scripture reference parsing for the Forge verse finder. Pure module (no React/Next) so it
// runs in node tests and in the browser. House form: Roman numerals ("II Chronicles"),
// singular "Psalm", "Song of Solomon", hyphen ranges with no spaces ("5:11-12").

export type ParsedRef = { bookId: string; book: string; chapter: number; from: number; to: number };
export type Book = { id: string; name: string; chapters: number; aliases: string[] };

// Aliases are lowercase and carry no numeral; the numeral prefix is normalized separately.
const b = (id: string, name: string, chapters: number, ...aliases: string[]): Book => ({ id, name, chapters, aliases });

export const BOOKS: readonly Book[] = [
  b("GEN", "Genesis", 50, "genesis", "gen", "ge", "gn"),
  b("EXO", "Exodus", 40, "exodus", "exo", "exod", "ex"),
  b("LEV", "Leviticus", 27, "leviticus", "lev", "le", "lv"),
  b("NUM", "Numbers", 36, "numbers", "num", "nu", "nm", "nb"),
  b("DEU", "Deuteronomy", 34, "deuteronomy", "deut", "deu", "dt"),
  b("JOS", "Joshua", 24, "joshua", "josh", "jos"),
  b("JDG", "Judges", 21, "judges", "judg", "jdg", "jg"),
  b("RUT", "Ruth", 4, "ruth", "rut", "ru"),
  b("1SA", "I Samuel", 31, "samuel", "sam", "sa", "sm"),
  b("2SA", "II Samuel", 24, "samuel", "sam", "sa", "sm"),
  b("1KI", "I Kings", 22, "kings", "king", "kgs", "ki"),
  b("2KI", "II Kings", 25, "kings", "king", "kgs", "ki"),
  b("1CH", "I Chronicles", 29, "chronicles", "chron", "chr", "ch"),
  b("2CH", "II Chronicles", 36, "chronicles", "chron", "chr", "ch"),
  b("EZR", "Ezra", 10, "ezra", "ezr"),
  b("NEH", "Nehemiah", 13, "nehemiah", "neh", "ne"),
  b("EST", "Esther", 10, "esther", "est", "esth"),
  b("JOB", "Job", 42, "job", "jb"),
  b("PSA", "Psalm", 150, "psalm", "psalms", "ps", "psa", "pss", "psm"),
  b("PRO", "Proverbs", 31, "proverbs", "prov", "pro", "pr", "prv"),
  b("ECC", "Ecclesiastes", 12, "ecclesiastes", "eccles", "eccl", "ecc", "ec"),
  b("SNG", "Song of Solomon", 8, "song of solomon", "song of songs", "songs of solomon", "song", "songs", "sos", "sng", "canticles", "canticle of canticles"),
  b("ISA", "Isaiah", 66, "isaiah", "isa", "is"),
  b("JER", "Jeremiah", 52, "jeremiah", "jer", "je"),
  b("LAM", "Lamentations", 5, "lamentations", "lam", "la"),
  b("EZK", "Ezekiel", 48, "ezekiel", "ezek", "eze", "ezk"),
  b("DAN", "Daniel", 12, "daniel", "dan", "da", "dn"),
  b("HOS", "Hosea", 14, "hosea", "hos", "ho"),
  b("JOL", "Joel", 3, "joel", "jol", "jl"),
  b("AMO", "Amos", 9, "amos", "am"),
  b("OBA", "Obadiah", 1, "obadiah", "obad", "oba", "ob"),
  b("JON", "Jonah", 4, "jonah", "jon", "jnh"),
  b("MIC", "Micah", 7, "micah", "mic", "mi"),
  b("NAM", "Nahum", 3, "nahum", "nah", "nam", "na"),
  b("HAB", "Habakkuk", 3, "habakkuk", "hab", "hb"),
  b("ZEP", "Zephaniah", 3, "zephaniah", "zeph", "zep", "zp"),
  b("HAG", "Haggai", 2, "haggai", "hag", "hg"),
  b("ZEC", "Zechariah", 14, "zechariah", "zech", "zec", "zc"),
  b("MAL", "Malachi", 4, "malachi", "mal", "ml"),
  b("MAT", "Matthew", 28, "matthew", "matt", "mat", "mt"),
  b("MRK", "Mark", 16, "mark", "mrk", "mar", "mk"),
  b("LUK", "Luke", 24, "luke", "luk", "lk"),
  b("JHN", "John", 21, "john", "joh", "jn"),
  b("ACT", "Acts", 28, "acts", "act", "ac"),
  b("ROM", "Romans", 16, "romans", "rom", "ro", "rm"),
  b("1CO", "I Corinthians", 16, "corinthians", "cor", "co"),
  b("2CO", "II Corinthians", 13, "corinthians", "cor", "co"),
  b("GAL", "Galatians", 6, "galatians", "gal", "ga"),
  b("EPH", "Ephesians", 6, "ephesians", "eph", "ephes"),
  b("PHP", "Philippians", 4, "philippians", "phil", "php", "pp"),
  b("COL", "Colossians", 4, "colossians", "col"),
  b("1TH", "I Thessalonians", 5, "thessalonians", "thess", "thes", "th"),
  b("2TH", "II Thessalonians", 3, "thessalonians", "thess", "thes", "th"),
  b("1TI", "I Timothy", 6, "timothy", "tim", "ti"),
  b("2TI", "II Timothy", 4, "timothy", "tim", "ti"),
  b("TIT", "Titus", 3, "titus", "tit"),
  b("PHM", "Philemon", 1, "philemon", "philem", "phm", "pm"),
  b("HEB", "Hebrews", 13, "hebrews", "heb"),
  b("JAS", "James", 5, "james", "jas", "jm"),
  b("1PE", "I Peter", 5, "peter", "pet", "pe", "pt"),
  b("2PE", "II Peter", 3, "peter", "pet", "pe", "pt"),
  b("1JN", "I John", 5, "john", "joh", "jn"),
  b("2JN", "II John", 1, "john", "joh", "jn"),
  b("3JN", "III John", 1, "john", "joh", "jn"),
  b("JUD", "Jude", 1, "jude", "jud"),
  b("REV", "Revelation", 22, "revelation", "revelations", "rev", "re"),
];

export function bookById(id: string): Book | undefined {
  return BOOKS.find((x) => x.id === id);
}

const NUMERAL = /^([123])/;
const ROMAN = ["", "i", "ii", "iii"];

// Every spelling a user might type -> book id. Numbered books accept 1/I with or without a space.
const KEYS = new Map<string, string>();
for (const book of BOOKS) {
  const n = NUMERAL.test(book.id) ? Number(book.id[0]) : 0;
  for (const alias of book.aliases) {
    if (!n) { KEYS.set(alias, book.id); continue; }
    for (const prefix of [String(n), ROMAN[n]]) {
      KEYS.set(`${prefix} ${alias}`, book.id);
      KEYS.set(`${prefix}${alias}`, book.id);
    }
  }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").replace(/\.+$/, "").trim();

// Longest run of leading tokens that names a book, plus the text after it.
function leadingBook(text: string): { book: Book; rest: string } | null {
  const tokens = text.trim().split(/\s+/);
  for (let k = Math.min(tokens.length, 5); k >= 1; k--) {
    const id = KEYS.get(norm(tokens.slice(0, k).join(" ")).replace(/\.(?=\s|$)/g, ""));
    if (id) return { book: bookById(id)!, rest: tokens.slice(k).join(" ") };
  }
  return null;
}

const TAIL = /^(\d+)(?::(\d+)(?:-(\d+))?)?$/;

export function parseRef(text: string): ParsedRef | null {
  const lead = leadingBook(text.trim().replace(/\.+$/, ""));
  if (!lead) return null;
  const m = TAIL.exec(lead.rest);
  if (!m) return null;
  const chapter = Number(m[1]);
  const from = m[2] === undefined ? 1 : Number(m[2]);
  const to = m[3] === undefined ? from : Number(m[3]);
  if (chapter < 1 || chapter > lead.book.chapters || from < 1 || to < from) return null;
  return { bookId: lead.book.id, book: lead.book.name, chapter, from, to };
}

export function canonicalRef(bookId: string, chapter: number, from: number, to: number): string {
  const name = bookById(bookId)?.name ?? bookId;
  return `${name} ${chapter}:${from}${to > from ? `-${to}` : ""}`;
}

// Optimal-string-alignment Damerau-Levenshtein distance.
function distance(a: string, b2: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b2.length).fill(0)]);
  for (let j = 0; j <= b2.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b2.length; j++) {
      const cost = a[i - 1] === b2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b2[j - 2] && a[i - 2] === b2[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b2.length];
}

// Candidates are the spellings of each book without a numeral; a numbered book suggests its
// base name ("Samuel") because the user's own numeral stays in the text that follows.
const SUGGESTIONS: { key: string; name: string; full: boolean }[] = [];
for (const book of BOOKS) {
  const name = book.name.replace(/^I{1,3} /, "");
  if (name !== book.name && SUGGESTIONS.some((s) => s.name === name)) continue;
  SUGGESTIONS.push({ key: name.toLowerCase(), name, full: true });
  for (const alias of book.aliases) SUGGESTIONS.push({ key: alias, name, full: false });
}

export function suggestBook(token: string): string | null {
  const t = norm(token);
  if (t.length < 3 || KEYS.has(t)) return null;
  // Short tokens collide with unrelated words, so they get a tighter edit budget.
  const budget = t.length <= 4 ? 1 : 2;
  // Ties go to a full book name over an abbreviation ("jhn" is John, not the abbreviation "jon").
  let best: { name: string; dist: number; full: boolean } | null = null;
  for (const s of SUGGESTIONS) {
    if (s.key.length < 3) continue;
    const dist = distance(t, s.key);
    if (dist <= budget && (!best || dist < best.dist || (dist === best.dist && s.full && !best.full))) {
      best = { name: s.name, dist, full: s.full };
    }
  }
  return best ? best.name : null;
}

export type Classified =
  | { kind: "empty" } | { kind: "ref"; ref: ParsedRef } | { kind: "suggest"; book: string; rest: string }
  | { kind: "invalid"; book: string } | { kind: "search" };

export function classify(text: string): Classified {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  const ref = parseRef(trimmed);
  if (ref) return { kind: "ref", ref };
  const lead = leadingBook(trimmed);
  if (lead) return { kind: "invalid", book: lead.book.name };
  const [first, ...others] = trimmed.split(/\s+/);
  const book = suggestBook(first);
  if (book) return { kind: "suggest", book, rest: others.join(" ") };
  return { kind: "search" };
}
