// Lazy-loaded with the Lost Soul sheet: it pulls the whole card catalog.
import { CARDS } from '@/lib/cards/lookup';

export interface LostSoulOption {
  key: string;
  name: string;
  nickname: string;
  reference: string;
  set: string;
  imgFile: string;
  rotation: boolean;
}

/** `Lost Soul "Accusers" [Ezra 4:6]` -> `Accusers`; empty for a plain name. */
export const nicknameOf = (name: string): string => /"([^"]+)"/.exec(name)?.[1] ?? '';

let all: LostSoulOption[] | null = null;
const everyOption = (): LostSoulOption[] =>
  (all ??= CARDS.filter(c => c.type.includes('Lost Soul'))
    .map(c => ({
      key: `${c.name}|${c.set}|${c.imgFile}`,
      name: c.name,
      nickname: nicknameOf(c.name),
      reference: c.reference,
      set: c.set,
      imgFile: c.imgFile,
      rotation: c.legality === 'Rotation',
    }))
    .sort((a, b) => a.nickname.localeCompare(b.nickname) || a.reference.localeCompare(b.reference)));

/** Every Lost Soul printing, Rotation-legal only unless `showAll`, by nickname then reference. */
export const lostSoulOptions = (showAll: boolean): LostSoulOption[] =>
  showAll ? everyOption() : everyOption().filter(o => o.rotation);

/** Case-insensitive over nickname, reference and set. */
export function matchLostSouls(query: string, options: LostSoulOption[]): LostSoulOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(o => [o.nickname, o.reference, o.set].some(f => f.toLowerCase().includes(q)));
}
