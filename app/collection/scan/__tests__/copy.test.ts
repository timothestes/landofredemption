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
    expect(COPY.unresolvedWarning).toBe('{n} cards aren\'t matched and won\'t be added.');
    expect(COPY.alreadyCommitted).toBe('These cards were already added to your collection.');
  });
});

describe('scanErrorView', () => {
  it('maps 401 to gate', () => {
    expect(scanErrorView(401, null, null, now).kind).toBe('gate');
  });
  it('maps a text/plain 413 to Too large', () => {
    const v = scanErrorView(413, null, null, now);
    expect(v).toMatchObject({ kind: 'too_large', text: 'Photo is too large to upload.', retry: false, chooseAnother: true });
  });
  it('maps 415 to heif', () => {
    expect(scanErrorView(415, null, null, now)).toMatchObject({ kind: 'heif', retry: false, chooseAnother: true });
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
    expect(v.text).toBe("The scanner has reached this month's limit for everyone. Back on 12 November.");
  });
  it('spend cap is credit out with a date', () => {
    const v = scanErrorView(503, { code: 'cap_global_spend', resetsAt: '2026-11-01T00:00:00Z' }, null, now);
    expect(v.kind).toBe('credit_out');
    expect(v.text).toBe("The scanner's monthly budget is used up. Back on 1 November.");
  });
  it('billing_error has no date', () => {
    const v = scanErrorView(503, { code: 'billing_error' }, null, now);
    expect(v.kind).toBe('credit_out');
    expect(v.text).toBe("The scanner's monthly budget is used up.");
  });
  it('busy honours Retry-After and caps at 60', () => {
    expect(scanErrorView(503, { code: 'upstream_overloaded' }, '12', now)).toMatchObject({ kind: 'busy', text: 'Busy. Retrying…', retry: true, autoRetryAfterSec: 12 });
    expect(scanErrorView(429, { code: 'upstream_rate_limit' }, '500', now).autoRetryAfterSec).toBe(60);
    expect(scanErrorView(429, { code: 'upstream_rate_limit' }, null, now).autoRetryAfterSec).toBe(30);
  });
  it('unknown 500 is generic and retryable', () => {
    expect(scanErrorView(500, null, null, now)).toMatchObject({ kind: 'generic', text: "Couldn't read this photo.", retry: true });
    expect(scanErrorView(502, { code: 'reserve_failed' }, null, now).kind).toBe('generic');
  });
  it('rehydrated lost photo is generic and retryable', () => {
    expect(scanErrorView(0, { code: 'lost_on_reload' }, null, now)).toMatchObject({ kind: 'generic', retry: true });
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
    expect(footerTotal(84.2, 2)).toBe('$84.20 at YTG · 2 unpriced');
    expect(footerTotal(10, 0)).toBe('$10.00 at YTG');
  });
});
