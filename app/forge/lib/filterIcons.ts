// Art and labels for the card-details pickers. Pure: a name in, a public/ URL out.
//
// The deckbuilder's filter grid already ships a full set of Redemption icon art under
// public/filter-icons/ (Figma exports — hence the literal "Color=" prefix and the
// spaces in filenames). The forge reuses those files so a type or a brigade looks the
// same wherever you meet it.
//
// Two sources, split the way a printed card is: the icon box carries type and brigade,
// so those take the boxed filter-icon art; class and icons print as loose plates down
// the card's left edge, so those take the frame kit's bare glyphs.

import type { Alignment, Brigade, CardType, MultiSide, CLASSES, ICONS } from "./designCard";

type ClassName = (typeof CLASSES)[number];
type IconName = (typeof ICONS)[number];

const FILTER_ICONS = "/filter-icons";
const KIT_ICONS = "/forge/frames/icons";

// Forge spells its types in PascalCase; the art files use the printed wording.
const TYPE_ART: Record<CardType, string> = {
  Hero: "Hero",
  EvilCharacter: "Evil Character",
  GE: "GE",
  EE: "EE",
  LostSoul: "Lost Soul",
  Artifact: "Artifact",
  Dominant: "Good Dominant",
  Fortress: "Good Fortress",
  Site: "Site",
  City: "City",
  Curse: "Curse",
  Covenant: "Covenant",
};

// Dominants and Fortresses are printed in a good and an evil version; the card's
// alignment picks which. Everything else has a single printing.
const EVIL_TYPE_ART: Partial<Record<CardType, string>> = {
  Dominant: "Evil Dominant",
  Fortress: "Evil Fortress",
};

const BRIGADE_ART: Record<Brigade, string> = {
  Blue: "Blue", Clay: "Clay", GoodGold: "Good Gold", Green: "Green", Purple: "Purple",
  Red: "Red", Silver: "Silver", Teal: "Teal", White: "White",
  Black: "Black", Brown: "Brown", Crimson: "Crimson", EvilGold: "Evil Gold",
  Gray: "Gray", Orange: "Orange", PaleGreen: "Pale Green",
};

const GLYPH_ART: Record<ClassName | IconName, string> = {
  Warrior: "warrior", Weapon: "weapon",
  Territory: "territory", Star: "star", Cloud: "cloud",
};

/** Boxed art for a card type. Good art unless the card is explicitly Evil. */
export function typeIconSrc(type: CardType, alignment: Alignment | undefined): string {
  const name = (alignment === "Evil" && EVIL_TYPE_ART[type]) || TYPE_ART[type];
  return `${FILTER_ICONS}/${encodeURIComponent(name)}.png`;
}

/** Boxed art in the brigade's own color. "Color=" is part of the filename, not a
 *  query string, so it stays outside the encoding — as the filter grid writes it. */
export function brigadeIconSrc(brigade: Brigade): string {
  return `${FILTER_ICONS}/Color=${encodeURIComponent(BRIGADE_ART[brigade])}.png`;
}

/** The multi-brigade foil for an alignment's whole set. */
export function multiBrigadeIconSrc(side: MultiSide): string {
  return `${FILTER_ICONS}/Color=${encodeURIComponent(`${side} Multi`)}.png`;
}

/** Bare frame-kit glyph for a class (Warrior/Weapon) or icon (Territory/Star/Cloud). */
export function glyphIconSrc(name: ClassName | IconName): string {
  return `${KIT_ICONS}/${GLYPH_ART[name]}.png`;
}

// Display only — storage, the diff and the collapsed summary keep the union's spelling.
// A grid of tiles is much harder to scan when two words run together.
const TYPE_LABEL: Partial<Record<CardType, string>> = {
  EvilCharacter: "Evil Character",
  LostSoul: "Lost Soul",
};
const BRIGADE_LABEL: Partial<Record<Brigade, string>> = {
  GoodGold: "Good Gold",
  EvilGold: "Evil Gold",
  PaleGreen: "Pale Green",
};

export function typeLabel(type: CardType): string {
  return TYPE_LABEL[type] ?? type;
}

export function brigadeLabel(brigade: Brigade): string {
  return BRIGADE_LABEL[brigade] ?? brigade;
}
