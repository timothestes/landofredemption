import { GOOD_BRIGADES, EVIL_BRIGADES } from "./constants";

// Card data structure
export interface Card {
  dataLine: string;
  name: string;
  set: string;
  imgFile: string;
  officialSet: string;
  type: string;
  brigade: string;
  strength: string;
  toughness: string;
  class: string;
  identifier: string;
  specialAbility: string;
  rarity: string;
  reference: string;
  alignment: string;
  legality: string;
  /** Illustrator credit; absent on Forge cards and on placeholder rows. */
  artist?: string;
  testament: string;
  isGospel: boolean;
}

// Re-export from shared utils so existing imports from this module still work
export { sanitizeImgFile } from "../../shared/utils/cardImageUrl";

// Rarity categorization helper
export const categorizeRarity = (rarity: string, officialSet: string): string => {
  const r = rarity.toLowerCase();
  const os = officialSet.toLowerCase();
  if (r === 'common' || r === 'deck' || r === 'starter' || r === 'fixed') return 'Common';
  if (r === 'promo' || r === 'seasonal' || r === 'national' || os === 'promo') return 'Promo';
  if (r === 'uncommon' || r === 'rare' || r === 'legacy rare') return 'Rare';
  if (r === 'ultra rare' || r === 'ultra-rare') return 'Ultra Rare';
  return 'Common'; // default fallback
};

// Nativity filter helper
export const isNativityReference = (ref: string): boolean => {
  const r = ref.trim();
  try {
    if (r.startsWith("Matthew 1:")) {
      const versePart = r.split("Matthew 1:")[1];
      if (versePart.includes("-")) {
        const [start, end] = versePart.split("-").map(v => parseInt(v, 10));
        return start >= 18 && end <= 25;
      }
      const verse = parseInt(versePart, 10);
      return verse >= 18 && verse <= 25;
    }
    if (r.startsWith("Luke 1:") || r.startsWith("Luke 2:")) {
      const chapter = parseInt(r.split(" ")[1].split(":")[0], 10);
      return chapter === 1 || chapter === 2;
    }
    // Include Matthew chapter 2 verses
    if (r.startsWith("Matthew 2:")) {
      return true;
    }
    // Handle full chapter references
    return r === "Matthew 2" || r === "Luke 1" || r === "Luke 2";
  } catch {
    return false;
  }
};

// Flood survivors are Antediluvians in Redemption, but only newer printings
// (LoC, RR2) carry the explicit "Antediluvian" identifier. Append it for older
// Flood survivor characters so an "Antediluvian" search surfaces them too.
// Restricted to characters so enhancements that merely reference flood
// survivors (A New Beginning, The Rainbow) are not tagged.
export const searchableIdentifier = (c: Card): string => {
  const isCharacter = c.type.includes("Hero") || c.type.includes("Character");
  if (
    isCharacter &&
    /flood survivor/i.test(c.identifier) &&
    !/antediluvian/i.test(c.identifier)
  ) {
    return `${c.identifier}, Antediluvian`;
  }
  return c.identifier;
};

// Define how each icon filter should be applied
export const iconPredicates: Record<string, (c: Card) => boolean> = {
  Artifact: (c) => c.type === "Artifact",
  Covenant: (c) => c.type === "Covenant",
  Curse: (c) => c.type === "Curse",
  "Good Dominant": (c) => c.type.includes("Dominant") && (c.alignment.includes("Good") || c.alignment.includes("Neutral")),
  "Evil Dominant": (c) => c.type.includes("Dominant") && (c.alignment.includes("Evil") || c.alignment.includes("Neutral")),
  // A City is a type of Fortress in Redemption, so surface Cities under the Fortress filters too.
  "Good Fortress": (c) => (c.type.includes("Fortress") || c.type.includes("City")) && c.alignment.includes("Good"),
  "Evil Fortress": (c) => (c.type.includes("Fortress") || c.type.includes("City")) && c.alignment.includes("Evil"),
  // other icons use existing category filters
  // Good Enhancements also surface Covenants (a good-side enhancement-like type)
  GE: (c) => c.type.includes("GE") || c.type === "Covenant",
  "Evil Character": (c) => c.type.includes("Evil Character"),
  Hero: (c) => c.type.includes("Hero"),
  Site: (c) => c.type === "Site",
  // Evil Enhancements also surface Curses (an evil-side enhancement-like type)
  EE: (c) => c.type.includes("EE") || c.type === "Curse",
  "Territory-Class": (c) => c.class.includes("Territory"),
  "Warrior-Class": (c) => c.class.includes("Warrior"),
  "Weapon-Class": (c) => c.class.includes("Weapon"),
  // Enhancements by alignment
  "Good Enhancement": (c) => c.type === "Enhancement" && c.alignment.includes("Good"),
  "Evil Enhancement": (c) => c.type === "Enhancement" && c.alignment.includes("Evil"),
  "Lost Soul": (c) => c.type.includes("Lost Soul"),
  "City": (c) => c.type.includes("City"),
  "Good Multi": (c) => {
    const brigades = c.brigade.split("/");
    return GOOD_BRIGADES.every(b => brigades.includes(b));
  },
  "Evil Multi": (c) => {
    const brigades = c.brigade.split("/");
    return EVIL_BRIGADES.every(b => brigades.includes(b));
  },
};

// Brigade normalization helpers
// Known multi-word brigade names that should NOT be split on space
const KNOWN_MULTI_WORD_BRIGADES = new Set(["Pale Green", "Good Gold", "Evil Gold", "Good Multi", "Evil Multi"]);

export function handleSimpleBrigades(brigade: string) {
  if (!brigade) return [];
  if (brigade.includes("and")) {
    return brigade.split("and")[0].trim().split("/");
  }
  if (brigade.includes("(")) {
    const [mainBrigade, subBrigades] = brigade.split(" (");
    return mainBrigade.trim().split("/").concat(subBrigades.replace(")", "").split("/"));
  }
  let parts: string[];
  if (brigade.includes("/")) {
    parts = brigade.split("/");
  } else {
    parts = [brigade];
  }
  // Split any piece that contains a space but isn't a known multi-word brigade
  // e.g. "Teal Gold" -> ["Teal", "Gold"]
  const result: string[] = [];
  for (const part of parts) {
    if (part.includes(" ") && !KNOWN_MULTI_WORD_BRIGADES.has(part)) {
      result.push(...part.split(" "));
    } else {
      result.push(part);
    }
  }
  return result;
}

export function replaceBrigades(brigades: string[], target: string, replacement: string) {
  return brigades.map(b => b === target ? replacement : b);
}

export function replaceMultiBrigades(brigadesList: string[]) {
  let result = [...brigadesList];
  if (result.includes("Good Multi")) {
    result = result.filter(b => b !== "Good Multi");
    result = result.concat(GOOD_BRIGADES);
  }
  if (result.includes("Evil Multi")) {
    result = result.filter(b => b !== "Evil Multi");
    result = result.concat(EVIL_BRIGADES);
  }
  return result;
}

export function handleGoldBrigade(cardName: string, alignment: string, brigadesList: string[]) {
  const goldReplacement: Record<string, string> = {
    "Good": "Good Gold",
    "Evil": "Evil Gold",
    "Neutral": (
      brigadesList[0] === "Gold" || ["First Bowl of Wrath (RoJ)", "Banks of the Nile/Pharaoh's Court"].includes(cardName)
        ? "Good Gold"
        : "Evil Gold"
    ),
    undefined: "Good Gold",
    null: "Good Gold",
  };
  return replaceBrigades(brigadesList, "Gold", goldReplacement[alignment]);
}

export function normalizeBrigadeField(brigade: string, alignment: string, cardName: string) {
  if (!brigade) return [];
  let brigadesList = handleSimpleBrigades(brigade);
  const multiCount = brigadesList.filter(b => b === "Multi").length;
  if (multiCount > 0) {
    // If two 'Multi', expand to both Good Multi and Evil Multi
    if (multiCount === 2) {
      brigadesList = brigadesList.filter(b => b !== "Multi");
      brigadesList.push("Good Multi", "Evil Multi");
    } else {
      const multiReplacements: Record<string, string> = {
        "Good": "Good Multi",
        "Evil": "Evil Multi",
        "Neutral": "Good Multi",
      };
      brigadesList = replaceBrigades(
        brigadesList,
        "Multi",
        multiReplacements[cardName] || multiReplacements[alignment]
      );
    }
  }
  if (brigadesList.includes("Gold")) {
    brigadesList = handleGoldBrigade(cardName, alignment, brigadesList);
  }
  brigadesList = replaceMultiBrigades(brigadesList);
  const allowedBrigades = new Set([...GOOD_BRIGADES, ...EVIL_BRIGADES]);
  for (const brigade of brigadesList) {
    if (!allowedBrigades.has(brigade)) {
      throw new Error(`Card ${cardName} has an invalid brigade: ${brigade}.`);
    }
  }
  return brigadesList.sort();
}
