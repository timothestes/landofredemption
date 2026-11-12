// Generates lib/cards/deckSearchAbilities.ts and its spacetimedb copy from
// carddata text. For every "search deck for X", "take/play/add X from deck" and
// "exchange this card with X from deck" clause it parses X into DeckCardMatch
// alternatives, or flags it (anything needing rules judgement is skipped). It
// counts how many pool cards each alternative matches, so typos and dead
// filters show up, and refuses to write a filter that matches nothing.
//
//   node scripts/generate-deck-search-abilities.mjs [review.json]
//
// review.json (optional) gets every clause with its parse and flags.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cardsPath = `${repoRoot}/lib/cards/generated/cardData.json`;
const registryPath = `${repoRoot}/lib/cards/cardAbilities.ts`;
const outPath = process.argv[2] ?? null;
const cards = JSON.parse(readFileSync(cardsPath, 'utf8'));
const regSrc = readFileSync(registryPath, 'utf8');
const registered = new Map();
for (const m of regSrc.matchAll(/^\s{2}(['"])(.+?)\1:\s+\[(.*)$/gm)) registered.set(m[2], [...m[3].matchAll(/type: '([a-z_]+)'/g)].map((t) => t[1]));

// ---------- vocab ----------
const BOOKS = ['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', 'I Samuel', 'II Samuel', 'I Kings', 'II Kings', 'I Chronicles', 'II Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalm', 'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi', 'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', 'I Corinthians', 'II Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians', 'I Thessalonians', 'II Thessalonians', 'I Timothy', 'II Timothy', 'Titus', 'Philemon', 'Hebrews', 'James', 'I Peter', 'II Peter', 'I John', 'II John', 'III John', 'Jude', 'Revelation'];
const BOOK_ALIASES = { gospel: ['Matthew', 'Mark', 'Luke', 'John'], psalms: ['Psalm'], samuel: ['I Samuel', 'II Samuel'], kings: ['I Kings', 'II Kings'], chronicles: ['I Chronicles', 'II Chronicles'] };
const TYPES = [
  ['evil characters', ['Evil Character']], ['evil character', ['Evil Character']],
  ['lost souls', ['Lost Soul']], ['lost soul', ['Lost Soul']],
  ['heroes', ['Hero']], ['hero', ['Hero']], ['characters', ['character']], ['character', ['character']],
  ['enhancements', ['Enhancement']], ['enhancement', ['Enhancement']], ['ge', ['GE']], ['ee', ['EE']],
  ['fortresses', ['Fortress']], ['fortress', ['Fortress']], ['sites', ['Site']], ['site', ['Site']],
  ['cities', ['City']], ['city', ['City']], ['artifacts', ['Artifact']], ['artifact', ['Artifact']],
  ['dominants', ['Dominant']], ['dominant', ['Dominant']], ['curses', ['Curse']], ['curse', ['Curse']],
  ['covenants', ['Covenant']], ['covenant', ['Covenant']], ['cards', []], ['card', []],
];
const BRIGADES = ['pale green', 'white', 'black', 'silver', 'green', 'purple', 'gold', 'clay', 'red', 'teal', 'blue', 'brown', 'orange', 'crimson', 'gray', 'grey'];
const CLASSES = [['weapons', 'Weapon'], ['weapon', 'Weapon'], ['warriors', 'Warrior'], ['warrior', 'Warrior'], ['cloud', 'Cloud'], ['*', 'Star']];
// Character traits: when no type is printed, these mean a character.
const CHAR_TRAITS = ['king of israel', 'king of judah', 'son of jacob', 'flood survivor', 'angel', 'demon', 'king', 'prophet', 'priest', 'disciple', 'apostle', 'judge', 'musician', 'heretic', 'magician', 'sadducee', 'pharisee', 'antediluvian', 'postexilic', 'patriarch', 'missionary', 'thief', 'giant', 'egyptian', 'philistine', 'moabite', 'canaanite', 'babylonian', 'roman', 'assyrian', 'persian', 'syrian', 'edomite', 'greek', 'samaritan', 'animal', 'lion', 'herod'];
const OTHER_TRAITS = ["solomon's temple", 'armor of god', 'tabernacle artifact', 'temple artifact', 'priestly artifact', 'heavenly temple artifact', 'heavenly temple', 'involves music', 'involve music', 'nativity', 'idol', 'temple', 'tabernacle', 'wilderness', 'corinth', 'joppa', 'empty tomb', 'samaria'];
// Words that make a target a judgement call — skip the clause.
const JUDGEMENT = /\b(human|humans|male|female|royal|meek|generic|single-brigade|multi-brigade|single color|matching|random|toughness|strength|except|ability|depicting|dual icon|healing|X|reserved|from hand|of your choice|teal|child of|grim reaper|set-aside|reference|both of)\b|^(?:it|one|them|this card)$/i;
// Card-name lookup. Keys are lowercased names with set suffixes stripped, plus
// each half of a dual name ("Whirlwind / Everlasting Ground" → "whirlwind").
const CARD_BASE = new Map();
const base = (n) => n.replace(/[’‘]/g, "'").replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const display = (n) => n.replace(/[’‘]/g, "'").replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/\s+/g, ' ').trim();
for (const c of cards) {
  CARD_BASE.set(base(c.name), display(c.name));
  for (const half of display(c.name).split(' / ')) if (!CARD_BASE.has(half.toLowerCase())) CARD_BASE.set(half.toLowerCase(), half);
}
function lookupName(alt) {
  const s = alt.trim().replace(/^["'“”]+|["'“”]+$/g, '').replace(/[“”]/g, '').toLowerCase();
  if (CARD_BASE.has(s)) return CARD_BASE.get(s);
  if (s.startsWith('the ') && CARD_BASE.has(s.slice(4))) return CARD_BASE.get(s.slice(4));
  return null;
}

// ---------- pool matcher (mirror of the runtime rule, for validation) ----------
const typeParts = (c) => c.type.split('/').map((s) => s.trim());
function typeOk(c, t) {
  const p = typeParts(c);
  if (t === 'character') return p.includes('Hero') || p.includes('Evil Character');
  if (t === 'Enhancement') return p.includes('GE') || p.includes('EE');
  return p.includes(t);
}
function alignOk(c, a) {
  const p = typeParts(c);
  if (a === 'good') return c.alignment === 'Good' || p.includes('GE') || p.includes('Hero');
  if (a === 'evil') return c.alignment === 'Evil' || p.includes('EE') || p.includes('Evil Character');
  return c.alignment === 'Neutral';
}
const REF_RE = /((?:I{1,3}|IV)\s+)?([A-Z][a-z]+(?: of [A-Z][a-z]+)?)\.?\s+(\d+)/g;
const refs = (r) => [...r.matchAll(REF_RE)].map((m) => ({ book: `${m[1] ? m[1].trim() + ' ' : ''}${m[2]}`, ch: Number(m[3]) }));
const NT = new Set(BOOKS.slice(BOOKS.indexOf('Matthew')));
function testamentOk(c, t) {
  if (/old testament/i.test(c.reference)) return t === 'OT';
  if (/new testament/i.test(c.reference)) return t === 'NT';
  return refs(c.reference).some((r) => BOOKS.includes(r.book) && (NT.has(r.book) ? 'NT' : 'OT') === t);
}
const brigadeSet = (c) => new Set(c.brigade.toLowerCase().replace(/pale green/g, 'palegreen').split(/[^a-z]+/).filter(Boolean));
// Optionally plural, never possessive ("Herod's Guard" is not a Herod).
const wordRe = (w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?\\b(?![’'])`, 'i');
const halfAlign = (c, h) => (h === 'Hero' || h === 'GE' ? 'good' : h === 'Evil Character' || h === 'EE' ? 'evil' : c.alignment.toLowerCase());
// Identifier minus "X = …" counting notes and "Holds …" notes — both name
// OTHER cards' traits ("Holds a Heavenly Temple Artifact" is not one).
const identText = (c) => c.identifier.replace(/[’‘]/g, "'").replace(/X\s*=[^,\]]*/g, '').replace(/\bholds?\b[^,\]]*/gi, '');
// A trait in the NAME counts unless it follows "of (the)": "Servants of the King" is not a king.
function nameHasTrait(name, t) {
  const re = new RegExp(wordRe(t).source, 'gi');
  for (const m of name.replace(/[’‘]/g, "'").matchAll(re)) if (!/\bof (?:the )?$/i.test(name.slice(0, m.index))) return true;
  return false;
}
const isCharacter = (c) => typeParts(c).some((h) => h === 'Hero' || h === 'Evil Character');
// A card "is" name N when its name (set suffix dropped), or either half of a
// dual name, is N or "N, <title>". For characters a title holding the whole
// name also counts (REG): "David the Psalmist", "Moses in Glory", "King Saul".
function nameIs(c, n) {
  const want = n.toLowerCase();
  return base(c.name).split(' / ').some((h) => h === want || h.startsWith(`${want},`)
    || (isCharacter(c) && (h.startsWith(`${want} `) || h === `king ${want}` || h.startsWith(`king ${want} `) || h.startsWith(`king ${want},`))));
}
function matchOne(c, m) {
  if (m.types && m.alignments) {
    // One type half must carry both the type and the alignment.
    if (!typeParts(c).some((h) => m.types.some((t) => typeOk({ type: h }, t)) && m.alignments.includes(halfAlign(c, h)))) return false;
  } else {
    if (m.types && !m.types.some((t) => typeOk(c, t))) return false;
    if (m.alignments && !m.alignments.some((a) => alignOk(c, a))) return false;
  }
  if (m.testament && !testamentOk(c, m.testament)) return false;
  if (m.books) {
    const rs = refs(c.reference).filter((r) => m.books.includes(r.book));
    if (!rs.length) return false;
    if (m.chapters && !rs.some((r) => r.ch >= m.chapters[0] && r.ch <= m.chapters[1])) return false;
  }
  if (m.brigades) { const s = brigadeSet(c); if (!m.brigades.some((b) => s.has(b.toLowerCase().replace(' ', '')))) return false; }
  if (m.singleBrigade) { const s = brigadeSet(c); if (s.size !== 1 || s.has('multi')) return false; }
  if (m.cardClass && !c.class.split(/[,/]/).map((s) => s.trim()).includes(m.cardClass)) return false;
  if (m.traits && !m.traits.every((t) => wordRe(t).test(identText(c)) || nameHasTrait(c.name, t))) return false;
  if (m.unique && /\bgeneric\b/i.test(c.identifier)) return false;
  if (m.names && !m.names.some((n) => nameIs(c, n))) return false;
  if (m.nameIncludes && !m.nameIncludes.some((n) => c.name.toLowerCase().includes(n.toLowerCase()))) return false;
  return true;
}

// ---------- target parser ----------
const LEAD = /^(?:a|an|any|one|two|three|up to (?:\d+|two|three)|\d+)\s+/i;
function parseAlt(alt, titleWords) {
  // Whole alternative is a card name ("Whirlwind", "A Child is Born", "Phinehas, the Useless").
  const named = !alt.includes('TITLEPH') && lookupName(alt);
  if (named) return { names: [named] };
  // "different" (Edomite/Persian): a same-name copy in deck would also show — rare, and Show all covers the reverse.
  let s = ` ${alt.replace(LEAD, '').toLowerCase().replace(/\b(?:your|brigade|class|that|different)\b/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const m = {};
  const take = (re) => { const hit = s.match(re); if (hit) s = s.replace(re, ' '); return hit; };
  let t;
  if (take(/ titleph /)) m.nameIncludes = titleWords;
  if (take(/ unique /)) m.unique = true;
  if (take(/ good /)) (m.alignments ??= []).push('good');
  if (take(/ evil (?!characters? )/)) (m.alignments ??= []).push('evil');
  if (take(/ neutral /)) (m.alignments ??= []).push('neutral');
  if (take(/ ot /)) m.testament = 'OT';
  if (take(/ nt /)) m.testament = 'NT';
  for (const b of BRIGADES) if (take(new RegExp(` ${b} `))) (m.brigades ??= []).push(b === 'grey' ? 'Gray' : b.replace(/\b\w/g, (x) => x.toUpperCase()));
  for (const b of [...BOOKS].sort((a, z) => z.length - a.length)) {
    if ((t = take(new RegExp(` ${b.toLowerCase()}(?: (\\d+)-(\\d+))? `)))) { (m.books ??= []).push(b); if (t[1]) m.chapters = [Number(t[1]), Number(t[2])]; }
  }
  for (const [alias, list] of Object.entries(BOOK_ALIASES)) if (take(new RegExp(` ${alias} `))) (m.books ??= []).push(...list);
  for (const [w, cls] of CLASSES) if (s.includes(` ${w} `)) { s = s.replace(` ${w} `, ' '); m.cardClass = cls; }
  for (const tr of [...CHAR_TRAITS, ...OTHER_TRAITS].sort((a, z) => z.length - a.length)) {
    if (take(new RegExp(` ${tr}(?:s|es)? `))) (m.traits ??= []).push(tr === 'involve music' ? 'involves music' : tr);
  }
  for (const [w, ts] of TYPES) if (s.includes(` ${w} `)) { s = s.replace(` ${w} `, ' '); if (ts.length) (m.types ??= []).push(...ts); }
  // A trait with no printed type is the head noun ("a king", "an idol"), not a
  // modifier — remember that, so a following "or weapon"/"or Curse" doesn't
  // inherit it. A character trait as head means a character.
  if (m.traits && !m.types && !m.cardClass) m.traitIsHead = true;
  // Same for a class with no printed type ("a weapon", "a warrior").
  if (m.cardClass && !m.types) m.classIsHead = true;
  if (m.cardClass === 'Warrior' && !m.types) m.types = ['character'];
  // ORDIR: only Artifacts (and Curses marked Idol) are idols; only Heroes are disciples.
  if (m.traits?.includes('idol') && !m.types) m.types = ['Artifact', 'Curse'];
  if (m.traits?.includes('disciple') && !m.types) m.types = ['Hero'];
  if (m.traits?.some((x) => CHAR_TRAITS.includes(x)) && !m.types) m.types = ['character'];
  // A bare "Temple" is a Fortress (one Site); "Temple Artifact"/"Temple priest" carry their own head.
  if (m.traits?.length === 1 && m.traits[0] === 'temple' && !m.types) m.types = ['Fortress', 'Site'];
  const left = s.replace(/\b(?:and|or|of|from|deck|to|hand|battle|play|it|in|put)\b/g, ' ').trim();
  return left ? { leftover: left, ...m } : m;
}

function parseTarget(target) {
  let clean = target
    .replace(/^.*?\byou may (?:take|play|add)\s+/i, '')
    .replace(/^if you have attacked this turn\)\s*/i, '')
    .replace(/^or (?:activate|equip)\s+/i, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/,?\s+or\s+(?=(?:[A-Z]\w+\s+)?(?:may|must)\b|draw\b|discard\b|exchange\b).*$/i, '')
    .replace(/\s+and (?:put|place|add|activate|play|band)\b.*$/i, '')
    .replace(/\s+to (?:battle|hand|play)\b.*$/i, '')
    .replace(/[,\s]+$/, '')
    .trim();
  // A whole-target card name may itself contain commas ("Phinehas, the Useless").
  // Looked up as printed — "up to 3 lions" is not the card named "Lions".
  const whole = lookupName(clean);
  if (whole) return { clean, parsed: [{ names: [whole] }], alts: [clean] };
  // "with 'X' (or 'Y') in the title" → placeholder, so its "or" doesn't split alternatives.
  let titleWords = null;
  clean = clean.replace(/\s+with\s+(.+?)\s+in (?:the|its) (?:title|name)/i, (_, inner) => {
    titleWords = inner.replace(/'s name$/i, '').split(/\s+or\s+/i).map((w) => w.replace(/["'“”]/g, '').replace(/'s name$/i, '').trim());
    return ' TITLEPH';
  });
  const alts = clean.split(/\s*,\s*(?:or\s+)?|\s+or\s+|\s+and\/or\s+|\s+and\s+(?=an?\s)/i).filter(Boolean);
  const parsed = alts.map((a) => parseAlt(a, titleWords));
  // What each alternative printed itself, before any sharing.
  const MODS = ['alignments', 'testament', 'brigades', 'books', 'cardClass', 'traits'];
  const own = parsed.map((p) => new Set(MODS.filter((k) => p[k] !== undefined && !(k === 'traits' && p.traitIsHead) && !(k === 'cardClass' && p.classIsHead))));
  // Head noun shared backwards: "a Genesis or Exodus Fortress", "a good or
  // neutral Joshua card" — an alternative with no head borrows ONLY the next
  // one's head (its type; a class or trait only when that is the head), not
  // its modifiers: "a Genesis or cloud Hero" is a Genesis Hero or a cloud Hero.
  for (let i = parsed.length - 2; i >= 0; i--) {
    const p = parsed[i], n = parsed[i + 1];
    if (!p.types && !p.traits && !p.cardClass && !p.names && !p.nameIncludes && !/\bcards?\b/i.test(alts[i])) {
      if (n.types) p.types = n.types;
      if (n.traitIsHead) { p.traits = n.traits; p.traitIsHead = true; }
      if (n.cardClass && !n.types) p.cardClass = n.cardClass;
      // "a good or neutral Joshua card": the two contrast on good/neutral, so
      // the rest of the next one's modifiers (Joshua) belong to both.
      const contrast = [...own[i]].filter((k) => own[i + 1].has(k));
      if (contrast.length) {
        for (const k of own[i + 1]) {
          if (contrast.includes(k) || p[k] !== undefined) continue;
          p[k] = n[k];
          own[i].add(k);
          if (k === 'books' && n.chapters && !p.chapters) p.chapters = n.chapters;
        }
      }
      p.borrowedHead = true;
    }
  }
  // Modifiers shared forwards. A later alternative printed WITHOUT its own
  // article takes earlier modifiers it lacks:
  //  - a bare noun takes them all: "a Roman Site or Fortress";
  //  - after "<mods> X or Y <head>", the slot the two contrast on (books in
  //    "a gold Luke or John Hero") stays apart and the rest is shared (gold);
  //    with no shared slot ("a Genesis or cloud Hero") nothing is shared.
  // "a N.T. good Fortress or N.T. Site" (earlier one has its own head, later
  // one its own modifiers) shares nothing. A head-noun trait never carries.
  for (let i = 1; i < parsed.length; i++) {
    const p = parsed[i], prev = parsed[i - 1];
    if (p.names || prev.names || /^(?:a|an|the)\s/i.test(alts[i].trim())) continue;
    let carry;
    if (own[i].size === 0) carry = [...own[i - 1]];
    else if (prev.borrowedHead) {
      const contrast = [...own[i - 1]].filter((k) => own[i].has(k));
      carry = contrast.length ? [...own[i - 1]].filter((k) => !own[i].has(k)) : [];
    } else carry = [];
    for (const k of carry) {
      if (p[k] !== undefined) continue;
      p[k] = prev[k];
      if (k === 'books' && prev.chapters && !p.chapters) p.chapters = prev.chapters;
    }
  }
  for (const p of parsed) { delete p.traitIsHead; delete p.classIsHead; delete p.borrowedHead; }
  return { clean: clean.replace(' TITLEPH', titleWords ? ` with "${titleWords.join('" or "')}" in the title` : ''), parsed, alts };
}

// ---------- rule-defined groups (ORDIR 7.1) ----------
// Printed identifiers don't carry these groups reliably, so each trait is
// rewritten into what the rulings document defines it as.
const TABERNACLE_ARTIFACTS = ["Aaron's Staff", 'Altar of Burnt Offering', 'Altar of Incense', 'Ark of the Covenant', 'Book of the Covenant', 'Book of the Law', 'Holy of Holies', 'Lampstand of the Sanctuary', 'Pot of Manna', 'Table of Showbread', 'Tables of the Law', 'Temple Veil', 'The Bronze Laver', 'The Golden Lampstand'];
const TEMPLE_ARTIFACTS = [...TABERNACLE_ARTIFACTS, 'Golden Cherubim', 'Windows of Narrow Light'];
// ORDIR names these outright; most other printings carry the identifier.
const EXTRA_GROUP_NAMES = {
  wilderness: ['Caleb', 'Hur', 'Miriam', 'Moses', 'Spy', 'Generations of Priests', 'Ordained Priests', 'The Israelite Foremen', 'The Tribal Elders', 'Indentured Servant'],
  postexilic: ['Haggai', 'Joshua the High Priest', 'Malachi'],
};
const without = (m, trait) => { const traits = (m.traits ?? []).filter((t) => t !== trait); const o = { ...m, traits }; if (!traits.length) delete o.traits; return o; };
function expandGroups(alts) {
  const out = [];
  for (const m of alts) {
    const t = m.traits ?? [];
    if (t.includes('tabernacle artifact')) out.push({ ...without(m, 'tabernacle artifact'), types: ['Artifact'], names: TABERNACLE_ARTIFACTS });
    else if (t.includes('heavenly temple artifact')) out.push({ ...without(m, 'heavenly temple artifact'), types: ['Artifact'], traits: ['heavenly temple'] });
    else if (t.includes('temple artifact')) out.push({ ...without(m, 'temple artifact'), types: ['Artifact'], names: TEMPLE_ARTIFACTS });
    else if (t.includes('angel')) {
      // Angels are Heroes: marked Angel, or single-brigade silver at face value. Demons never are.
      out.push({ ...m, types: ['Hero'] }, { ...without(m, 'angel'), types: ['Hero'], brigades: ['Silver'], singleBrigade: true, _x: true });
    } else if (t.includes('demon')) {
      // Demons: marked Demon, or single-brigade orange Evil Characters.
      out.push({ ...m, types: ['Evil Character'] }, { ...without(m, 'demon'), types: ['Evil Character'], brigades: ['Orange'], singleBrigade: true, _x: true });
    } else if (t.includes('king')) {
      // A king, emperor or pharaoh in the title.
      out.push(m);
      for (const k of ['emperor', 'pharaoh']) out.push({ ...without(m, 'king'), traits: [...(without(m, 'king').traits ?? []), k], _x: true });
    } else if (t.includes('antediluvian')) {
      // All flood survivors are antediluvians.
      out.push(m, { ...without(m, 'antediluvian'), traits: [...(without(m, 'antediluvian').traits ?? []), 'flood survivor'], _x: true });
    } else if (t.includes('nativity')) {
      // Nativity = Matthew 1:18–2, Luke 1–2.
      const rest = without(m, 'nativity');
      out.push(m, { ...rest, books: ['Luke'], chapters: [1, 2], _x: true }, { ...rest, books: ['Matthew'], chapters: [2, 2], _x: true });
    } else {
      out.push(m);
      for (const [g, names] of Object.entries(EXTRA_GROUP_NAMES)) if (t.includes(g)) out.push({ ...without(m, g), names, _x: true });
    }
  }
  return out;
}

// ---------- clause scan ----------
// A list of piles ("deck", "deck or discard pile", "hand, deck, Reserve or
// territory"); a clause counts only when the list includes the deck — the
// window shows the deck, the other piles stay manual.
const PILE = String.raw`(?:(?:your|the|own)\s+)?(?:deck|draw pile|discard pile|Reserve|hand|territory)`;
const PILES = String.raw`${PILE}(?:(?:,\s*(?:or\s+)?|\s+or\s+)${PILE})*`;
const CLAUSES = [
  { kind: 'search_deck', re: new RegExp(String.raw`\bsearch (${PILES}) for ([^.:;]+)`, 'gi'), target: 2, piles: 1 },
  { kind: 'search_deck', re: new RegExp(String.raw`\b(?:take|play|add)\s+((?:(?!\bfrom\b)[^.:;])+?)\s+from (${PILES})`, 'gi'), target: 1, piles: 2 },
  { kind: 'exchange_with_deck', re: new RegExp(String.raw`\bexchange this (?:card|Hero) with ((?:(?!\b(?:from|in)\b)[^.:;])+?)\s+(?:from|in) (${PILES})`, 'gi'), target: 1, piles: 2 },
];
const entries = [];
for (const c of cards) {
  let text = c.specialAbility.replace(/\bO\.\s?T\./g, 'OT').replace(/\bN\.\s?T\./g, 'NT').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
  // Split into ability segments, remembering which are (Star) / STAR.
  // Any icon marker starts a new ability: "(Star)", "(HE)", "(Hero)", "STAR:",
  // "H:", "FORT:", "ART:", … or a dual card's " / " half.
  const segs = text.split(/(?=\((?:Star|Hero|[A-Z]{1,6})\)|\b[A-Z]{1,6}:|\s\/\s)/);
  for (const seg of segs) {
    const star = /^\s*(?:\(Star\)|STAR:)/.test(seg);
    for (const cl of CLAUSES) {
      for (const hit of seg.matchAll(cl.re)) {
        if (!/\b(?:deck|draw pile)\b/i.test(hit[cl.piles])) continue;
        let target = hit[cl.target].trim().replace(/^you may\s+/i, '');
        if (/opponent|top|bottom|discard pile/i.test(target)) continue;
        // "Opponent may take X from deck" — not the activator's effect.
        if (/opponent\S*\s+(?:may|must)\s*$/i.test(seg.slice(Math.max(0, hit.index - 30), hit.index))) continue;
        entries.push({ card: c.name, rotation: c.legality === 'Rotation', kind: cl.kind, star, clause: hit[0].trim(), target });
      }
    }
  }
}

const out = [];
for (const e of entries) {
  const { clean, parsed } = parseTarget(e.target);
  const flags = [];
  // Raw target too: parentheticals ("(except a Dominant)") are stripped from clean.
  if (JUDGEMENT.test(clean) || JUDGEMENT.test(e.target)) flags.push('judgement');
  if (parsed.some((p) => p.leftover)) flags.push(`leftover: ${parsed.map((p) => p.leftover).filter(Boolean).join(' | ')}`);
  // A rule-added alternative that matches nothing (an EVIL flood survivor, a
  // GOOD pharaoh) is just dropped; the printed one still decides the entry.
  const match = expandGroups(parsed.map(({ leftover, ...m }) => m))
    .filter((m) => !m._x || cards.some((c) => matchOne(c, m)))
    .map(({ _x, ...m }) => m);
  if (match.some((m) => !Object.keys(m).length)) flags.push('empty alternative');
  const counts = match.map((m) => cards.filter((c) => matchOne(c, m)).length);
  if (counts.some((n) => n === 0)) flags.push(`dead alternative: ${counts.join('/')}`);
  const label = clean.replace(/\bOT\b/g, 'O.T.').replace(/\bNT\b/g, 'N.T.');
  out.push({ ...e, label, match, counts, flags, registered: registered.get(e.card) ?? null });
}
if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 2));

// ---------- hand overrides (card name → replacement entries, or null = skip) ----------
const GOSPEL = ['Matthew', 'Mark', 'Luke', 'John'];
const ABRAHAM = ['Abraham', 'Abram', 'Father Abraham', 'Faithful Abraham', 'Abram/Abraham'];
const OVERRIDES = {
  // "(except a Hero)": a Gospel character that isn't a Hero is a Gospel Evil Character.
  'Golgotha (GoC)': [{ kind: 'search_deck', label: 'a Gospel character (except a Hero)', match: [{ types: ['Evil Character'], books: GOSPEL }] }],
  'Golgotha [2022 - GoC P]': [{ kind: 'search_deck', label: 'a Gospel character (except a Hero)', match: [{ types: ['Evil Character'], books: GOSPEL }] }],
  // Two picks ("… and …"): show both kinds.
  'The Resurrection (GoC)': [{ kind: 'search_deck', label: 'a good Gospel Fortress and an empty tomb Hero', match: [{ alignments: ['good'], books: GOSPEL, types: ['Fortress'] }, { traits: ['empty tomb'], types: ['Hero'] }] }],
  'The Resurrection [UR+] (GoC)': [{ kind: 'search_deck', label: 'a good Gospel Fortress and an empty tomb Hero', match: [{ alignments: ['good'], books: GOSPEL, types: ['Fortress'] }, { traits: ['empty tomb'], types: ['Hero'] }] }],
  // (Genesis or Exodus) × (Site or Fortress).
  'The Murdering Pharaoh': [{ kind: 'search_deck', label: 'a Genesis or Exodus Site or Fortress', match: [{ books: ['Genesis', 'Exodus'], types: ['Site', 'Fortress'] }] }],
  'The Murdering Pharaoh (CoW AB)': [{ kind: 'search_deck', label: 'a Genesis or Exodus Site or Fortress', match: [{ books: ['Genesis', 'Exodus'], types: ['Site', 'Fortress'] }] }],
  // "…to take an idol and add your priest from hand, deck, territory or
  // Reserve to battle": the idol is taken from play; the priest is the deck pick.
  'Captive Priest': [{ kind: 'search_deck', label: 'your priest', match: [{ traits: ['priest'], types: ['Hero'] }] }],
  // ORDIR duplicates: Abram / Abraham / Faithful Abraham / Father Abraham are one character.
  'Faith of Abraham (CoW)': [{ kind: 'search_deck', label: 'Abraham', match: [{ names: ABRAHAM }] }],
  'Faith of Abraham (CoW AB)': [{ kind: 'search_deck', label: 'Abraham', match: [{ names: ABRAHAM }] }],
  // ORDIR duplicate: Saul of Tarsus is Paul.
  'Ananias of Damascus [RR2]': [{ kind: 'search_deck', label: 'Paul', match: [{ names: ['Paul', 'Saul of Tarsus'] }] }],
  // A Hero adds a Hero to battle — the evil Tabernacle priests (Hophni, Nadab, …) don't qualify.
  'Ahitub, the High Priest': [{ kind: 'search_deck', label: 'a Tabernacle priest', match: [{ traits: ['tabernacle', 'priest'], types: ['Hero'] }] }],
};

// ---------- hand additions (appended to whatever the text scan produced) ----------
const NOT_DOMINANT = ['Hero', 'Evil Character', 'Enhancement', 'Fortress', 'Site', 'City', 'Artifact', 'Curse', 'Covenant', 'Lost Soul'];
const DESCENDANT_STAR = { kind: 'search_deck', label: 'a Hero', match: [{ types: ['Hero'] }], star: true }; // "STAR: Reveal hand: If there is no Hero, take one from deck."
const EXTRA = {
  'Boaz’ Offspring (LoC)': [DESCENDANT_STAR],
  "David's Descendant (LoC)": [DESCENDANT_STAR],
  "Abraham's Descendant (LoC)": [DESCENDANT_STAR],
  'Zerubbabel’s Plumb Line (LoC)': [DESCENDANT_STAR],
  // "SITE: If you play this Site and have no Evil Character, you may take one from deck."
  'Damascus (LoC)': [{ kind: 'search_deck', label: 'an Evil Character', match: [{ types: ['Evil Character'] }] }],
  'Damascus (Promo)': [{ kind: 'search_deck', label: 'an Evil Character', match: [{ types: ['Evil Character'] }] }],
  'The Watchman (Promo)': [{ kind: 'exchange_with_deck', label: 'a Major or Minor prophet', match: [{ traits: ['major prophet'], types: ['character'] }, { traits: ['minor prophet'], types: ['character'] }] }],
  'False Peace (PoC)': [{ kind: 'search_deck', label: 'an O.T. card (except a Dominant)', match: [{ testament: 'OT', types: NOT_DOMINANT }] }],
  // Wilderness characters are humans by definition.
  'Wandering Israelites': [{ kind: 'exchange_with_deck', label: 'an evil wilderness human', match: [{ alignments: ['evil'], traits: ['wilderness'], types: ['character'] }] }],
  'Lost Soul "Aimless" [Exodus 14:3]': [{ kind: 'search_deck', label: 'a wilderness human', match: [{ traits: ['wilderness'], types: ['character'] }, { names: EXTRA_GROUP_NAMES.wilderness }] }],
  'The Thief (GoC)': [{ kind: 'exchange_with_deck', label: 'a thief or generic demon', match: [{ traits: ['thief'], types: ['character'] }, { traits: ['demon', 'generic'], types: ['Evil Character'] }, { traits: ['generic'], types: ['Evil Character'], brigades: ['Orange'], singleBrigade: true }] }],
};

const CARD_NAMES = new Set(cards.map((c) => c.name));
for (const card of [...Object.keys(OVERRIDES), ...Object.keys(EXTRA)]) {
  if (!CARD_NAMES.has(card)) throw new Error(`override/extra names no card: ${card}`);
}

const final = new Map(); // card → entries
const add = (card, entry) => {
  const list = final.get(card) ?? [];
  if (!list.some((x) => x.kind === entry.kind && JSON.stringify(x.match) === JSON.stringify(entry.match))) list.push(entry);
  final.set(card, list);
};
for (const e of out) {
  if (e.card in OVERRIDES || e.flags.length) continue;
  add(e.card, { kind: e.kind, label: e.label, match: e.match, star: e.star });
}
for (const [card, list] of Object.entries(OVERRIDES)) {
  if (list) final.set(card, list.map((x) => ({ ...x, star: false })));
  else final.delete(card);
}
for (const [card, list] of Object.entries(EXTRA)) for (const x of list) add(card, { star: false, ...x });
for (const [card, list] of final) {
  for (const x of list) {
    const counts = x.match.map((m) => cards.filter((c) => matchOne(c, m)).length);
    if (counts.some((n) => n === 0)) throw new Error(`dead filter in final set: ${card} ${x.label} ${counts}`);
    // Every listed name must find a card, or a typo silently drops it from the list.
    for (const m of x.match) for (const n of m.names ?? []) {
      if (!cards.some((c) => nameIs(c, n))) throw new Error(`name finds no card: ${card} ${x.label} "${n}"`);
    }
  }
}

const q = (s) => (s.includes("'") ? JSON.stringify(s) : `'${s}'`);
const val = (v) => (Array.isArray(v) ? `[${v.map((x) => (typeof x === 'number' ? x : q(x))).join(', ')}]` : typeof v === 'boolean' ? String(v) : q(v));
const STAR_ZONES = "['hand', 'territory', 'land-of-bondage', 'land-of-redemption']";
const lines = [];
for (const card of [...final.keys()].sort((a, b) => a.localeCompare(b))) {
  const items = final.get(card).map((x) => {
    const match = x.match.map((m) => `{ ${Object.entries(m).map(([k, v]) => `${k}: ${val(v)}`).join(', ')} }`).join(', ');
    return `{ type: '${x.kind}', target: ${q(x.label)}, match: [${match}]${x.star ? `, sourceZones: ${STAR_ZONES}` : ''} }`;
  });
  lines.push(`  ${q(card)}: [${items.join(', ')}],`);
}
const header = (copyNote) => `// GENERATED by scripts/generate-deck-search-abilities.mjs — do not edit by hand.
// ${copyNote}
//
// Filtered deck search / exchange abilities read from card text: "search deck
// for X", "take/play/add X from deck" and "exchange this card with X from
// deck". Each X is parsed into DeckCardMatch filters and checked against the
// card pool (every filter matches at least one card). Targets that need
// judgement the card data can't make — human, meek, female, "matching",
// "with a … ability" — are skipped, as are clauses aimed at an opponent.
// Hand corrections live in the generator's OVERRIDES. Merged after the
// hand-written registry (cardAbilities.ts), so existing ability indexes hold.
import type { CardAbility } from './cardAbilities';

export const DECK_SEARCH_ABILITIES: Record<string, CardAbility[]> = {
`;
const body = lines.join('\n') + '\n};\n';
// How many pool cards each filter alternative matches, by this script's
// matcher. A test re-counts with the app's matchesDeckCard, so the two
// implementations can't drift apart unnoticed.
const counts = {};
for (const card of [...final.keys()].sort((a, b) => a.localeCompare(b))) {
  final.get(card).forEach((x, i) => x.match.forEach((m, j) => { counts[`${card} #${i}.${j}`] = cards.filter((c) => matchOne(c, m)).length; }));
}
writeFileSync(`${repoRoot}/lib/cards/__tests__/fixtures/deckSearchCounts.json`, JSON.stringify(counts, null, 1) + '\n');
writeFileSync(`${repoRoot}/lib/cards/deckSearchAbilities.ts`, header('Duplicated at spacetimedb/src/deckSearchAbilities.ts; the CARD_ABILITIES parity test keeps them equal.') + body);
writeFileSync(`${repoRoot}/spacetimedb/src/deckSearchAbilities.ts`, header('Copy of lib/cards/deckSearchAbilities.ts (the module cannot import lib/); the parity test keeps them equal.') + body);
console.log(`final cards: ${final.size}, entries: ${[...final.values()].reduce((n, l) => n + l.length, 0)}`);
const ok = out.filter((e) => !e.flags.length);
console.log(`clauses: ${out.length}; clean: ${ok.length} (search ${ok.filter((e) => e.kind === 'search_deck').length}, exchange ${ok.filter((e) => e.kind === 'exchange_with_deck').length}); flagged: ${out.length - ok.length}`);
const why = {};
for (const e of out) for (const f of e.flags) { const k = f.split(':')[0]; why[k] = (why[k] ?? 0) + 1; }
console.log(why);
