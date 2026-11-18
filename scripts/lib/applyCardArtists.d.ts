type Row = Record<string, string>;
export type ArtistMethod = 'sheetSet' | 'sheetName' | 'sheetFuzzy' | 'scanOverride' | 'scan';
export declare function applyCardArtists<T extends Row>(
  cards: T[],
  snapshot: { rows?: Array<{ name: string; set: string; ref: string; artist: string }> } | null,
  printingCues: Record<string, { illustrator?: string | null }> | null,
): {
  stats: { sheetSet: number; sheetName: number; sheetFuzzy: number; scanOverride: number; scan: number; none: number };
  unresolved: Array<{ name: string; set: string; candidates: string[] }>;
  methods: Map<T, ArtistMethod>;
};
export declare function titleKey(name: string): string;
export declare function setMatches(card: { officialSet: string }, rowSet: string): boolean;
export declare function cueArtist(illustrator: string | null | undefined): string;
export declare function sameCredit(a: string, b: string): boolean;
export declare function artistKey(artist: string): string;
