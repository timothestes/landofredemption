/**
 * Community shorthand that is NOT a card — set codes ("LoC") and game terms
 * ("EC", "CBI"). Sourced from redemptionccgfl.weebly.com/abbreviations-etc.html
 * and a second, annotated list the site owner compiled.
 *
 * A `[[mention]]` of one of these renders the shorthand the author wrote and
 * explains it on hover or tap, the way a card mention previews its card. That
 * keeps deck-tech voice intact for readers who know the jargon while giving a
 * newcomer a way in.
 *
 * Static on purpose: unlike card aliases ([[project-curated, editable in
 * /admin/catalog]]) this list is the rulebook's vocabulary, not a judgement
 * call about printings, and it changes about once a decade. A table and an
 * editor would be machinery around a constant.
 *
 * Terms are resolved LAST, after cards and card aliases, and a test asserts
 * this list collides with neither — a term that shadows a card could never
 * render, because the card always wins.
 */
import { cardNameKey } from "@/lib/cards/nameKey";

export interface GlossaryTerm {
  /** The shorthand, as people write it — what stands on the page. */
  term: string;
  expansion: string;
  kind: "set" | "term";
  /** A longer explanation, when the expansion alone does not tell a newcomer enough. */
  description?: string;
}

export const GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  { term: "AB", expansion: "Alternate Border Version", kind: "term" },
  { term: "AoE", expansion: "Area of Effect", kind: "term", description: "Used to describe a battlewinner that removes multiple (usually all) opposing characters from battle" },
  { term: "Ap", expansion: "Apostles", kind: "set" },
  { term: "AW", expansion: "Angel Wars", kind: "set" },
  { term: "BC", expansion: "Battle Challenge", kind: "term" },
  { term: "Bo3", expansion: "Best of Three", kind: "term" },
  { term: "BtN", expansion: "By the Numbers", kind: "term", description: "A term used to describe battles where Enhancements (and sometimes Characters) are being negated, so without modifiers (like CBN or CBP), the outcome of the battle will be determined by strength/toughness rather than character removal" },
  { term: "CBI", expansion: "Cannot Be Interrupted", kind: "term" },
  { term: "CBN", expansion: "Cannot Be Negated", kind: "term" },
  { term: "CBP", expansion: "Cannot Be Prevented", kind: "term" },
  { term: "CoW", expansion: "Cloud of Witnesses", kind: "set" },
  { term: "CoW (AB)", expansion: "Cloud of Witnesses (Alternate Border)", kind: "set" },
  { term: "CTB", expansion: "Choose the Blocker", kind: "term" },
  { term: "DAC", expansion: "Dual Alignment Character / Dual Alignment Card", kind: "term" },
  { term: "DAE", expansion: "Dual Alignment Enhancement", kind: "term" },
  { term: "DC", expansion: "Discard pile", kind: "term" },
  { term: "Di", expansion: "Disciples", kind: "set" },
  { term: "DIC", expansion: "Dual Icon Card", kind: "term" },
  { term: "Dom", expansion: "Dominant", kind: "term" },
  { term: "EC", expansion: "Evil Character", kind: "term" },
  { term: "EE", expansion: "Evil Enhancement", kind: "term" },
  { term: "ETB", expansion: "End the Battle", kind: "term" },
  { term: "FBN", expansion: "Fight by Numbers", kind: "term" },
  { term: "FBTN", expansion: "Fight By the Numbers", kind: "term", description: "A term used to describe battles where Enhancements (and sometimes Characters) are being negated, so without modifiers (like CBN or CBP), the outcome of the battle will be determined by strength/toughness rather than character removal" },
  { term: "FoB", expansion: "Field of Battle", kind: "term" },
  { term: "FoM", expansion: "Fall of Man", kind: "set" },
  { term: "FooF", expansion: "Faith of our Fathers", kind: "set" },
  { term: "GE", expansion: "Good Enhancement", kind: "term" },
  { term: "GG", expansion: "Good Game", kind: "term" },
  { term: "ID", expansion: "Israel's Deliverance", kind: "set" },
  { term: "II", expansion: "Israel's Inheritance", kind: "set" },
  { term: "IR", expansion: "Israel's Rebellion", kind: "set" },
  { term: "ITB", expansion: "Interrupt the Battle", kind: "term" },
  { term: "Ki", expansion: "Kings", kind: "set" },
  { term: "L", expansion: "Limited", kind: "set" },
  { term: "LFG", expansion: "Looking for a Game", kind: "term" },
  { term: "Lim", expansion: "Limited", kind: "set" },
  { term: "LoB", expansion: "Land of Bondage", kind: "term", description: "Name of the location where Lost Souls are kept in your territory" },
  { term: "LoC", expansion: "Lineage of Christ", kind: "set" },
  { term: "LoR", expansion: "Land of Redemption", kind: "term", description: "Where your Redeemed Souls go during a game; also the Redemption content and resources hub website" },
  { term: "LR", expansion: "Legacy Rare", kind: "set" },
  { term: "LS", expansion: "Lost Soul", kind: "term" },
  { term: "MI", expansion: "My Initiative", kind: "term" },
  { term: "MT", expansion: "My Turn", kind: "term" },
  { term: "Nats", expansion: "National Tournament", kind: "term" },
  { term: "NT", expansion: "New Testament", kind: "term" },
  { term: "OP", expansion: "Overpowered", kind: "term" },
  { term: "ORCID", expansion: "Official Redemption Card Information Database", kind: "term" },
  { term: "ORDIR", expansion: "Official Redemption Dictionary of Identifiers and References", kind: "term" },
  { term: "OT", expansion: "Old Testament", kind: "term" },
  { term: "Pi", expansion: "Priests", kind: "set" },
  { term: "PoC", expansion: "Prophecies of Christ", kind: "set" },
  { term: "Pr", expansion: "Prophets", kind: "set" },
  { term: "Pri", expansion: "Priests", kind: "set" },
  { term: "RA", expansion: "Rescue Attempt", kind: "term" },
  { term: "RDT", expansion: "RedDragonThorn", kind: "term", description: "Screen name for long-time Redemption player and multi-National champion, John Earley" },
  { term: "REG", expansion: "Redemption Exegesis Guide", kind: "term" },
  { term: "REL", expansion: "Redemption Errata List", kind: "term" },
  { term: "RoA", expansion: "Rock of Ages", kind: "set" },
  { term: "RoJ", expansion: "Revelation of John", kind: "set" },
  { term: "RoJ (AB)", expansion: "Revelation of John (Alternate Border)", kind: "set" },
  { term: "RoP", expansion: "Regardless of Protect", kind: "term" },
  { term: "T1-2P", expansion: "Type 1 2-Player", kind: "term" },
  { term: "T1-MP", expansion: "Type 1 Multi-Player", kind: "term" },
  { term: "T2-2P", expansion: "Type 2 2-Player", kind: "term" },
  { term: "T2-MP", expansion: "Type 2 Multi-Player", kind: "term" },
  { term: "T2C", expansion: "Times to Come", kind: "set" },
  { term: "TC", expansion: "Territory Class", kind: "term" },
  { term: "TCE", expansion: "Territory Class", kind: "term" },
  { term: "TEC", expansion: "The Early Church", kind: "set" },
  { term: "TeXP", expansion: "Thesaurus ex Preteritus", kind: "set" },
  { term: "TJC", expansion: "Thomas Jay Chambers Tournament", kind: "term" },
  { term: "TPC", expansion: "The Persecuted Church", kind: "set" },
  { term: "TtC", expansion: "Times to Come", kind: "set" },
  { term: "TxP", expansion: "Thesaurus ex Preteritus", kind: "set" },
  { term: "UL", expansion: "Unlimited", kind: "set" },
  { term: "Unlim", expansion: "Unlimited", kind: "set" },
  { term: "Wa", expansion: "Warriors", kind: "set" },
  { term: "Wo", expansion: "Women", kind: "set" },
  { term: "YI", expansion: "Your Initiative", kind: "term" },
];

const INDEX = new Map(GLOSSARY_TERMS.map((t) => [cardNameKey(t.term), t]));

/** The glossary entry for a mention, or undefined when it is not shorthand. */
export function findGlossaryTerm(text: string): GlossaryTerm | undefined {
  return text ? INDEX.get(cardNameKey(text)) : undefined;
}

/** Mention key -> entry, for the names a document actually mentions. */
export function resolveGlossaryTerms(names: readonly string[]): Record<string, GlossaryTerm> {
  const out: Record<string, GlossaryTerm> = {};
  for (const name of names) {
    const hit = findGlossaryTerm(name);
    if (hit) out[cardNameKey(name)] = hit;
  }
  return out;
}
