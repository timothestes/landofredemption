import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import sharp from 'sharp';

vi.mock('@/utils/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/pricing/supabase-admin', () => ({ getSupabaseAdmin: vi.fn() }));
// Keep DEFAULT_ARM and the types; only the Claude call is stubbed.
vi.mock('@/lib/scan/recognize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/scan/recognize')>()),
  recognize: vi.fn(),
}));
vi.mock('@/lib/scan/prices', () => ({ loadPriceMap: vi.fn() }));

import { POST } from '@/app/api/scan/route';
import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { recognize, DEFAULT_ARM } from '@/lib/scan/recognize';
import { loadPriceMap } from '@/lib/scan/prices';
import { FIELD_CAPS, type ScanDetection } from '@/lib/scan/schema';
import { CARDS } from '@/lib/cards/lookup';
import { cardKey } from '@/lib/scan/vocab';

const SCAN_ID = '11111111-2222-3333-4444-555555555555';

const det = (p: Partial<ScanDetection>): ScanDetection => ({
  title: null, reference: null, nickname: null, abilityStart: null, abilityEnd: null, type: 'unknown', brigade: null,
  strength: null, toughness: null, identifier: null, printNumber: null, rarityCode: null, promoText: null,
  illustrator: null, copyrightYear: null, grid: { row: 1, col: 1 }, orientation: 'upright', confidence: 'high', ...p,
});

let rpc: Mock;
let getUser: Mock;
let update: Mock;
let eq: Mock;
let from: Mock;
let jpeg: Buffer;

function session(opts: { user?: boolean; superuser?: boolean; reserve?: unknown; reserveError?: boolean } = {}) {
  getUser = vi.fn().mockResolvedValue(
    opts.user === false ? { data: { user: null }, error: { message: 'no session' } } : { data: { user: { id: 'u1' } }, error: null },
  );
  rpc = vi.fn((fn: string) => {
    if (fn === 'is_superuser') return Promise.resolve({ data: opts.superuser === true, error: null });
    if (fn === 'scan_reserve') {
      return Promise.resolve(
        opts.reserveError ? { data: null, error: { message: 'boom' } } : { data: opts.reserve ?? { ok: true, id: SCAN_ID }, error: null },
      );
    }
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
  });
  (createClient as Mock).mockResolvedValue({ auth: { getUser }, rpc });
}

function req(photo?: Blob | string, extra: Record<string, string> = {}): Request {
  const fd = new FormData();
  if (photo !== undefined) {
    if (typeof photo === 'string') fd.append('photo', photo);
    else fd.append('photo', photo, 'photo.jpg');
  }
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return new Request('http://localhost/api/scan', { method: 'POST', body: fd });
}

const jpegBlob = () => new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' });
const reserveCalls = () => rpc.mock.calls.filter(([fn]) => fn === 'scan_reserve');
const patchWritten = () => update.mock.calls[0]?.[0];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('SCANNER_OPEN', '');
  vi.stubEnv('SCANNER_ALLOWLIST', 'u1');
  jpeg ??= await sharp({ create: { width: 64, height: 48, channels: 3, background: '#4a6' } }).jpeg().toBuffer();
  eq = vi.fn().mockResolvedValue({ data: null, error: null });
  update = vi.fn(() => ({ eq }));
  from = vi.fn(() => ({ update }));
  (getSupabaseAdmin as Mock).mockReturnValue({ from });
  (loadPriceMap as Mock).mockResolvedValue({});
  session();
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/scan', () => {
  it('401 without a session', async () => {
    session({ user: false });
    const res = await POST(req(jpegBlob()));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('unauthorized');
    expect(reserveCalls()).toHaveLength(0);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('403 when the gate refuses', async () => {
    vi.stubEnv('SCANNER_ALLOWLIST', 'someone-else');
    session({ superuser: false });
    const r = req(jpegBlob());
    const formData = vi.spyOn(r, 'formData');
    const res = await POST(r);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
    expect(formData).not.toHaveBeenCalled(); // body is never read before the gate admits
    expect(reserveCalls()).toHaveLength(0);
  });

  it('reserve happens before the body is decoded: a cap returns 429 with resetsAt and the recognizer is never called', async () => {
    const resetsAt = new Date(Date.now() + 5 * 60_000).toISOString();
    session({ reserve: { ok: false, cap: 'cap_user_10m', limit: 20, resets_at: resetsAt } });
    const res = await POST(req(new Blob(['not an image'], { type: 'image/jpeg' })));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'cap_user_10m', resetsAt, limit: 20 });
    expect(reserveCalls()).toEqual([['scan_reserve', { p_source: 'player' }]]);
    // A capped request with an undecodable body still got 429, not 415: reserve ran first.
    expect(recognize).not.toHaveBeenCalled();
    expect(loadPriceMap).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('a global cap is 503 with Retry-After', async () => {
    const resetsAt = new Date(Date.now() + 3600_000).toISOString();
    session({ reserve: { ok: false, cap: 'cap_global_spend', limit: 80, resets_at: resetsAt } });
    const res = await POST(req(jpegBlob()));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('cap_global_spend');
    const ra = Number(res.headers.get('Retry-After'));
    expect(ra).toBeGreaterThan(3500);
    expect(ra).toBeLessThanOrEqual(3600);
  });

  it('a reserve RPC error is 503 reserve_failed and nothing else runs', async () => {
    session({ reserveError: true });
    const res = await POST(req(jpegBlob()));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('reserve_failed');
    expect(recognize).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('a missing or non-file photo is 400 bad_request before reserve', async () => {
    for (const r of [req(), req('just a string')]) {
      const res = await POST(r);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('bad_request');
    }
    expect(reserveCalls()).toHaveLength(0);
  });

  it('oversized and undecodable: a 4 MB body is 413 before reserve; a text body after reserve is 415 undecodable and the row is finished failed', async () => {
    const big = await POST(req(new Blob([new Uint8Array(4 * 1024 * 1024)], { type: 'image/jpeg' })));
    expect(big.status).toBe(413);
    expect((await big.json()).code).toBe('too_large');
    expect(reserveCalls()).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();

    const text = await POST(req(new Blob(['hello, this is not a photo'], { type: 'text/plain' })));
    expect(text.status).toBe(415);
    expect((await text.json()).code).toBe('undecodable');
    expect(reserveCalls()).toHaveLength(1);
    expect(from).toHaveBeenCalledWith('scan_events');
    expect(patchWritten()).toMatchObject({ status: 'failed', attempts: 0 });
    expect(eq).toHaveBeenCalledWith('id', SCAN_ID);
    expect(recognize).not.toHaveBeenCalled();
  });

  it('arm is superuser only: a player sending arm and source=eval gets a player row with the default arm', async () => {
    (recognize as Mock).mockResolvedValue({ ok: true, output: { photoQuality: 'ok', cards: [] }, model: 'claude-sonnet-5-5', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.0001, latencyMs: 900, attempts: 1 });
    const res = await POST(req(jpegBlob(), { arm: JSON.stringify({ model: 'claude-opus-5-5', tier: 'low' }), source: 'eval' }));
    expect(res.status).toBe(200);
    expect(reserveCalls()).toEqual([['scan_reserve', { p_source: 'player' }]]);
    expect((recognize as Mock).mock.calls[0][1]).toEqual(DEFAULT_ARM);
    const body = await res.json();
    expect(body.usage).toEqual({ model: 'claude-sonnet-5-5', latencyMs: 900, attempts: 1 }); // no costUsd for a player
  });

  it('a superuser arm and source=eval pass through, and usage carries costUsd', async () => {
    session({ superuser: true });
    (recognize as Mock).mockResolvedValue({ ok: true, output: { photoQuality: 'ok', cards: [] }, model: 'claude-opus-5-5', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.0002, latencyMs: 700, attempts: 1 });
    const res = await POST(req(jpegBlob(), { arm: JSON.stringify({ model: 'claude-opus-5-5', tier: 'low', effort: 'high' }), source: 'eval' }));
    expect(res.status).toBe(200);
    expect(reserveCalls()).toEqual([['scan_reserve', { p_source: 'eval' }]]);
    expect((recognize as Mock).mock.calls[0][1]).toEqual({ ...DEFAULT_ARM, model: 'claude-opus-5-5', tier: 'low', effort: 'high' });
    expect((await res.json()).usage).toEqual({ model: 'claude-opus-5-5', latencyMs: 700, attempts: 1, costUsd: 0.0002 });
  });

  it('a superuser arm that is not valid is 400 before reserve', async () => {
    session({ superuser: true });
    const res = await POST(req(jpegBlob(), { arm: JSON.stringify({ model: 'gpt-4' }) }));
    expect(res.status).toBe(400);
    expect(reserveCalls()).toHaveLength(0);
  });

  it('finish on failure: recognizer upstream_rate_limit → 503 with Retry-After and the event row is failed with attempts and latency', async () => {
    (recognize as Mock).mockResolvedValue({ ok: false, code: 'upstream_rate_limit', retryAfterSeconds: 17, latencyMs: 1234, attempts: 1 });
    const res = await POST(req(jpegBlob()));
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('17');
    expect((await res.json()).code).toBe('upstream_rate_limit');
    expect(patchWritten()).toMatchObject({ status: 'failed', attempts: 1, latency_ms: 1234, model: 'claude-sonnet-5-5' });
    expect(eq).toHaveBeenCalledWith('id', SCAN_ID);
  });

  it('a billed failure stores its tokens and cost; recognizer_failed is 502', async () => {
    (recognize as Mock).mockResolvedValue({ ok: false, code: 'recognizer_failed', usage: { inputTokens: 3000, outputTokens: 16000 }, costUsd: 0.166, latencyMs: 20000, attempts: 2 });
    const res = await POST(req(jpegBlob()));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('recognizer_failed');
    expect(patchWritten()).toMatchObject({ status: 'failed', attempts: 2, latency_ms: 20000, input_tokens: 3000, output_tokens: 16000, cost_usd: 0.166 });
  });

  it('a recognizer that throws (no API key) is 502 recognizer_failed and the row is finished failed', async () => {
    (recognize as Mock).mockRejectedValue(new Error('SCANNER_ANTHROPIC_API_KEY is not set'));
    const res = await POST(req(jpegBlob()));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('recognizer_failed');
    expect(patchWritten()).toMatchObject({ status: 'failed' });
  });

  it('happy path: response shape matches the spec and detections are stored without candidates and capped', async () => {
    const priest = CARDS.find((c) => c.name === 'Captive Priest')!;
    (loadPriceMap as Mock).mockResolvedValue({ [cardKey(priest)]: 1.25 });
    const longTitle = 'Q'.repeat(200);
    (recognize as Mock).mockResolvedValue({
      ok: true,
      output: {
        photoQuality: 'ok',
        cards: [
          det({ title: 'Captive Priest', reference: 'Judges 18:27', printNumber: '98', grid: { row: 1, col: 1 } }),
          det({ title: longTitle, grid: { row: 1, col: 2 } }),
        ],
      },
      model: 'claude-sonnet-5-5', usage: { inputTokens: 4000, outputTokens: 800 }, costUsd: 0.016, latencyMs: 4200, attempts: 1,
    });
    // A finish write failure must not turn a good scan into a 500.
    eq.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(req(jpegBlob()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['detections', 'photoQuality', 'scanId', 'usage']);
    expect(body.scanId).toBe(SCAN_ID);
    expect(body.photoQuality).toBe('ok');
    expect(body.usage).toEqual({ model: 'claude-sonnet-5-5', latencyMs: 4200, attempts: 1 });
    expect(body.detections).toHaveLength(2);

    const [d0, d1] = body.detections;
    expect(Object.keys(d0).sort()).toEqual(['candidates', 'chosenKey', 'grid', 'id', 'nameReason', 'orientation', 'printingReason', 'read', 'scores', 'status']);
    expect(d0.id).toBe(`${SCAN_ID}:0`);
    expect(d1.id).toBe(`${SCAN_ID}:1`);
    expect(d0.grid).toEqual({ row: 1, col: 1 });
    expect(d0.orientation).toBe('upright');
    expect(d0.status).toBe('matched');
    expect(d0.nameReason).toBe('exact');
    expect(d0.chosenKey).toBe(cardKey(priest));
    expect(d0.read.title).toBe('Captive Priest');
    expect(d0.scores).toEqual(expect.objectContaining({ matchScore: expect.any(Number), runnerUpScore: expect.any(Number), agreeingFields: expect.any(Array) }));
    expect(d0.candidates[0]).toEqual(expect.objectContaining({ key: cardKey(priest), name: 'Captive Priest', price: 1.25 }));
    expect(Object.keys(d0.candidates[0]).sort()).toEqual(['imgFile', 'key', 'legality', 'name', 'officialSet', 'price', 'set']);
    expect(d1.status).toBe('not_found');
    expect(d1.chosenKey).toBeNull();
    expect(d1.read.title).toHaveLength(FIELD_CAPS.title);

    expect(recognize).toHaveBeenCalledTimes(1);
    const [sentJpeg, sentArm] = (recognize as Mock).mock.calls[0];
    expect(sentJpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(sentArm).toEqual(DEFAULT_ARM);

    expect(from).toHaveBeenCalledWith('scan_events');
    expect(eq).toHaveBeenCalledWith('id', SCAN_ID);
    const patch = patchWritten();
    expect(patch).toMatchObject({
      status: 'done', model: 'claude-sonnet-5-5', attempts: 1, latency_ms: 4200,
      input_tokens: 4000, output_tokens: 800, cost_usd: 0.016, photo_quality: 'ok',
    });
    expect(patch.detections).toHaveLength(2);
    for (const s of patch.detections) expect(s).not.toHaveProperty('candidates');
    expect(patch.detections[0]).toMatchObject({ id: `${SCAN_ID}:0`, status: 'matched', chosenKey: cardKey(priest) });
    expect(patch.detections[1].read.title).toHaveLength(FIELD_CAPS.title);
    expect(err).toHaveBeenCalled(); // the write failure was logged
    err.mockRestore();
  });
});
