import type { DeckCard } from "../types/deck";
import { searchableIdentifier, type Card } from "../utils";

// Text filter over the cards already in a deck (the box under the zone tabs
// in the builder). Same conventions as the catalog search so the two boxes
// feel alike: bare words are ANDed substrings, a "quoted phrase" (straight or
// curly quotes) matches on word boundaries, and curly apostrophes fold to
// straight ones so "pharaoh's" finds "Pharaoh’s".

const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’‛′`]/g, "'");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Term = { kind: "word"; text: string } | { kind: "phrase"; re: RegExp };

const QUOTE = `["“”]`;
const TOKEN = new RegExp(`${QUOTE}([^"“”]*)${QUOTE}|(\\S+)`, "g");
const EDGE_QUOTES = new RegExp(`^${QUOTE}+|${QUOTE}+$`, "g");

function parseTerms(query: string): Term[] {
  const terms: Term[] = [];
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(query)) !== null) {
    if (m[1] !== undefined) {
      const phrase = norm(m[1].trim());
      if (phrase) terms.push({ kind: "phrase", re: new RegExp(`\\b${escapeRegExp(phrase)}\\b`) });
    } else {
      // A lone quote while the user is still typing the closing one is just
      // noise — drop it so the box keeps narrowing instead of going empty.
      const word = norm(m[2]).replace(EDGE_QUOTES, "");
      if (word) terms.push({ kind: "word", text: word });
    }
  }
  return terms;
}

function haystack(c: Card): string {
  return norm(
    [
      c.name,
      c.type,
      c.brigade,
      c.alignment,
      c.class,
      searchableIdentifier(c),
      c.specialAbility,
      c.reference,
      c.set,
      c.officialSet,
    ].join(" | "),
  );
}

/** Narrow `cards` to those matching `query`. A blank query returns `cards` itself. */
export function filterDeckCards(cards: DeckCard[], query: string): DeckCard[] {
  const terms = parseTerms(query);
  if (terms.length === 0) return cards;
  return cards.filter(({ card }) => {
    const hay = haystack(card);
    return terms.every((t) => (t.kind === "word" ? hay.includes(t.text) : t.re.test(hay)));
  });
}
