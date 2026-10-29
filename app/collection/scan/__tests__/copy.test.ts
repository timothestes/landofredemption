process.env.TZ = 'UTC';
import { describe, it, expect } from 'vitest';
import { COPY, scanErrorView, qualityLine, doneLine, readingLine, footerTotal } from '../copy';

const now = new Date('2026-10-27T12:00:00Z');

describe('COPY', () => {
  it('every spec copy key is present verbatim', () => {
    expect(COPY.firstRun).toBe('Photograph one card, or up to 12 laid flat with gaps. We read the names and prices; you confirm.');
    expect(COPY.heif).toBe('This photo\'s format can\'t be opened here. Turn off HEIF or "high efficiency" in your camera, or share it as a JPEG.');
    expect(COPY.retentionNote).toBe('Photos are sent to Anthropic to read the cards. Anthropic deletes them within 30 days unless its safety systems flag them (then up to two years) and does not train on them. We keep the text we read from each card, not the photo.');
    expect(COPY.gate).toBe('Sign in to scan cards, see what they\'re worth at YTG, and add them to your collection.');
    expect(COPY.unresolvedWarning).toBe('{n} cards need a pick and won’t be added until you choose.');
    expect(COPY.alreadyCommitted).toBe('These cards were already added to your collection.');
  });
});

describe('scanErrorView', () => {
  it('422 too_many_cards', () => {
    const v = scanErrorView(422, { code: 'too_many_cards' }, null, new Date());
    expect(v).toMatchObject({ kind: 'too_many_cards', retry: false, chooseAnother: true });
    expect(v.text).toBe(COPY.tooManyCardsDeck);
  });
  it('maps 401 to signed out, with Retry and a Sign in link', () => {
    expect(scanErrorView(401, null, null, now)).toMatchObject({ kind: 'gate', retry: true, signIn: true });
  });
  it('maps 403 to not open, with no Retry', () => {
    expect(scanErrorView(403, { code: 'forbidden' }, null, now)).toMatchObject({ kind: 'forbidden', retry: false });
  });
  it('maps a text/plain 413 to Too large', () => {
    const v = scanErrorView(413, null, null, now);
    expect(v).toMatchObject({ kind: 'too_large', text: 'Photo is too large to upload.', retry: false, chooseAnother: true });
  });
  it('maps the client HEIF failure to the HEIF advice, and a server 415 to a plain "can\'t open"', () => {
    expect(scanErrorView(415, { code: 'heif' }, null, now)).toMatchObject({ kind: 'heif', retry: false, chooseAnother: true });
    expect(scanErrorView(415, { code: 'undecodable' }, null, now)).toMatchObject({ kind: 'undecodable', chooseAnother: true });
  });
  it('caps keep Retry, since the photo is still held', () => {
    expect(scanErrorView(429, { code: 'cap_user_10m', limit: 20, resetsAt: '2026-10-27T15:15:00Z' }, null, now).retry).toBe(true);
  });
  it('ten-minute cap interpolates limit and local time', () => {
    const v = scanErrorView(429, { code: 'cap_user_10m', limit: 20, resetsAt: '2026-10-27T15:15:00Z' }, null, now);
    expect(v.kind).toBe('cap_10m');
    expect(v.text).toBe("You've hit 20 photos in 10 minutes. Scanning opens again at 3:15 pm.");
  });
  it('daily cap says tomorrow when resetsAt is another day', () => {
    const v = scanErrorView(429, { code: 'cap_user_24h', limit: 150, resetsAt: '2026-10-28T09:02:00Z' }, null, now);
    expect(v.text).toBe('Daily limit reached (150 photos). Scanning opens again tomorrow at 9:02 am.');
    const t = scanErrorView(429, { code: 'cap_user_24h', limit: 150, resetsAt: '2026-10-27T20:02:00Z' }, null, now);
    expect(t.text).toContain('today at 8:02 pm');
  });
  it('global cap shows the date', () => {
    const v = scanErrorView(503, { code: 'cap_global_30d', resetsAt: '2026-11-12T00:00:00Z' }, null, now);
    expect(v.kind).toBe('cap_global');
    expect(v.text).toBe("The scanner has reached this month's limit for everyone. Back on November 12.");
  });
  it('spend cap is credit out with a date', () => {
    const v = scanErrorView(503, { code: 'cap_global_spend', resetsAt: '2026-11-01T00:00:00Z' }, null, now);
    expect(v.kind).toBe('credit_out');
    expect(v.text).toBe("The scanner's monthly budget is used up. Back on November 1.");
  });
  it('billing_error has no date', () => {
    const v = scanErrorView(503, { code: 'billing_error' }, null, now);
    expect(v.kind).toBe('credit_out');
    expect(v.text).toBe("The scanner's monthly budget is used up.");
  });
  it('busy honours Retry-After and caps at 60', () => {
    expect(scanErrorView(503, { code: 'upstream_overloaded' }, '12', now)).toMatchObject({ kind: 'busy', text: 'The scanner is busy. Trying again shortly…', retry: true, autoRetryAfterSec: 12 });
    expect(scanErrorView(429, { code: 'upstream_rate_limit' }, '500', now).autoRetryAfterSec).toBe(60);
    expect(scanErrorView(429, { code: 'upstream_rate_limit' }, null, now).autoRetryAfterSec).toBe(30);
  });
  it('server failures say so instead of blaming the photo', () => {
    expect(scanErrorView(500, { code: 'internal' }, null, now)).toMatchObject({ kind: 'server', retry: true });
    expect(scanErrorView(503, { code: 'reserve_failed' }, null, now).kind).toBe('server');
    expect(scanErrorView(502, { code: 'recognizer_failed' }, null, now)).toMatchObject({ kind: 'generic', retry: true, chooseAnother: true });
  });
  it('network and timeout point at the connection', () => {
    expect(scanErrorView(0, { code: 'network' }, null, now)).toMatchObject({ kind: 'network', retry: true });
    expect(scanErrorView(0, { code: 'timeout' }, null, now)).toMatchObject({ kind: 'timeout', retry: true });
  });
  it('a photo lost on reload asks to choose it again', () => {
    expect(scanErrorView(0, { code: 'lost_on_reload' }, null, now)).toMatchObject({ kind: 'lost_on_reload', retry: false, chooseAnother: true });
  });
});

describe('line helpers', () => {
  it('qualityLine', () => {
    expect(qualityLine('dark')).toBe('Too dark');
    expect(qualityLine('blurry')).toBe('Blurry');
    expect(qualityLine('glare')).toBe('Glare');
    expect(qualityLine('no_cards')).toBe('No cards');
    expect(qualityLine('too_many_cards')).toBe('Too many');
    expect(qualityLine('ok')).toBeNull();
  });
  it('doneLine', () => {
    expect(doneLine(9)).toBe('9 cards');
    expect(doneLine(1)).toBe('1 card');
  });
  it('readingLine', () => {
    expect(readingLine(4999)).toBe('Reading…');
    expect(readingLine(12400)).toBe('Reading… 12 s');
  });
  it('footerTotal', () => {
    expect(footerTotal(84.2, 2)).toBe('YTG retail est. $84.20 · 2 unpriced');
    expect(footerTotal(10, 0)).toBe('YTG retail est. $10.00');
  });
});
