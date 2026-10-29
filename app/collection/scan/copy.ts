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
  waiting: 'Waiting…',
  waitingOffline: 'Waiting for a connection…',
  readingSlow: 'Reading… {s} s',
  done: '{n} cards',
  mergedAbove: '{n} already listed above, count raised',
  mergedAboveAll: 'all already listed above, counts raised',
  qualityCheckNames: '{q}: check the names below',
  tooManyPartial: 'some cards may be missing. Use 12 or fewer per photo',
  tooDark: 'Too dark. Retake in better light.',
  blurry: 'Blurry. Hold still and retake.',
  glare: 'Glare hides the text. Tilt away from the light.',
  noCards: 'No cards found in this photo.',
  tooMany: 'Too many cards for one photo. Try 12 or fewer.',
  tooManyCardsDeck: 'Too many cards for one photo. Photograph the deck in two halves and add both.',
  heif: 'This photo\'s format can\'t be opened here. Turn off HEIF or "high efficiency" in your camera, or share it as a JPEG.',
  undecodable: "Couldn't open this file as a photo. Try a JPEG or PNG.",
  tooLarge: 'Photo is too large to upload.',
  capTenMinute: "You've hit {limit} photos in 10 minutes. Scanning opens again at {time}.",
  capDaily: 'Daily limit reached ({limit} photos). Scanning opens again {day} at {time}.',
  capGlobal: "The scanner has reached this month's limit for everyone. Back on {date}.",
  creditOut: "The scanner's monthly budget is used up. Back on {date}.",
  creditOutNoDate: "The scanner's monthly budget is used up.",
  busy: 'The scanner is busy. Trying again shortly…',
  busyGaveUp: 'The scanner is busy. Retry in a minute.',
  generic: "Couldn't read the cards in this photo. Retry, or retake it.",
  network: "Couldn't upload. Check your connection, then Retry.",
  timeout: 'This took too long. Check your connection, then Retry.',
  server: 'Something went wrong on our end. Retry in a moment.',
  lostOnReload: 'The page reloaded before this photo was read. Choose it again.',
  signedOut: "You've been signed out. Sign in, then Retry. Your tray stays here.",
  notOpen: "The scanner isn't open to your account yet.",
  offline: "You're offline. Photos will wait here until you reconnect.",
  retry: 'Retry',
  remove: 'Remove',
  chooseAnother: 'Choose another',
  chipCheck: 'Check printing',
  chipPick: 'Pick card',
  chipNotFound: 'Not found',
  // Printing guesses name the guess, so the player knows what gets added if they skip it.
  reasonPrintingGuess: 'Our guess: {set}',
  reasonNameAmbiguous: 'Two cards share this name. Tap to pick',
  reasonScripture: "Couldn't read the verse. Tap to pick",
  reasonLostSouls: 'Several Lost Souls share this verse. Tap to pick',
  reasonNotFound: 'Tap Find card to search',
  readAs: 'Read as “{title}”',
  printings: '{n} printings',
  owned: 'own {n}',
  unpriced: 'No YTG listing',
  findCard: 'Find card',
  viewCard: 'View card',
  pickerHeader: 'Which printing?',
  pickerNameHeader: 'Which card?',
  pickerChoose: 'Choose',
  pickerSearch: 'Search by card name',
  pickerCurrent: 'Current',
  pickerOwned: '{n} in your collection',
  pickerEmpty: 'No cards match. Try fewer letters, like the first word of the name.',
  pickerClose: 'No exact match for that spelling. Close matches:',
  quantity: 'Quantity',
  removePrompt: 'Remove because it’s…',
  removeReasonWrong: 'Misread',
  removeReasonUnwanted: 'Not adding it',
  removeFixInstead: 'Fix it instead',
  removedRow: 'Removed',
  restore: 'Undo',
  removePhoto: 'Remove photo',
  removePhotoConfirm: 'Remove this photo and its {n} cards?',
  removePhotoConfirmOne: 'Remove this photo and its card?',
  cancel: 'Cancel',
  each: 'ea',
  showPrices: 'Show YTG prices',
  commit: 'Add {n} to collection',
  committing: 'Adding…',
  waitingForPhotos: 'Waiting for photos to finish reading…',
  commitFailed: "Couldn't save. Nothing was added. Try again.",
  commitUnsure: "We couldn't confirm the save. Tap Try again to check. Your tray is locked so nothing is added twice.",
  commitUnconfirmed:
    "We couldn't confirm whether these cards were added. Check your collection before adding them again.",
  commitTooManyRows: 'Too many different cards for one add (max {max}). Remove a few photos, add these, then scan the rest.',
  commitStale: "The card list was updated since you scanned, so this tray can't be added. Tap Scan more and rescan these photos.",
  commitSignedOut: "You've been signed out. Sign in again; your tray stays here.",
  signIn: 'Sign in',
  tryAgain: 'Try again',
  alreadyCommitted: 'These cards were already added to your collection.',
  unresolvedWarning: '{n} cards need a pick and won’t be added until you choose.',
  unresolvedWarningOne: '1 card needs a pick and won’t be added until you choose.',
  checkWarning: '{n} printings are our best guess. Check them before adding.',
  checkWarningOne: '1 printing is our best guess. Check it before adding.',
  showMe: 'Show me',
  success: 'Added {n} cards to your collection.',
  successOne: 'Added 1 card to your collection.',
  undo: 'Undo',
  scanMore: 'Scan more',
  viewCollection: 'View collection',
  undoDone: 'Removed {n} cards.',
  undoDoneOne: 'Removed 1 card.',
  undoDoneFewer: 'Removed {n} of {added} cards. The rest were already gone from your collection.',
  undoSuperseded: "You've added cards since this scan, so it can't be undone here. Change quantities on your collection page.",
  undoUnavailable: "Undo isn't available for this add. Change quantities on your collection page.",
  undoPartial: "Some cards couldn't be removed. Tap Undo again, or check your collection.",
  undoFailed: "Couldn't undo. Try again.",
  footerTooltip: 'Estimated cost to buy these cards at Your Turn Games retail prices — not a resale value.',
  justAdded: 'Just added',
  allCards: 'All cards',
  startNew: 'Taking a photo starts a new batch.',
  retentionSummary: 'How your photos are handled',
  retentionNote:
    'Photos are sent to Anthropic to read the cards. Anthropic deletes them within 30 days unless its safety systems flag them (then up to two years) and does not train on them. We keep the text we read from each card, not the photo.',
  betaNote: 'Beta: check each card before adding.',
  gate: "Sign in to scan cards, see what they're worth at YTG, and add them to your collection.",
  deckBuilderLink: 'Scan your cards',
  beta: 'Beta',
  crossLinkScanner: 'Scanning a whole deck? Use Deck from photo.',
};

export type ScanErrorKind =
  | 'gate' | 'forbidden' | 'too_large' | 'heif' | 'undecodable' | 'cap_10m' | 'cap_24h' | 'cap_global'
  | 'credit_out' | 'busy' | 'network' | 'timeout' | 'server' | 'lost_on_reload' | 'generic' | 'offline' | 'too_many_cards';

export interface ScanErrorView {
  kind: ScanErrorKind;
  text: string;
  retry: boolean;
  chooseAnother: boolean;
  autoRetryAfterSec?: number;
  /** Signed out: show a Sign in link. */
  signIn?: boolean;
}

export const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

const timeOf = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const dateOf = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

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

  if (status === 401) return { ...view('gate', COPY.signedOut, true), signIn: true };
  if (status === 403) return view('forbidden', COPY.notOpen);
  if (status === 422 && code === 'too_many_cards') return view('too_many_cards', COPY.tooManyCardsDeck, false, true);
  if (status === 413) return view('too_large', COPY.tooLarge, false, true);
  // 'heif' is the client's own decode failure; the server's 415 is any file it could not open.
  if (status === 415) return code === 'heif' ? view('heif', COPY.heif, false, true) : view('undecodable', COPY.undecodable, false, true);
  if (code === 'network') return view('network', COPY.network, true);
  if (code === 'timeout') return view('timeout', COPY.timeout, true);
  if (code === 'lost_on_reload') return view('lost_on_reload', COPY.lostOnReload, false, true);

  // The photo is still held, so Retry works once the window reopens.
  if (code === 'cap_user_10m' && validResets) {
    return view('cap_10m', fill(COPY.capTenMinute, { limit: body?.limit ?? '', time: timeOf(validResets) }), true);
  }
  if (code === 'cap_user_24h' && validResets) {
    const day = validResets.toDateString() === now.toDateString() ? 'today' : 'tomorrow';
    return view('cap_24h', fill(COPY.capDaily, { limit: body?.limit ?? '', day, time: timeOf(validResets) }), true);
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
  if (code === 'recognizer_failed') return view('generic', COPY.generic, true, true);
  return view('server', COPY.server, true);
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
  const base = `YTG retail est. $${priced.toFixed(2)}`;
  return unpriced > 0 ? `${base} · ${unpriced} unpriced` : base;
}
