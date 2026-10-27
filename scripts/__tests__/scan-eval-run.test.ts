import { describe, it, expect } from 'vitest';
import { parseArgs, recordFor, globToRegExp, parseRetryAfter, isRetryable } from '@/scripts/scan-eval/run';

describe('run.ts', () => {
  it('parses the arm and defaults', () => {
    const o = parseArgs(['--base-url', 'https://x', '--cookie', 'c', '--arm', '{"model":"claude-haiku-5-5"}']);
    expect(o.arm.model).toBe('claude-haiku-5-5');
    expect(o.concurrency).toBe(2);
    expect(o.source).toBe('eval');
  });
  it('a 200 becomes a record, a 429 is not a miss', () => {
    expect(recordFor('a.jpg', { status: 200, headers: new Headers(), json: { scanId: 's', detections: [], usage: { model: 'm' } } }, 1200, 1).detections).toEqual([]);
    expect(recordFor('a.jpg', { status: 429, headers: new Headers({ 'retry-after': '5' }), json: { code: 'upstream_rate_limit' } }, 10, 3).error).toBe('upstream_rate_limit');
  });
  it('falls back to http_<status> when the body has no code', () => {
    expect(recordFor('a.jpg', { status: 503, headers: new Headers(), json: null }, 1, 5).error).toBe('http_503');
  });
  it('rejects missing required options and bad arm JSON', () => {
    expect(() => parseArgs(['--cookie', 'c'])).toThrow();
    expect(() => parseArgs(['--base-url', 'u', '--cookie', 'c', '--arm', '{nope'])).toThrow();
  });
  it('minimal glob supports * and ?', () => {
    expect(globToRegExp('IMG_*.jpg').test('IMG_001.jpg')).toBe(true);
    expect(globToRegExp('a?.jpg').test('ab.jpg')).toBe(true);
    expect(globToRegExp('a?.jpg').test('abc.jpg')).toBe(false);
    expect(globToRegExp('a.jpg').test('aXjpg')).toBe(false);
  });
  it('parseRetryAfter handles seconds, HTTP dates, junk and the cap', () => {
    expect(parseRetryAfter('7', 0)).toBe(7000);
    expect(parseRetryAfter('9999', 0)).toBe(120000);
    expect(parseRetryAfter(null, 0)).toBe(5000);
    expect(parseRetryAfter('junk', 0)).toBe(5000);
    const now = Date.parse('2026-10-27T00:00:00Z');
    expect(parseRetryAfter('Tue, 27 Oct 2026 00:00:10 GMT', now)).toBe(10000);
    expect(parseRetryAfter('Tue, 27 Oct 2026 00:00:00 GMT', now + 5000)).toBe(5000);
  });
  it('isRetryable: network errors and 429/503 yes, billing and global caps no', () => {
    expect(isRetryable(0, null)).toBe(true);
    expect(isRetryable(429, { code: 'upstream_rate_limit' })).toBe(true);
    expect(isRetryable(503, { code: 'upstream_overloaded' })).toBe(true);
    expect(isRetryable(503, { code: 'billing_error' })).toBe(false);
    expect(isRetryable(503, { code: 'cap_global_30d' })).toBe(false);
    expect(isRetryable(503, { code: 'cap_global_spend' })).toBe(false);
    expect(isRetryable(502, { code: 'recognizer_failed' })).toBe(false);
  });
});
