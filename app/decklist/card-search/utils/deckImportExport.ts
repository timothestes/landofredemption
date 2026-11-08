import { Card } from "../utils";
import { Deck, DeckCard, DeckZone, ImportResult } from "../types/deck";
import { compareCardsByType } from "@/lib/cards/defaultSort";

/**
 * Normalize card name for comparison by replacing various apostrophe types with standard apostrophe
 */
function normalizeCardName(name: string): string {
  // Replace curly/smart apostrophes and other variants with standard apostrophe
  return name.replace(/[\u2018\u2019\u201B\u2032]/g, "'");
}

/**
 * Mapping of cards that generate tokens to their corresponding token cards
 * Key: Normalized card name
 * Value: Token card name
 */
const CARD_TO_TOKEN_MAP: Record<string, string> = {
  "The Heavenly Host (GoC)": "Heavenly Host Token",
  "Two Possessed (GoC)": "Violent Possessor Token",
  "The Accumulator (GoC)": "Wicked Spirit Token",
  "Lost Soul \"Lost Souls\" [Proverbs 2:16-17]": "Lost Soul Token \"Lost Souls\" [Proverbs 2:16-17]",
  "Lost Soul \"Harvest\" [John 4:35] [2023 - 2nd Place]": "Lost Soul Token \"Harvest\" [John 4:35]",
  "Lost Soul \"Harvest\" [John 4:35]": "Lost Soul Token \"Harvest\" [John 4:35]",
  "The Church of Christ (GoC)": "Follower Token",
  "Stricken": "Stricken Reminder Token",
  "Majestic Heavens (Promo)": "Lost Soul Token NT (Majestic Heavens)|Lost Soul Token OT (Majestic Heavens)",
  "The Proselytizers (GoC)": "Proselyte Token",
};

/**
 * Get the list of required tokens for a deck
 * Returns an array of unique token names needed
 */
function getRequiredTokens(deck: Deck): string[] {
  const tokenSet = new Set<string>();

  deck.cards.forEach((dc) => {
    // Maybeboard cards never contribute auto-generated tokens — they're a scratchpad.
    if (dc.zone === 'maybeboard') return;
    const cardName = normalizeCardName(dc.card.name);

    Object.entries(CARD_TO_TOKEN_MAP).forEach(([sourceCard, tokens]) => {
      const normalizedSourceCard = normalizeCardName(sourceCard);
      const matches = cardName === normalizedSourceCard ||
                     cardName.toLowerCase() === normalizedSourceCard.toLowerCase() ||
                     (normalizedSourceCard.includes("(") &&
                      cardName.toLowerCase().includes(normalizedSourceCard.toLowerCase()));

      if (matches) {
        tokens.split("|").forEach(token => tokenSet.add(token));
      }
    });
  });

  return Array.from(tokenSet).sort();
}

/**
 * Flattened, normalized set of auto-token names. Used on import to identify
 * lines that should be discarded (auto-tokens are derived on export from
 * main+reserve cards — re-importing them would pollute the maybeboard).
 */
const AUTO_TOKEN_NAMES_NORMALIZED: Set<string> = (() => {
  const set = new Set<string>();
  Object.values(CARD_TO_TOKEN_MAP).forEach((value) => {
    value.split("|").forEach((token) => {
      set.add(normalizeCardName(token).toLowerCase());
    });
  });
  return set;
})();

/**
 * Parse a deck text in standard tab-separated format
 * Format: Quantity\tName\tSet\tImageFile\tCollectorInfo
 * Supports "Reserve:" section for reserve cards
 * Ignores "Tokens:" section (tokens are not imported)
 * 
 * Example:
 * 4	Abraham	PoC	Abraham (PoC).jpg	"Genesis 11:26; [PoC (R)]"
 * 2	Moses	Patriarchs	Moses (Pa).jpg	"Exodus 2:10; [Pa (UR)]"
 * Reserve:
 * 1	Angel of the Lord	Patriarchs	Angel of the Lord (Pa).jpg	"Genesis 16:7; [Pa (R)]"
 * Tokens:
 * 1	Aaron's Staff (CoW)
 */
export function parseDeckText(
  text: string,
  allCards: Card[]
): ImportResult {
  const lines = text.trim().split("\n");
  const deckCards: DeckCard[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let inReserve = false;
  let isTokens = false; // Track if we're in the Tokens section
  // Within the Tokens section, the # maybeboard marker flips routing so lines
  // route to the maybeboard zone instead of being treated as auto-tokens.
  // Before any marker (or after # auto-generated), Tokens-section lines are
  // discarded — they'll be regenerated on next export.
  let inMaybeboard = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) continue;

    // Section markers inside the Tokens section (#-prefixed comments).
    // Two layers: explicit comment markers (primary signal) + auto-token
    // name set (fallback for unmarked legacy lines).
    if (isTokens && line.startsWith("#")) {
      const marker = line.slice(1).trim().toLowerCase();
      if (marker === "maybeboard") {
        inMaybeboard = true;
      } else if (marker === "auto-generated") {
        inMaybeboard = false;
      }
      continue;
    }

    // Check for Tokens section marker
    if (line.toLowerCase() === "tokens:") {
      isTokens = true;
      inMaybeboard = false;
      continue;
    }

    // Check for Reserve section marker
    if (!isTokens && line.toLowerCase() === "reserve:") {
      inReserve = true;
      continue;
    }

    // Parse tab-separated line
    const parts = line.split("\t");

    if (parts.length < 2) {
      errors.push(`Line ${i + 1}: Invalid format (expected tab-separated values): "${line}"`);
      continue;
    }

    // Extract quantity and card name (minimum required fields)
    const quantityStr = parts[0].trim();
    const cardName = parts[1].trim();

    // Parse quantity
    const quantity = parseInt(quantityStr, 10);
    if (isNaN(quantity) || quantity < 1) {
      errors.push(`Line ${i + 1}: Invalid quantity "${quantityStr}" for "${cardName}" (must be at least 1)`);
      continue;
    }

    // Optional: Extract set name if provided (3rd column)
    const setName = parts.length >= 3 ? parts[2].trim() : undefined;

    // Normalize card name for comparison
    const normalizedInputName = normalizeCardName(cardName);

    // Tokens-section routing:
    // - Under `# maybeboard`: route to maybeboard zone.
    // - Otherwise (under `# auto-generated`, or under no marker for legacy
    //   exports): discard if it matches a known auto-token name; otherwise
    //   fall through to maybeboard with a warning so manually-added cards
    //   in legacy exports aren't silently lost.
    if (isTokens) {
      if (inMaybeboard) {
        // fall through to lookup + add as maybeboard
      } else if (AUTO_TOKEN_NAMES_NORMALIZED.has(normalizedInputName.toLowerCase())) {
        continue;
      } else {
        warnings.push(
          `Line ${i + 1}: "${cardName}" found in Tokens section without a # maybeboard marker — routing to maybeboard`
        );
      }
    }

    // Find matching card in allCards
    let matchingCard: Card | undefined;

    if (setName) {
      // Try to find exact match with set name (using normalized names)
      matchingCard = allCards.find(
        (c) => normalizeCardName(c.name) === normalizedInputName && c.set === setName
      );

      if (!matchingCard) {
        // Try matching with officialSet as fallback
        matchingCard = allCards.find(
          (c) => normalizeCardName(c.name) === normalizedInputName && c.officialSet === setName
        );
      }
    }

    // If no set specified or no match found, try finding by name only
    if (!matchingCard) {
      const matchingCards = allCards.filter((c) => normalizeCardName(c.name) === normalizedInputName);

      if (matchingCards.length === 0) {
        errors.push(`Line ${i + 1}: Card not found: "${cardName}"`);
        continue;
      } else if (matchingCards.length > 1) {
        // Multiple printings found - use first one and warn. The line is kept, so
        // this is not an error: `errors` is exactly the lines that were dropped.
        matchingCard = matchingCards[0];
        warnings.push(
          `Line ${i + 1}: Multiple versions of "${cardName}" found, using ${matchingCard.set}`
        );
      } else {
        matchingCard = matchingCards[0];
      }
    }

    // Route to the appropriate zone.
    const zone: DeckZone = isTokens ? 'maybeboard' : (inReserve ? 'reserve' : 'main');

    // Add to deck
    deckCards.push({
      card: matchingCard,
      quantity,
      zone,
    });
  }
  
  // Create a deck object if we have cards
  const deck: Deck | null = deckCards.length > 0
    ? {
        name: "Imported Deck",
        cards: deckCards,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    : null;
  
  return {
    deck,
    warnings,
    errors,
  };
}

/**
 * Generate deck text in standard tab-separated format
 * Format: Quantity\tName
 * Reserve cards are separated with "Reserve:" marker
 * Tokens are automatically added in a "Tokens:" section based on cards in the deck
 * Card names are normalized to use standard apostrophes
 */
export function generateDeckText(deck: Deck): string {
  const mainCards = deck.cards.filter((dc) => dc.zone === 'main');
  const reserveCards = deck.cards.filter((dc) => dc.zone === 'reserve');
  const maybeboardCards = deck.cards.filter((dc) => dc.zone === 'maybeboard');

  const lines: string[] = [];

  // Classic deck order (type → alignment → brigade → name)
  const sortCards = (a: DeckCard, b: DeckCard) =>
    compareCardsByType(a.card, b.card);

  // Add main deck cards
  mainCards.sort(sortCards).forEach((dc) => {
    const { card, quantity } = dc;
    // Format: Quantity\tName (with normalized apostrophes)
    const normalizedName = normalizeCardName(card.name);
    lines.push(`${quantity}\t${normalizedName}`);
  });

  // Add reserve section if there are reserve cards
  if (reserveCards.length > 0) {
    lines.push(""); // Empty line before Reserve
    lines.push("Reserve:");

    reserveCards.sort(sortCards).forEach((dc) => {
      const { card, quantity } = dc;
      const normalizedName = normalizeCardName(card.name);
      lines.push(`${quantity}\t${normalizedName}`);
    });
  }

  // Tokens section: auto-generated tokens first (under `# auto-generated`),
  // then maybeboard cards (under `# maybeboard`). Both can coexist; the
  // markers let parseDeckText route each set back to the correct zone.
  const requiredTokens = getRequiredTokens(deck);
  if (requiredTokens.length > 0 || maybeboardCards.length > 0) {
    lines.push(""); // Empty line before Tokens
    lines.push("Tokens:");

    if (requiredTokens.length > 0) {
      lines.push("# auto-generated");
      requiredTokens.forEach((tokenName) => {
        lines.push(`7\t${tokenName}`);
      });
    }

    if (maybeboardCards.length > 0) {
      lines.push("# maybeboard");
      maybeboardCards.sort(sortCards).forEach((dc) => {
        const { card, quantity } = dc;
        const normalizedName = normalizeCardName(card.name);
        lines.push(`${quantity}\t${normalizedName}`);
      });
    }
  }

  return lines.join("\n");
}

/**
 * Helper function to download deck as a text file
 */
export function downloadDeckAsFile(deck: Deck, filename?: string): void {
  const deckText = generateDeckText(deck);
  const blob = new Blob([deckText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename || `${deck.name.replace(/\s+/g, "_")}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function generateDeckTextBySet(deck: Deck): string {
  const mainCards = deck.cards.filter((dc) => dc.zone === 'main');
  const reserveCards = deck.cards.filter((dc) => dc.zone === 'reserve');
  const maybeboardCards = deck.cards.filter((dc) => dc.zone === 'maybeboard');

  const sortBySetThenName = (a: DeckCard, b: DeckCard) => {
    const setA = a.card.officialSet || "";
    const setB = b.card.officialSet || "";
    return setA.localeCompare(setB) || a.card.name.localeCompare(b.card.name);
  };

  const formatLine = (dc: DeckCard) => {
    const normalizedName = normalizeCardName(dc.card.name);
    const set = dc.card.officialSet || "Unknown";
    return `${dc.quantity}\t${normalizedName} (${set})`;
  };

  const lines: string[] = [];
  mainCards.sort(sortBySetThenName).forEach((dc) => lines.push(formatLine(dc)));

  if (reserveCards.length > 0) {
    lines.push("");
    lines.push("Reserve:");
    reserveCards.sort(sortBySetThenName).forEach((dc) => lines.push(formatLine(dc)));
  }

  const requiredTokens = getRequiredTokens(deck);
  if (requiredTokens.length > 0 || maybeboardCards.length > 0) {
    lines.push("");
    lines.push("Tokens:");
    if (requiredTokens.length > 0) {
      lines.push("# auto-generated");
      requiredTokens.forEach((tokenName) => {
        lines.push(`7\t${tokenName}`);
      });
    }
    if (maybeboardCards.length > 0) {
      lines.push("# maybeboard");
      maybeboardCards.sort(sortBySetThenName).forEach((dc) => lines.push(formatLine(dc)));
    }
  }

  return lines.join("\n");
}

export function downloadDeckAsFileBySet(deck: Deck, filename?: string): void {
  const deckText = generateDeckTextBySet(deck);
  const blob = new Blob([deckText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename || `${deck.name.replace(/\s+/g, "_")}_by_set.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Helper function to copy deck text to clipboard
 */
export async function copyDeckToClipboard(deck: Deck): Promise<void> {
  const deckText = generateDeckText(deck);
  await navigator.clipboard.writeText(deckText);
}
