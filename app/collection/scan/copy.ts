import type { ScanErrorBody } from './types';

// v1.0 keys of the spec's Copy table. {braces} are interpolated by callers.
export const COPY: Record<string, string> = {
  pageTitle: 'Scan cards',
  firstRun: 'Photograph one card, or up to 12 laid flat with gaps. We read the names and prices; you confirm.',
  capturePrimary: 'Take photo',
  captureSecondary: 'Choose from photos',
  batchTip: 'For a stack, take the photos in your camera app first, then choose them here.',
  binderTip: 'Binder pages work less well. Lay cards flat with gaps when you can.',
  emptyTray: 'No cards yet. Take a photo to start.',
  reading: 'Reading…',
  readingSlow: 'Reading… {s} s',
  done: '{n} cards',
  tooDark: 'Too dark. Retake in better light.',
  blurry: 'Blurry. Hold still and retake.',
  glare: 'Glare hides the text. Tilt away from the light.',
  noCards: 'No cards found in this photo.',
  tooMany: 'Too many cards for one photo. Try 12 or fewer.',
  heif: 'This photo\'s format can\'t be opened here. Turn off HEIF or "high efficiency" in your camera, or share it as a JPEG.',
  tooLarge: 'Photo is too large to upload.',
  capTenMinute: "You've hit {limit} photos in 10 minutes. Scanning opens again at {time}.",
  capDaily: 'Daily limit reached ({limit} photos). Scanning opens again {day} at {time}.',
  capGlobal: "The scanner has reached this month's limit for everyone. Back on {date}.",
  creditOut: "The scanner's monthly budget is used up. Back on {date}.",
  creditOutNoDate: "The scanner's monthly budget is used up.",
  busy: 'Busy. Retrying…',
  generic: "Couldn't read this photo.",
  offline: "You're offline. Photos will wait here until you reconnect.",
  retry: 'Retry',
  remove: 'Remove',
  chooseAnother: 'Choose another',
  chipCheck: 'Check this',
  chipNotFound: 'Not found',
  reasonPrintingPrice: 'Which printing? Prices differ',
  reasonPrintingLegality: 'Which printing? Legality differs',
  reasonNameAmbiguous: 'Two different cards have this name',
  reasonScripture: "Couldn't read the scripture reference",
  reasonLostSouls: 'Several Lost Souls share this verse',
  reasonSaul: 'Read as "Saul"',
  printings: '{n} printings',
  owned: 'own {n}',
  unpriced: 'No YTG listing',
  findCard: 'Find card',
  pickerHeader: 'Which printing?',
  pickerNameHeader: 'Which card?',
  pickerSearch: 'Search by card name',
  pickerCurrent: 'Current',
  pickerOwned: '{n} in your collection',
  pickerEmpty: 'No cards match.',
  quantity: 'Quantity',
  removeReasonWrong: 'Wrong card',
  removeReasonUnwanted: "Don't want it",
  footerTotal: '{total} at YTG · {n} unpriced',
  commit: 'Add {n} to collection',
  committing: 'Adding…',
  waitingForPhotos: 'Waiting for photos to finish reading…',
  commitFailed: "Couldn't save. Your tray is still here. Try again.",
  alreadyCommitted: 'These cards were already added to your collection.',
  unresolvedWarning: "{n} cards aren't matched and won't be added.",
  unresolvedWarningOne: "1 card isn't matched and won't be added.",
  success: 'Added {n} cards to your collection.',
  successOne: 'Added 1 card to your collection.',
  undo: 'Undo',
  scanMore: 'Scan more',
  viewCollection: 'View collection',
  undoDone: 'Removed {n} cards.',
  undoDoneOne: 'Removed 1 card.',
  undoSuperseded: "A later commit can't be undone from here.",
  undoPartial: "Couldn't undo everything. Check your collection.",
  undoFailed: "Couldn't undo. Try again.",
  footerTooltip: 'Estimated cost to buy these cards at Your Turn Games retail prices — not a resale value.',
  justAdded: 'Just added',
  retentionNote:
    'Photos are sent to Anthropic to read the cards. Anthropic deletes them within 30 days unless its safety systems flag them (then up to two years) and does not train on them. We keep the text we read from each card, not the photo.',
  gate: "Sign in to scan cards, see what they're worth at YTG, and add them to your collection.",
  deckBuilderLink: 'Scan your cards',
  beta: 'Beta',
};

export type ScanErrorKind =
  | 'gate' | 'too_large' | 'heif' | 'cap_10m' | 'cap_24h' | 'cap_global'
  | 'credit_out' | 'busy' | 'generic' | 'offline';

export interface ScanErrorView {
  kind: ScanErrorKind;
  text: string;
  retry: boolean;
  chooseAnother: boolean;
  autoRetryAfterSec?: number;
}

export const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

const timeOf = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const dateOf = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

export function scanErrorView(
  status: number,
  body: ScanErrorBody | null,
  retryAfter: string | null,
  now: Date,
): ScanErrorView {
  const code = body?.code;
  const resets = body?.resetsAt ? new Date(body.resetsAt) : null;
  const validResets = resets && !Number.isNaN(resets.getTime()) ? resets : null;
  const view = (kind: ScanErrorKind, text: string, retry = false, chooseAnother = false, autoRetryAfterSec?: number): ScanErrorView =>
    autoRetryAfterSec === undefined
      ? { kind, text, retry, chooseAnother }
      : { kind, text, retry, chooseAnother, autoRetryAfterSec };

  if (status === 401) return view('gate', COPY.gate);
  if (status === 413) return view('too_large', COPY.tooLarge, false, true);
  if (status === 415) return view('heif', COPY.heif, false, true);

  if (code === 'cap_user_10m' && validResets) {
    return view('cap_10m', fill(COPY.capTenMinute, { limit: body?.limit ?? '', time: timeOf(validResets) }));
  }
  if (code === 'cap_user_24h' && validResets) {
    const day = validResets.toDateString() === now.toDateString() ? 'today' : 'tomorrow';
    return view('cap_24h', fill(COPY.capDaily, { limit: body?.limit ?? '', day, time: timeOf(validResets) }));
  }
  if (code === 'cap_global_30d' && validResets) {
    return view('cap_global', fill(COPY.capGlobal, { date: dateOf(validResets) }));
  }
  if (code === 'cap_global_spend' && validResets) {
    return view('credit_out', fill(COPY.creditOut, { date: dateOf(validResets) }));
  }
  if (code === 'billing_error') return view('credit_out', COPY.creditOutNoDate);
  if (code === 'upstream_rate_limit' || code === 'upstream_overloaded') {
    const sec = Math.min(60, Number(retryAfter) || 30);
    return view('busy', COPY.busy, true, false, sec);
  }
  return view('generic', COPY.generic, true);
}

const QUALITY: Record<string, string> = {
  dark: 'Too dark',
  blurry: 'Blurry',
  glare: 'Glare',
  no_cards: 'No cards',
  too_many_cards: 'Too many',
};
export function qualityLine(q: string): string | null {
  return QUALITY[q] ?? null;
}

export function doneLine(n: number): string {
  return `${n} ${n === 1 ? 'card' : 'cards'}`;
}

export function readingLine(elapsedMs: number): string {
  return elapsedMs < 5000 ? COPY.reading : fill(COPY.readingSlow, { s: Math.floor(elapsedMs / 1000) });
}

export function footerTotal(priced: number, unpriced: number): string {
  const base = `$${priced.toFixed(2)} at YTG`;
  return unpriced > 0 ? `${base} · ${unpriced} unpriced` : base;
}
