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
const JUDGEMENT = /\b(human|humans|male|female|royal|meek|generic|different|single-brigade|multi-brigade|single color|matching|random|toughness|strength|except|ability|depicting|dual icon|healing|X|reserved|from hand|of your choice|teal|child of|grim reaper|set-aside|reference|both of)\b|^(?:it|one|them|this card)$/i;
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
const identText = (c) => c.identifier.replace(/X\s*=[^,\]]*/g, '');
// A card "is" name N when its name (set suffix dropped), or either half of a
// dual name, is N or is "N, <title>" — so "David" finds "David, the Shepherd".
function nameIs(cardName, n) {
  const want = n.toLowerCase();
  return base(cardName).split(' / ').some((h) => h === want || h.startsWith(`${want},`));
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
  if (m.cardClass && !c.class.split(/[,/]/).map((s) => s.trim()).includes(m.cardClass)) return false;
  if (m.traits && !m.traits.every((t) => wordRe(t).test(identText(c)) || wordRe(t).test(c.name))) return false;
  if (m.unique && /\bgeneric\b/i.test(c.identifier)) return false;
  if (m.names && !m.names.some((n) => nameIs(c.name, n))) return false;
  if (m.nameIncludes && !m.nameIncludes.some((n) => c.name.toLowerCase().includes(n.toLowerCase()))) return false;
  return true;
}

// ---------- target parser ----------
const LEAD = /^(?:a|an|any|one|two|three|up to (?:\d+|two|three)|\d+)\s+/i;
function parseAlt(alt, titleWords) {
  // Whole alternative is a card name ("Whirlwind", "A Child is Born", "Phinehas, the Useless").
  const named = !alt.includes('TITLEPH') && lookupName(alt);
  if (named) return { names: [named] };
  let s = ` ${alt.replace(LEAD, '').toLowerCase().replace(/\b(?:your|brigade|class|that)\b/g, ' ').replace(/\s+/g, ' ').trim()} `;
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
  if (m.cardClass === 'Warrior' && !m.types) m.types = ['character'];
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
  // Head noun shared backwards: "a Genesis or Exodus Fortress", "a good or
  // neutral Joshua card" — an alternative with no head borrows the next one's.
  for (let i = parsed.length - 2; i >= 0; i--) {
    const p = parsed[i], n = parsed[i + 1];
    if (!p.types && !p.traits && !p.cardClass && !p.names && !p.nameIncludes && !/\bcards?\b/i.test(alts[i])) {
      for (const k of ['types', 'traits', 'traitIsHead', 'cardClass', 'books', 'chapters', 'testament', 'alignments', 'brigades']) if (p[k] === undefined && n[k] !== undefined) p[k] = n[k];
    }
  }
  // Modifiers shared forwards: "a Roman Site or Fortress", "a gold Luke or
  // John Hero" — a later alternative printed WITHOUT its own article takes
  // the earlier one's modifiers it lacks. A head-noun trait ("a good king or
  // weapon") is not a modifier and stays put.
  for (let i = 1; i < parsed.length; i++) {
    const p = parsed[i], prev = parsed[i - 1];
    if (p.names || prev.names || /^(?:a|an|the)\s/i.test(alts[i].trim())) continue;
    for (const k of ['alignments', 'testament', 'brigades', 'books', 'chapters']) if (p[k] === undefined && prev[k] !== undefined) p[k] = prev[k];
    if (!p.traits && prev.traits && !prev.traitIsHead) p.traits = prev.traits;
  }
  for (const p of parsed) delete p.traitIsHead;
  return { clean: clean.replace(' TITLEPH', titleWords ? ` with "${titleWords.join('" or "')}" in the title` : ''), parsed, alts };
}

// ---------- clause scan ----------
const FROM_DECK = String.raw`from (?:your |the |own )?(?:deck|draw pile)`;
const CLAUSES = [
  { kind: 'search_deck', re: new RegExp(String.raw`\bsearch (?:your |the |own )?(?:deck|draw pile)(?: or (?:your )?Reserve)? for ([^.:;]+)`, 'gi'), target: 1 },
  { kind: 'search_deck', re: new RegExp(String.raw`\b(?:take|play|add)\s+((?:(?!\bfrom\b)[^.:;])+?)\s+${FROM_DECK}`, 'gi'), target: 1 },
  { kind: 'exchange_with_deck', re: new RegExp(String.raw`\bexchange this (?:card|Hero) with ((?:(?!\bfrom\b)[^.:;])+?)\s+${FROM_DECK}`, 'gi'), target: 1 },
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
  const match = parsed.map(({ leftover, ...m }) => m);
  if (match.some((m) => !Object.keys(m).length)) flags.push('empty alternative');
  const counts = match.map((m) => cards.filter((c) => matchOne(c, m)).length);
  if (counts.some((n) => n === 0)) flags.push(`dead alternative: ${counts.join('/')}`);
  const label = clean.replace(/\bOT\b/g, 'O.T.').replace(/\bNT\b/g, 'N.T.');
  out.push({ ...e, label, match, counts, flags, registered: registered.get(e.card) ?? null });
}
if (outPath) writeFileSync(outPath, JSON.stringify(out, null, 2));

// ---------- hand overrides (card name → replacement entries, or null = skip) ----------
const GOSPEL = ['Matthew', 'Mark', 'Luke', 'John'];
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
};

const final = new Map(); // card → entries
for (const e of out) {
  if (e.card in OVERRIDES || e.flags.length) continue;
  const list = final.get(e.card) ?? [];
  const entry = { kind: e.kind, label: e.label, match: e.match, star: e.star };
  if (!list.some((x) => x.kind === entry.kind && JSON.stringify(x.match) === JSON.stringify(entry.match))) list.push(entry);
  final.set(e.card, list);
}
for (const [card, list] of Object.entries(OVERRIDES)) {
  if (list) final.set(card, list.map((x) => ({ ...x, star: false })));
  else final.delete(card);
}
for (const [card, list] of final) {
  for (const x of list) {
    const counts = x.match.map((m) => cards.filter((c) => matchOne(c, m)).length);
    if (counts.some((n) => n === 0)) throw new Error(`dead filter in final set: ${card} ${x.label} ${counts}`);
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
writeFileSync(`${repoRoot}/lib/cards/deckSearchAbilities.ts`, header('Duplicated at spacetimedb/src/deckSearchAbilities.ts; the CARD_ABILITIES parity test keeps them equal.') + body);
writeFileSync(`${repoRoot}/spacetimedb/src/deckSearchAbilities.ts`, header('Copy of lib/cards/deckSearchAbilities.ts (the module cannot import lib/); the parity test keeps them equal.') + body);
console.log(`final cards: ${final.size}, entries: ${[...final.values()].reduce((n, l) => n + l.length, 0)}`);
const ok = out.filter((e) => !e.flags.length);
console.log(`clauses: ${out.length}; clean: ${ok.length} (search ${ok.filter((e) => e.kind === 'search_deck').length}, exchange ${ok.filter((e) => e.kind === 'exchange_with_deck').length}); flagged: ${out.length - ok.length}`);
const why = {};
for (const e of out) for (const f of e.flags) { const k = f.split(':')[0]; why[k] = (why[k] ?? 0) + 1; }
console.log(why);
