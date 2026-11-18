// Sets `artist` on every catalog row from the community sheet snapshot
// (scripts/data/card-artists-sheet.json, refreshed by `make pull-card-artists`),
// falling back to the scanner's machine-read credit line
// (lib/scan/generated/printingCues.json) for printings the sheet can't place.
// Mutates rows in place; '' means unknown.
//
// The sheet names printings its own way ("Abihu [C]" for our "Abihu ( C)",
// "Lost Soul [Ezekiel 34:12 - Or]" for "Lost Soul Ezekiel 34:12 (UL)") and
// labels sets by full name or by the old starter-deck letters, so a row is
// found in two passes — the exact name first, then the bare title — and each
// pass is narrowed by set and then by verse until one artist is left. A title
// whose rows still disagree is left to the fallback rather than guessed.

const SET_ALIASES = {
  Roots: ['Redemption Roots'],
  'Roots 2': ['Redemption Roots 2'],
  'Early Church': ['The Early Church', 'The Early Church (1st Print)'],
  'Persecuted Church': ['The Persecuted Church'],
  'Faith of Our Fathers': ['Faith of our Fathers', 'Faith of our Fathers #2'],
  'Rock of Ages': ['Rock of Ages', 'Rock of Ages #2', 'Rock of Ages #3'],
  'Thesaurus ex Preteritus': ['Thesaurus Ex Preteritus'],
  'Fall of Man': ['Fall of Man', 'Fall of Man (Legacy Rare)'],
  'Gospel of Christ': ['Gospel of Christ', 'Gospel of Christ (Legacy Rare)'],
  'Lineage of Christ': ['Lineage of Christ', 'Lineage of Christ (Legacy Rare)', 'Lineage of Christ (1st Print)'],
  'Prophecies of Christ': ['Prophecies of Christ', 'Prophecies of Christ (Legacy Rare)'],
  'Gospel of Christ Token': ['Gospel of Christ'],
  'Prophecies of Christ Token': ['Prophecies of Christ'],
  'Promo Token': ['Promo'],
  Promo2026: ['Promo'],
  'Times to Come (Alternate Border)': ['Times to Come'],
  // Starter-deck editions: the sheet files these under the deck letter.
  '2nd Edition': ['C Starter', 'D Starter'],
  '2nd Edition Revised': ['C Starter', 'D Starter'],
  '3rd Edition': ['E Starter', 'F Starter'],
  '10th Anniversary': ['G Starter', 'H Starter'],
  I: ['I Starter'],
  J: ['J Starter'],
};
// The first base set is one row per card with a comma list of the decks it was
// printed in: A/B (1st Edition), a/b (1st Edition Unlimited), L (Limited, our
// "Main") and Un (Unlimited, our "Main Unlimited").
const BASE_SET_TOKENS = {
  '1st Edition': ['A', 'B'],
  '1st Edition Unlimited': ['a', 'b'],
  Main: ['L'],
  'Main Unlimited': ['Un'],
};

const fold = (s) =>
  (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"');

const exactKey = (name) => fold(name).toLowerCase().replace(/\s+/g, ' ').trim();

const words = (s) =>
  fold(s)
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function titleKey(name) {
  const s = words(
    fold(name)
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/"[^"]*"/g, ' ')
      // Variant suffixes: "Elders of Jerusalem - Black Background".
      .replace(/\s+-\s+.*$/, '')
  );
  // Lost Souls are told apart by verse, which our names spell inline and the
  // sheet keeps in brackets or its Book/Chapter/Verse columns.
  return s.startsWith('lost soul') ? 'lost soul' : s;
}

// The words a name adds to its title — "(LoC Black/Pale Green)" or
// "[Black - TEC]" — which tell same-set variants apart.
function qualifiers(name) {
  const title = new Set(titleKey(name).split(' '));
  return new Set(words(name).split(' ').filter((w) => w && !title.has(w)));
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const refKey = (ref) => fold(ref).toLowerCase().replace(/[^a-z0-9]+/g, '');

function setMatches(card, rowSet) {
  const tokens = BASE_SET_TOKENS[card.officialSet];
  if (tokens) return rowSet.split(',').some((t) => tokens.includes(t.trim()));
  const names = SET_ALIASES[card.officialSet] || [card.officialSet];
  return names.some((n) => n.toLowerCase() === rowSet.toLowerCase());
}

// Keep the rows that pass, unless none do — a filter that matches nothing
// carries no information about which of the rows is right.
function narrow(rows, keep) {
  const kept = rows.filter(keep);
  return kept.length > 0 ? kept : rows;
}

const artistKey = (a) => fold(a).toLowerCase().replace(/[^a-z0-9]+/g, '');

function soleArtist(rows) {
  const byKey = new Map();
  for (const r of rows) if (!byKey.has(artistKey(r.artist))) byKey.set(artistKey(r.artist), r.artist);
  return byKey.size === 1 ? [...byKey.values()][0] : null;
}

const creditWords = (a) =>
  fold(a)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// "Illus. © Jamison Services, Inc." → "Jamison Services, Inc.". '' for a line
// holding any non-Latin letter — the Greek printings' credits ("Illυ. Μιχαηλ
// Καρρολλ"), which no search for the artist's name would ever find.
function cueArtist(illustrator) {
  if (!illustrator || /[^\P{L}\p{Script=Latin}]/u.test(illustrator)) return '';
  const a = illustrator.replace(/^\s*illus(trat(ed by|ion))?[.,:\s]*/i, '').replace(/©\s*/g, '').trim();
  return creditWords(a) ? a : '';
}

// Words that say nothing about who drew the card: every agency credit shares
// them ("Jeff Preston / GoodSalt.com" and "Carl Wuttke / GoodSalt.com" are
// different artists), and "Artist Unknown & Frans Pourbus" names someone that
// a bare "Artist Unknown" does not.
const GENERIC_CREDIT_WORDS = new Set([
  'and', 'the', 'com', 'inc', 'llc', 'ltd', 'goodsalt', 'productions', 'services',
  'studios', 'entertainment', 'software', 'publishing', 'press', 'artist', 'unknown',
]);

// Two credits name the same artist: lib/scan/cues.ts creditAgrees (two shared
// words, or one when either side has only one) over the distinctive words,
// plus up to two letters of misspelling ("Steven"/"Steve Firchow").
function sameCredit(a, b) {
  const x = creditWords(a);
  const y = creditWords(b);
  if (x === y) return true;
  const tokens = (s) => s.split(' ').filter((t) => t.length >= 3 && !GENERIC_CREDIT_WORDS.has(t));
  const tx = tokens(x);
  const ty = tokens(y);
  if (tx.length === 0 && ty.length === 0) return true; // "Artist Unknown" / "Unknown Artist"
  const shared = tx.filter((t) => ty.includes(t)).length;
  if (shared >= 2 || (shared >= 1 && Math.min(tx.length, ty.length) === 1)) return true;
  return editDistance(x.replace(/ /g, ''), y.replace(/ /g, '')) <= 2;
}

// A credit cell the sheet filled with something else — one row carries its
// verse ("II Kings 2:11") in the Artist column.
const isCredit = (a) => !!a && !/\d+:\d+/.test(a);
const cleanCredit = (a) => a.replace(/©\s*/g, '').replace(/\s+/g, ' ').trim();

// Narrow a title's rows down to one artist for this printing: its set, then
// its verse, then the variant words in its name. null when they still disagree.
// verseRequired: the rows are not all the same card — every Lost Soul shares
// one title, and a near-miss title can be a different card (King Jehoiakim /
// Jehoiakin) — so only a row with this printing's verse may answer.
function resolvePool(card, pool, verseRequired) {
  const sameVerse = (r) => refKey(r.ref) === refKey(card.reference);
  if (verseRequired) pool = pool.filter(sameVerse);
  const inSet = pool.filter((r) => setMatches(card, r.set));
  let p = narrow(inSet.length > 0 ? inSet : pool, sameVerse);
  // Same-verse variants of one card ("Aliens [Black/Pale Green]" vs
  // "[Brown/Gray]") are told apart by the words their names add.
  if (!soleArtist(p) && new Set(p.map((r) => refKey(r.ref))).size === 1) {
    const want = qualifiers(card.name);
    const score = (r) => [...qualifiers(r.name)].filter((w) => want.has(w)).length;
    const best = Math.max(...p.map(score));
    if (best > 0) p = p.filter((r) => score(r) === best);
  }
  return { artist: soleArtist(p), inSet: inSet.length > 0, rows: p };
}

function applyCardArtists(cards, snapshot, printingCues) {
  const rows = (Array.isArray(snapshot && snapshot.rows) ? snapshot.rows : [])
    .filter((r) => r && r.name && isCredit(r.artist))
    .map((r) => ({ ...r, artist: cleanCredit(r.artist) }));
  const cues = printingCues || {};
  const byExact = new Map();
  const byTitle = new Map();
  for (const r of rows) {
    const e = exactKey(r.name);
    const t = titleKey(r.name);
    if (!byExact.has(e)) byExact.set(e, []);
    byExact.get(e).push(r);
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(r);
  }

  // sheetSet: placed by a row from the printing's own set. sheetName: every
  // row for the title agrees, but none is filed under this printing's set.
  // sheetFuzzy: our name is a misspelling of a title in the printing's own set.
  // scanOverride: the scan named a different artist than the sheet's pick.
  const stats = { sheetSet: 0, sheetName: 0, sheetFuzzy: 0, scanOverride: 0, scan: 0, none: 0 };
  const unresolved = [];
  const methods = new Map();
  for (const card of cards) {
    const title = titleKey(card.name);
    const attempts = [
      [byExact.get(exactKey(card.name)), false],
      [byTitle.get(title), title === 'lost soul'],
    ]
      .filter(([pool]) => pool)
      .map(([pool, verseRequired]) => resolvePool(card, pool, verseRequired));
    const cue = cues[`${card.name}|${card.set}|${card.imgFile}`];
    const fromScan = cueArtist(cue && cue.illustrator);
    // An exact-name hit filed under other sets loses to a title hit from this set.
    let pick = attempts.find((a) => a.artist && a.inSet);
    // A title the sheet only lists under other sets is a guess that the art
    // carried over. Made only for printings that reuse art by definition —
    // Alternate Border reprints and tokens: checked against the card images,
    // it was wrong for 3 of 7 ordinary reprints (Magnificat (Di) is Carl
    // Bloch, not the Tissot of its other printings).
    if (!pick && /Alternate Border|Token/.test(card.officialSet)) pick = attempts.find((a) => a.artist);
    if (pick) pick = { ...pick, method: pick.inSet ? 'sheetSet' : 'sheetName' };
    // Typos on either side ("Priiest", "Calvery"): titles within two edits,
    // trusted only when the printing's own set and verse confirm the row.
    if (!pick && attempts.length === 0 && title.length >= 8) {
      const near = [];
      for (const [t, pool] of byTitle) {
        if (editDistance(t, title) <= 2) near.push(...pool.filter((r) => setMatches(card, r.set)));
      }
      const fuzzy = near.length > 0 ? resolvePool(card, near, true) : null;
      if (fuzzy && fuzzy.artist) pick = { ...fuzzy, method: 'sheetFuzzy' };
    }
    // The scanner read this very printing's credit line. Checked against the
    // card images, it was right every time it named a different artist from
    // the sheet (promo reprints, art swaps the sheet missed), while its
    // spelling slips ("Blonnoury") lose to the sheet's.
    if (pick && fromScan && !sameCredit(pick.artist, fromScan)) {
      card.artist = fromScan;
      stats.scanOverride++;
      methods.set(card, 'scanOverride');
      continue;
    }
    if (pick) {
      card.artist = pick.artist;
      stats[pick.method]++;
      methods.set(card, pick.method);
      continue;
    }
    const candidates = attempts.length > 0 ? attempts[attempts.length - 1].rows : [];
    if (fromScan) {
      card.artist = fromScan;
      stats.scan++;
      methods.set(card, 'scan');
      continue;
    }
    card.artist = '';
    stats.none++;
    unresolved.push({
      name: card.name,
      set: card.set,
      candidates: [...new Set(candidates.map((r) => `${r.artist} (${r.set})`))],
    });
  }
  // One spelling per artist, so an Artist search for "Jean-Leon Gerome" finds
  // the printings credited "Jean Leon Gerome" too: the most common spelling,
  // ties going to the accented one ("Zurbarán" over "Zurbaran").
  const spellings = new Map();
  for (const card of cards) {
    if (!card.artist) continue;
    const k = artistKey(card.artist);
    if (!spellings.has(k)) spellings.set(k, new Map());
    const counts = spellings.get(k);
    counts.set(card.artist, (counts.get(card.artist) || 0) + 1);
  }
  const accents = (s) => s.normalize('NFKD').length - fold(s).length; // combining marks
  const canonical = new Map();
  for (const [k, counts] of spellings) {
    const [best] = [...counts].sort(
      ([a, na], [b, nb]) => nb - na || accents(b) - accents(a) || (a < b ? -1 : a > b ? 1 : 0)
    );
    canonical.set(k, best[0]);
  }
  for (const card of cards) if (card.artist) card.artist = canonical.get(artistKey(card.artist));

  return { stats, unresolved, methods };
}

module.exports = { applyCardArtists, titleKey, setMatches, cueArtist, sameCredit, artistKey };
