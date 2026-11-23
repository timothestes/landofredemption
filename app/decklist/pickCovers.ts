/** A deck card as the cover pick sees it. No catalog import, so the deck builder can use this client side. */
export type CoverCandidate = {
  imgFile?: string | null;
  name?: string | null;
  type?: string | null;
  zone: string;
  quantity: number;
};

const HERO_TYPES = ["Hero", "HC", "Hero Character"];
const EVIL_TYPES = ["Evil Character", "EC"];

/**
 * A deck's two cover cards. A chosen cover stays while its card is still in the main deck, in its new
 * printing if the player swapped printings (`nameOf` names a cover's image file). A slot that is empty, or
 * whose card was cut (or moved to the Reserve or maybeboard), gets the builder's pick for that slot: the
 * first Hero for cover 1, the first Evil Character for cover 2, else the first main-deck card the other
 * cover isn't already showing.
 */
export function pickCovers(
  chosen: readonly [string | null | undefined, string | null | undefined],
  cards: CoverCandidate[],
  nameOf: (imgFile: string) => string | undefined = () => undefined,
): [string | null, string | null] {
  const main = cards.filter((c) => c.zone === "main" && c.quantity > 0 && c.imgFile);
  const keep = (file: string | null | undefined) => {
    if (!file) return null;
    if (main.some((c) => c.imgFile === file)) return file;
    const name = nameOf(file);
    return (name && main.find((c) => c.name === name)?.imgFile) || null;
  };
  const pick = (types: string[], other: string | null) =>
    (main.find((c) => types.includes(c.type ?? "") && c.imgFile !== other) ??
      main.find((c) => c.imgFile !== other))?.imgFile ?? null;

  const kept1 = keep(chosen[0]);
  const kept2 = keep(chosen[1]);
  const cover1 = kept1 ?? pick(HERO_TYPES, kept2);
  const cover2 = kept2 ?? pick(EVIL_TYPES, cover1);
  return [cover1, cover2];
}
