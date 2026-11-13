// Lazy-loaded with the Lost Soul sheet: it pulls the whole card catalog.
import { CARDS } from '@/lib/cards/lookup';

export interface LostSoulOption {
  key: string;
  name: string;
  /** The quoted nickname, or the old-style one in parentheses; empty for a soul with neither. */
  nickname: string;
  reference: string;
  set: string;
  imgFile: string;
  rotation: boolean;
  /** The row's first line: the nickname, else the verse. */
  title: string;
  /** The row's second line. Title and detail together are different for every option. */
  detail: string;
  /** Lower-cased text the search reads: name, verse and set, then the ability on its own. */
  text: string;
  ability: string;
  /** A first print, alternate border, promo or fundraiser version: listed after the regular printing. */
  special: boolean;
}

/** `Lost Soul "Accusers" [Ezra 4:6]` -> `Accusers`; empty for a plain name. */
export const nicknameOf = (name: string): string => /"([^"]+)"/.exec(name)?.[1] ?? '';

const groups = (name: string): string[] => [...name.matchAll(/[([]([^)\]]+)[)\]]/g)].map(m => m[1].trim());
const isVerse = (s: string) => /\d+:\d+/.test(s);

/**
 * `Lost Soul II Chronicles 28:13 (Hopper)` -> `Hopper`: the first parenthesised group that is a nickname, not a
 * verse, a set code (`(GoC)`, `(Wa)`) or a printing tag (`(1st Print - L)`, `(Promo)`).
 */
const oldNickname = (name: string, set: string): string =>
  [...name.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim())
    .find(g => !isVerse(g) && g.length > 2 && g !== set && !/print|promo/i.test(g)) ?? '';

/** The printing tag that ends a name, e.g. `2025 - Worker` or `1st Print - L`; empty when the name ends in its verse. */
const printingTag = (name: string): string => {
  const last = groups(name).at(-1) ?? '';
  return isVerse(last) && !/ - /.test(last) ? '' : last;
};

let all: LostSoulOption[] | null = null;
function everyOption(): LostSoulOption[] {
  if (all) return all;
  // A Lost Soul Token is made during a game: it is never one of the deck's Lost Souls.
  const list = CARDS.filter(c => c.type === 'Lost Soul').map(c => {
    const nickname = nicknameOf(c.name) || oldNickname(c.name, c.set);
    // The verse printed in the name wins: a few reference fields name the wrong verse.
    const verse = groups(c.name).find(isVerse)?.replace(/\s*-\s+.*$/, '') || c.reference;
    const setName = c.officialSet || c.set;
    return {
      key: `${c.name}|${c.set}|${c.imgFile}`,
      name: c.name,
      nickname,
      reference: verse,
      set: c.set,
      imgFile: c.imgFile,
      rotation: c.legality === 'Rotation',
      title: nickname || verse || c.name,
      detail: [nickname ? verse : '', setName].filter(Boolean).join(' · '),
      // Without the "Lost Soul" every name starts with: "so" or "ul" would match the whole list.
      text: ` ${[c.name.replace(/^Lost Souls?\s*/, ''), verse, c.reference, c.set, c.officialSet].join(' ').toLowerCase()}`,
      ability: c.specialAbility.toLowerCase(),
      special: /1st print|\bAB\b|alternate|promo|fundraiser|\b\d{4}\b/i.test(`${c.name} ${c.officialSet}`),
    };
  });
  // Rows that would read the same get what tells them apart: the printing tag, then the set code.
  const same = (o: LostSoulOption) => `${o.title}|${o.detail}`;
  for (const extra of [(o: LostSoulOption) => printingTag(o.name), (o: LostSoulOption) => o.set]) {
    const seen = new Map<string, number>();
    for (const o of list) seen.set(same(o), (seen.get(same(o)) ?? 0) + 1);
    for (const o of list) {
      const add = extra(o);
      if ((seen.get(same(o)) ?? 0) > 1 && add && !o.detail.includes(add)) o.detail = `${o.detail} · ${add}`;
    }
  }
  // Named souls A-Z, then the ones known only by verse. Of one soul's versions the Rotation ones lead, and the
  // regular printing leads those: it is the one listed when each soul is shown once.
  return (all = list.sort((a, b) =>
    Number(!a.nickname) - Number(!b.nickname) ||
    a.title.localeCompare(b.title, undefined, { numeric: true }) ||
    Number(b.rotation) - Number(a.rotation) ||
    Number(a.special) - Number(b.special) ||
    a.name.localeCompare(b.name)));
}

/** Every Lost Soul printing, Rotation-legal only unless `showAll`. Tokens are never listed. */
export const lostSoulOptions = (showAll: boolean): LostSoulOption[] =>
  showAll ? everyOption() : everyOption().filter(o => o.rotation);

const ROMAN: Record<string, string> = { '1': 'i', '2': 'ii', '3': 'iii' };

/**
 * The words a query asks for. "lost" and "soul" say nothing here; "1 samuel" is written "I Samuel" (the book,
 * matched from its start, so "1 john" is not III John); and the little words of a phrase read off the card
 * ("may not be") are dropped when a longer one is there to search by.
 */
function queryWords(query: string): string[] {
  const raw = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (ROMAN[raw[i]] && raw[i + 1] && /^[a-z]/.test(raw[i + 1])) out.push(` ${ROMAN[raw[i]]} ${raw[++i]}`);
    else out.push(raw[i]);
  }
  const named = out.filter(w => !['lost', 'soul', 'souls'].includes(w));
  const words = named.length > 0 ? named : out;
  const long = words.filter(w => w.length >= 3 || /\d/.test(w));
  return long.length > 0 ? long : words;
}

const startsWord = (text: string, w: string) => text.startsWith(w) || text.includes(` ${w}`);

/**
 * Options that hold every word of the query, best first: a word that starts the nickname, then the name,
 * verse or set, then the ability text (words of three letters or more, so "nt" does not match half the list).
 */
export function matchLostSouls(query: string, options: LostSoulOption[]): LostSoulOption[] {
  if (!query.trim()) return options;
  const words = queryWords(query);
  const rank = (o: LostSoulOption): number => {
    let worst = 0;
    for (const w of words) {
      const tier = startsWord(o.title.toLowerCase(), w) ? 0
        : o.text.includes(w) ? 1
        : w.length >= 3 && o.ability.includes(w) ? 2
        : -1;
      if (tier < 0) return -1;
      worst = Math.max(worst, tier);
    }
    return worst;
  };
  return options
    .map(o => ({ o, r: rank(o) }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r) // stable: the list's own order within a tier
    .map(x => x.o);
}
