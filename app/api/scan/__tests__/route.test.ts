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
// Pass-through spy, so deck mode can assert the AB pass is skipped.
vi.mock('@/lib/scan/abCompare', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/scan/abCompare')>();
  return { ...real, settleAbPairs: vi.fn((...a: Parameters<typeof real.settleAbPairs>) => real.settleAbPairs(...a)) };
});
// Pass-through spy over the real crop pass (which calls the mocked recognize); the crop itself is stubbed so sharp never sees it.
vi.mock('@/lib/scan/cropPass', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/scan/cropPass')>();
  return {
    ...real,
    runCropPass: vi.fn((...[jpeg, out, image, budgetMs, deps]: Parameters<typeof real.runCropPass>) =>
      real.runCropPass(jpeg, out, image, budgetMs, { ...deps, crop: async () => Buffer.alloc(1) })),
  };
});

import { POST, maxDuration } from '@/app/api/scan/route';
import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdmin } from '@/lib/pricing/supabase-admin';
import { recognize, DEFAULT_ARM, DECK_ARM, DECK_MODE } from '@/lib/scan/recognize';
import { settleAbPairs } from '@/lib/scan/abCompare';
import { runCropPass, type CropPassResult } from '@/lib/scan/cropPass';
import type { DeckGroup, DeckRead } from '@/lib/scan/deckSchema';
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

let rpc: Mock; // the user's client: is_superuser only
let adminRpc: Mock; // the service-role client: scan_reserve
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
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
  });
  adminRpc = vi.fn((fn: string) => {
    if (fn === 'scan_reserve') {
      return Promise.resolve(
        opts.reserveError ? { data: null, error: { message: 'boom' } } : { data: opts.reserve ?? { ok: true, id: SCAN_ID }, error: null },
      );
    }
    return Promise.resolve({ data: null, error: { message: `unexpected admin rpc ${fn}` } });
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
const reserveCalls = () => adminRpc.mock.calls.filter(([fn]) => fn === 'scan_reserve');
const patchWritten = () => update.mock.calls[0]?.[0];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('SCANNER_OPEN', '');
  vi.stubEnv('SCANNER_ALLOWLIST', 'u1');
  jpeg ??= await sharp({ create: { width: 64, height: 48, channels: 3, background: '#4a6' } }).jpeg().toBuffer();
  eq = vi.fn().mockResolvedValue({ data: null, error: null });
  update = vi.fn(() => ({ eq }));
  from = vi.fn(() => ({ update }));
  // A getter, so session() can swap adminRpc after this runs.
  (getSupabaseAdmin as Mock).mockImplementation(() => ({ from, rpc: (...a: unknown[]) => adminRpc(...a) }));
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
    expect(reserveCalls()).toEqual([['scan_reserve', { p_user: 'u1', p_source: 'player' }]]);
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
    expect(reserveCalls()).toEqual([['scan_reserve', { p_user: 'u1', p_source: 'player' }]]);
    expect((recognize as Mock).mock.calls[0][1]).toEqual(DEFAULT_ARM);
    const body = await res.json();
    expect(body.usage).toEqual({ model: 'claude-sonnet-5-5', latencyMs: 900, attempts: 1 }); // no costUsd for a player
  });

  it('a superuser arm and source=eval pass through, and usage carries costUsd', async () => {
    session({ superuser: true });
    (recognize as Mock).mockResolvedValue({ ok: true, output: { photoQuality: 'ok', cards: [] }, model: 'claude-opus-5-5', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.0002, latencyMs: 700, attempts: 1 });
    const res = await POST(req(jpegBlob(), { arm: JSON.stringify({ model: 'claude-opus-5-5', tier: 'low', effort: 'high' }), source: 'eval' }));
    expect(res.status).toBe(200);
    expect(reserveCalls()).toEqual([['scan_reserve', { p_user: 'u1', p_source: 'eval' }]]);
    expect((recognize as Mock).mock.calls[0][1]).toEqual({ ...DEFAULT_ARM, model: 'claude-opus-5-5', tier: 'low', effort: 'high' });
    expect((await res.json()).usage).toEqual({ model: 'claude-opus-5-5', latencyMs: 700, attempts: 1, costUsd: 0.0002 });
  });

  it('reserve goes through the service-role client with the gate-verified user, never the user client', async () => {
    (recognize as Mock).mockResolvedValue({ ok: true, output: { photoQuality: 'ok', cards: [] }, model: 'claude-sonnet-5-5', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.0001, latencyMs: 900, attempts: 1 });
    const res = await POST(req(jpegBlob()));
    expect(res.status).toBe(200);
    expect(reserveCalls()).toEqual([['scan_reserve', { p_user: 'u1', p_source: 'player' }]]);
    expect(rpc.mock.calls.filter(([fn]) => fn === 'scan_reserve')).toHaveLength(0);
  });

  it('a superuser arm override without source=eval still writes an eval row', async () => {
    session({ superuser: true });
    (recognize as Mock).mockResolvedValue({ ok: true, output: { photoQuality: 'ok', cards: [] }, model: 'claude-haiku-5-5', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.00001, latencyMs: 500, attempts: 1 });
    const res = await POST(req(jpegBlob(), { arm: JSON.stringify({ model: 'claude-haiku-5-5' }) }));
    expect(res.status).toBe(200);
    expect(reserveCalls()).toEqual([['scan_reserve', { p_user: 'u1', p_source: 'eval' }]]);
  });

  it('a superuser with no arm and no source=eval writes a player row', async () => {
    session({ superuser: true });
    (recognize as Mock).mockResolvedValue({ ok: true, output: { photoQuality: 'ok', cards: [] }, model: 'claude-sonnet-5-5', usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.0001, latencyMs: 900, attempts: 1 });
    await POST(req(jpegBlob()));
    expect(reserveCalls()).toEqual([['scan_reserve', { p_user: 'u1', p_source: 'player' }]]);
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

  it('every recognizer failure is logged with the scan id, code and detail', async () => {
    const detail = { status: 400, errorType: 'invalid_request_error', message: 'thinking.type: between_tools is not supported' };
    (recognize as Mock).mockResolvedValue({ ok: false, code: 'recognizer_failed', detail, latencyMs: 300, attempts: 1 });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(req(jpegBlob()));
    expect(res.status).toBe(502);
    expect(err).toHaveBeenCalledWith('[scan] recognizer failed', { scanId: SCAN_ID, code: 'recognizer_failed', detail });
    err.mockRestore();
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
    expect(Object.keys(body).sort()).toEqual(['detections', 'mode', 'photoQuality', 'scanId', 'usage']);
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

describe('POST /api/scan deck mode', () => {
  const read = (p: Partial<DeckRead>): DeckRead => ({
    title: null, strength: null, toughness: null, type: 'unknown', brigade: null, reference: null,
    group: 1, position: 1, titleBox: [0, 0, 10, 10], confidence: 'high', ...p,
  });
  const group: DeckGroup = { id: 1, orientation: 'upright', bbox: [0, 0, 0.5, 1], cardCount: 2 };
  const deckOk = (cards: DeckRead[], groups: DeckGroup[] = [group], over: Record<string, unknown> = {}) => ({
    ok: true, output: { photoQuality: 'ok', groups, cards }, model: 'claude-sonnet-5-5',
    usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.04, latencyMs: 10, attempts: 1, ...over,
  });
  const priestAndSoul = () => [
    read({ title: 'Captive Priest', reference: 'Judges 18:27', type: 'Hero' }),
    read({ title: 'Lost Soul', position: 2 }),
  ];
  const postDeck = (extra: Record<string, string> = {}) => POST(req(jpegBlob(), { mode: 'deck', ...extra }));

  it('calls recognize with DECK_MODE and DECK_ARM', async () => {
    (recognize as Mock).mockResolvedValue(deckOk(priestAndSoul()));
    await postDeck();
    expect((recognize as Mock).mock.calls[0][1]).toEqual(DECK_ARM);
    expect((recognize as Mock).mock.calls[0][3]).toBe(DECK_MODE);
  });

  it('returns groups and classified detections', async () => {
    (recognize as Mock).mockResolvedValue(deckOk(priestAndSoul()));
    const res = await postDeck();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('deck');
    expect(body.groups).toHaveLength(1);
    expect(body.detections.map((d: any) => d.kind)).toEqual(['matched', 'lost_soul']);
    expect(body.detections[0]).toMatchObject({ id: `${SCAN_ID}:0`, group: 1, position: 1 });
    expect(body.detections[0].deckKey).toMatch(/^Captive Priest/);
    expect(body.detections[1].deckKey).toBeNull();
  });

  it('caps detections at 300', async () => {
    (recognize as Mock).mockResolvedValue(deckOk(Array.from({ length: 320 }, (_, i) => read({ title: 'Captive Priest', position: i + 1 }))));
    const body = await (await postDeck()).json();
    expect(body.detections).toHaveLength(300);
  });

  it('skips the AB comparison', async () => {
    (recognize as Mock).mockResolvedValue(deckOk(priestAndSoul()));
    await postDeck();
    expect(settleAbPairs).not.toHaveBeenCalled();
  });

  it('too_many_cards is 422 and finishes failed with its cost', async () => {
    (recognize as Mock).mockResolvedValue({ ok: false, code: 'too_many_cards', usage: { inputTokens: 5, outputTokens: 16000 }, costUsd: 0.16, latencyMs: 30000, attempts: 1 });
    const res = await postDeck();
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ code: 'too_many_cards', message: 'Too many cards for one photo.' });
    expect(update.mock.calls.at(-1)![0]).toMatchObject({ status: 'failed', cost_usd: 0.16, mode: 'deck' });
  });

  it('finish writes mode deck', async () => {
    (recognize as Mock).mockResolvedValue(deckOk(priestAndSoul()));
    await postDeck();
    const patch = update.mock.calls.at(-1)![0];
    expect(patch.mode).toBe('deck');
    for (const s of patch.detections) expect(s).not.toHaveProperty('candidates');
  });

  it('a superuser arm override merges onto DECK_ARM', async () => {
    session({ superuser: true });
    (recognize as Mock).mockResolvedValue(deckOk(priestAndSoul()));
    await postDeck({ arm: JSON.stringify({ effort: 'low' }) });
    expect((recognize as Mock).mock.calls[0][1]).toEqual({ ...DECK_ARM, effort: 'low' });
  });

  it('an unknown mode is 400 before reserve', async () => {
    const res = await postDeck({ mode: 'binder' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'bad_request', message: 'mode must be collection or deck.' });
    expect(reserveCalls()).toHaveLength(0);
  });

  it('no mode field is collection mode', async () => {
    (recognize as Mock).mockResolvedValue({ ok: true, output: { photoQuality: 'ok', cards: [] }, model: 'claude-sonnet-5-5', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001, latencyMs: 10, attempts: 1 });
    const res = await POST(req(jpegBlob()));
    const body = await res.json();
    expect((recognize as Mock).mock.calls[0][1]).toEqual(DEFAULT_ARM);
    expect((recognize as Mock).mock.calls[0][3]).toBeUndefined();
    expect(body.mode).toBe('collection');
    expect('groups' in body).toBe(false);
    expect(update.mock.calls.at(-1)![0]).not.toHaveProperty('mode'); // column default; migration 124 may not be on prod
  });

  describe('crop pass', () => {
    // Group 1 is complete; group 2 has an unread title, so it gets a crop.
    const group2: DeckGroup = { id: 2, orientation: 'upright', bbox: [0.5, 0, 1, 1], cardCount: 2 };
    const firstPass = (over: Record<string, unknown> = {}) => deckOk([
      ...priestAndSoul(),
      read({ group: 2, title: 'Captive Priest', reference: 'Judges 18:27', type: 'Hero' }),
      read({ group: 2, position: 2, title: null }),
    ], [group, group2], over);
    // A crop reads as a single group 1, with title boxes in crop coordinates (the centre of the crop).
    const cropOk = () => deckOk([
      read({ title: 'Lost Soul', titleBox: [0.4, 0.2, 0.6, 0.3] }),
      read({ title: 'Captive Priest', reference: 'Judges 18:27', type: 'Hero', position: 2, titleBox: [0.4, 0.6, 0.6, 0.7] }),
    ], [{ id: 1, orientation: 'upright', bbox: [0, 0, 1, 1], cardCount: 2 }], {
      usage: { inputTokens: 100, outputTokens: 200 }, costUsd: 0.02, latencyMs: 7, attempts: 1,
    });
    const cropResult = async (): Promise<CropPassResult> => (runCropPass as Mock).mock.results[0].value;

    it('runs the crop pass on groups that need it and replaces their reads', async () => {
      (recognize as Mock).mockResolvedValueOnce(firstPass()).mockResolvedValueOnce(cropOk());
      const res = await postDeck();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(recognize).toHaveBeenCalledTimes(2);
      const g2 = body.detections.filter((d: any) => d.group === 2);
      expect(g2.map((d: any) => [d.read.title, d.position])).toEqual([['Lost Soul', 1], ['Captive Priest', 2]]);
      expect(body.detections.filter((d: any) => d.group === 1).map((d: any) => d.read.title)).toEqual(['Captive Priest', 'Lost Soul']);
      expect(body.crops).toEqual({ cropped: [2], failed: [], skipped: [] });
      expect(update.mock.calls.at(-1)![0].detections.filter((d: any) => d.group === 2).map((d: any) => d.read.title)).toEqual(['Lost Soul', 'Captive Priest']);
    });

    it('a complete upright photo makes no crop call', async () => {
      (recognize as Mock).mockResolvedValue(deckOk(priestAndSoul()));
      const body = await (await postDeck()).json();
      expect(recognize).toHaveBeenCalledTimes(1);
      expect(body.crops).toEqual({ cropped: [], failed: [], skipped: [] });
    });

    it('sums crop spend and calls into the event row and usage', async () => {
      session({ superuser: true });
      (recognize as Mock).mockResolvedValueOnce(firstPass()).mockResolvedValueOnce(cropOk());
      const body = await (await postDeck()).json();
      const cp = await cropResult();
      expect(cp.calls).toBe(1);
      const patch = update.mock.calls.at(-1)![0];
      expect(patch).toMatchObject({ status: 'done', input_tokens: 101, output_tokens: 201, attempts: 2, latency_ms: 10 + cp.latencyMs });
      expect(patch.cost_usd).toBeCloseTo(0.06);
      expect(body.usage.latencyMs).toBe(10 + cp.latencyMs);
      expect(body.usage.attempts).toBe(2);
      expect(body.usage.costUsd).toBeCloseTo(0.06);
    });

    it('a failed crop keeps the first-pass reads and the row is still done', async () => {
      (recognize as Mock).mockResolvedValueOnce(firstPass()).mockResolvedValueOnce({
        ok: false, code: 'recognizer_failed', attempts: 2, latencyMs: 5, usage: { inputTokens: 50, outputTokens: 60 }, costUsd: 0.01,
      });
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await postDeck();
      expect(res.status).toBe(200);
      const body = await res.json();
      const g2 = body.detections.filter((d: any) => d.group === 2);
      expect(g2.map((d: any) => d.read.title)).toEqual(['Captive Priest', null]);
      expect(body.crops).toEqual({ cropped: [], failed: [2], skipped: [] });
      const patch = update.mock.calls.at(-1)![0];
      expect(patch).toMatchObject({ status: 'done', input_tokens: 51, output_tokens: 61, attempts: 3 });
      expect(patch.cost_usd).toBeCloseTo(0.05);
      expect(err).toHaveBeenCalledWith('[scan] crop failed', expect.objectContaining({ scanId: SCAN_ID, group: 2, code: 'recognizer_failed' }));
      err.mockRestore();
    });

    it('a crop with only neighbour reads keeps the first-pass reads and logs empty_crop', async () => {
      // Group 2's crop rect is x 29-64 of 64 px; a box at the crop's left edge centres near x 0.46, left of the group.
      (recognize as Mock).mockResolvedValueOnce(firstPass()).mockResolvedValueOnce(deckOk([
        read({ title: 'Neighbour', titleBox: [0, 0.4, 0.01, 0.5] }),
      ], [{ id: 1, orientation: 'upright', bbox: [0, 0, 1, 1], cardCount: 1 }]));
      const err = vi.spyOn(console, 'error').mockImplementation(() => {});
      const body = await (await postDeck()).json();
      expect(body.detections.filter((d: any) => d.group === 2).map((d: any) => d.read.title)).toEqual(['Captive Priest', null]);
      expect(body.crops).toEqual({ cropped: [], failed: [2], skipped: [] });
      expect(err).toHaveBeenCalledWith('[scan] crop failed', expect.objectContaining({ scanId: SCAN_ID, group: 2, code: 'empty_crop' }));
      err.mockRestore();
    });

    it('passes a deadline 140 s after the request started', async () => {
      const requestStart = 1_700_000_000_000;
      const now = vi.spyOn(Date, 'now').mockReturnValue(requestStart);
      try {
        (recognize as Mock).mockResolvedValue(deckOk(priestAndSoul(), [group], { latencyMs: 100_000 }));
        await postDeck();
        expect((runCropPass as Mock).mock.calls[0][3]).toBe(requestStart + 140_000);
        expect((runCropPass as Mock).mock.calls[0][2]).toEqual({ width: 64, height: 48 });
      } finally {
        now.mockRestore();
      }
    });

    it('collection mode never runs the crop pass', async () => {
      (recognize as Mock).mockResolvedValue({ ok: true, output: { photoQuality: 'ok', cards: [] }, model: 'claude-sonnet-5-5', usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.001, latencyMs: 10, attempts: 1 });
      const body = await (await POST(req(jpegBlob()))).json();
      expect(runCropPass).not.toHaveBeenCalled();
      expect('crops' in body).toBe(false);
    });

    it('maxDuration is 150', () => expect(maxDuration).toBe(150));
  });
});
