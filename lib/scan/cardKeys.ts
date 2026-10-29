import { findCard } from "@/lib/cards/lookup";

/** True when `name|set|imgFile` is exactly a card in the catalog. */
export function isKnownCardKey(k: string): boolean {
  const [n, s, i] = k.split("|");
  const c = findCard(n, s, i);
  return !!c && `${c.name}|${c.set}|${c.imgFile}` === k;
}
