import Anthropic, { APIConnectionError, APIConnectionTimeoutError } from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming, ThinkingConfigParam } from '@anthropic-ai/sdk/resources/messages/messages';
import { SCAN_INSTRUCTION, SCAN_JSON_SCHEMA, parseScanOutput, type ScanOutput } from '@/lib/scan/schema';
import { DECK_INSTRUCTION, DECK_JSON_SCHEMA, parseDeckOutput, type DeckOutput } from '@/lib/scan/deckSchema';
import type { Tier } from '@/lib/scan/image';

// The one Claude call that transcribes the cards in a photo. Server only.
// Never reads SCANNER_ANTHROPIC_API_KEY at import: the default client is built on first use.

export interface Arm {
  model?: 'claude-sonnet-5-5' | 'claude-opus-5-5' | 'claude-haiku-5-5';
  effort?: 'low' | 'medium' | 'high';
  tier?: Tier;
  thinking?: 'default' | 'off';
}
export const DEFAULT_ARM: Required<Arm> = { model: 'claude-sonnet-5-5', effort: 'low', tier: 'high', thinking: 'default' };

// Effort high, not medium: at medium Sonnet 5.5 does no thinking on a deck photo and, on dark 1024 px photos, often
// ends the cards list after the Lost Souls and the fully visible cards (2026-10-29 debug: 15 of 20 medium runs across five wordings, 0 of 8 at high).
export const DECK_ARM: Required<Arm> = { model: 'claude-sonnet-5-5', effort: 'high', tier: 'high', thinking: 'default' };

/** USD per million tokens. */
export const MODEL_PRICES: Record<Arm['model'] & string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

/** Why a call failed, for the server log. Never carries request content or the image. */
export interface FailureDetail { status?: number; errorType?: string; message?: string; stopReason?: string; model?: string }

/** What one recognizer call asks for and how it is timed and retried. */
export interface RecognizeMode<T> {
  name: 'collection' | 'deck';
  instruction: string;
  schema: Record<string, unknown>;
  parse: (text: string) => T | null;
  timeoutMs?: number;
  retryLongOutput: boolean;
  retryWithinMs: number;
}
export const COLLECTION_MODE: RecognizeMode<ScanOutput> = { name: 'collection', instruction: SCAN_INSTRUCTION, schema: SCAN_JSON_SCHEMA, parse: parseScanOutput, retryLongOutput: true, retryWithinMs: Infinity };
export const DECK_MODE: RecognizeMode<DeckOutput> = { name: 'deck', instruction: DECK_INSTRUCTION, schema: DECK_JSON_SCHEMA, parse: parseDeckOutput, timeoutMs: 80_000, retryLongOutput: false, retryWithinMs: 10_000 };

export type RecognizeResult<T = ScanOutput> =
  | { ok: true; output: T; model: string; usage: { inputTokens: number; outputTokens: number }; costUsd: number; latencyMs: number; attempts: number }
  | { ok: false; code: 'upstream_rate_limit' | 'upstream_overloaded' | 'billing_error' | 'recognizer_failed' | 'too_many_cards'; retryAfterSeconds?: number; detail?: FailureDetail; usage?: { inputTokens: number; outputTokens: number }; costUsd?: number; latencyMs: number; attempts: number };

export type Create = (params: unknown, options?: { timeout?: number }) => Promise<unknown>;
interface Deps { create?: Create; sleep?: (ms: number) => Promise<void>; now?: () => number }

const MAX_TOKENS = 16_000;
const MAX_TOKENS_RETRY = 32_000;
const RETRY_DELAY_MS = 2_000;

let defaultCreate: Create | null = null;
export function getDefaultCreate(): Create {
  if (defaultCreate) return defaultCreate;
  const apiKey = process.env.SCANNER_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('SCANNER_ANTHROPIC_API_KEY is not set; the scanner cannot call Claude.');
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 25_000 });
  defaultCreate = (params, options) => client.messages.create(params as MessageCreateParamsNonStreaming, options);
  return defaultCreate;
}

function thinkingFor(arm: Required<Arm>): ThinkingConfigParam | undefined {
  if (arm.thinking !== 'off') return undefined;
  // 'between_tools' is not in the 0.78 SDK's ThinkingConfigParam union; the spec mandates it for Sonnet 5.5.
  if (arm.model === 'claude-sonnet-5-5') return { type: 'between_tools' } as unknown as ThinkingConfigParam;
  if (arm.model === 'claude-haiku-5-5') return { type: 'disabled' };
  return undefined; // Opus 5.5: thinking is always on.
}

function buildParams(jpeg: Buffer, arm: Required<Arm>, maxTokens: number, mode: RecognizeMode<unknown>): MessageCreateParamsNonStreaming {
  const thinking = thinkingFor(arm);
  return {
    model: arm.model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
          { type: 'text', text: mode.instruction },
        ],
      },
    ],
    output_config: { effort: arm.effort, format: { type: 'json_schema', schema: mode.schema } },
    ...(thinking ? { thinking } : {}),
  };
}

function header(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as { get?: (n: string) => string | null } & Record<string, unknown>;
  if (typeof h.get === 'function') return h.get(name);
  const v = h[name] ?? h[name.toLowerCase()];
  return typeof v === 'string' ? v : null;
}

type Classified = { kind: 'retryable'; overloaded: boolean } | { kind: 'rate_limit'; retryAfterSeconds?: number } | { kind: 'billing' } | { kind: 'fatal' };

function classify(err: unknown): Classified {
  if (err instanceof APIConnectionTimeoutError) return { kind: 'retryable', overloaded: false };
  if (err instanceof APIConnectionError) return { kind: 'retryable', overloaded: false };
  const e = (err ?? {}) as { status?: unknown; headers?: unknown; error?: { error?: { type?: unknown; message?: unknown } }; message?: unknown };
  const status = typeof e.status === 'number' ? e.status : undefined;
  const bodyType = e.error?.error?.type;
  const text = `${typeof e.message === 'string' ? e.message : ''} ${typeof e.error?.error?.message === 'string' ? e.error.error.message : ''}`;
  if (status === 402 || bodyType === 'billing_error' || /credit balance|billing/i.test(text)) return { kind: 'billing' };
  if (status === 429) {
    const n = Number.parseInt(header(e.headers, 'retry-after') ?? '', 10);
    return { kind: 'rate_limit', ...(Number.isFinite(n) && n >= 0 ? { retryAfterSeconds: n } : {}) };
  }
  if (status === 529 || bodyType === 'overloaded_error') return { kind: 'retryable', overloaded: true };
  if (status !== undefined && status >= 500) return { kind: 'retryable', overloaded: false };
  return { kind: 'fatal' };
}

const DETAIL_MESSAGE_MAX = 300;

/** The status, error type and API message of a thrown error; the message is truncated. */
function errorDetail(err: unknown): FailureDetail {
  const e = (err ?? {}) as { status?: unknown; name?: unknown; error?: { error?: { type?: unknown; message?: unknown } }; message?: unknown };
  const bodyType = e.error?.error?.type;
  const apiMessage = e.error?.error?.message;
  const message = typeof apiMessage === 'string' ? apiMessage : typeof e.message === 'string' ? e.message : undefined;
  const errorType = typeof bodyType === 'string' ? bodyType : typeof e.name === 'string' ? e.name : undefined;
  return {
    ...(typeof e.status === 'number' ? { status: e.status } : {}),
    ...(errorType ? { errorType } : {}),
    ...(message ? { message: message.slice(0, DETAIL_MESSAGE_MAX) } : {}),
  };
}

/** What a response that came back but could not be used said about itself. */
function responseDetail(res: { model?: unknown; stop_reason?: unknown }, message?: string): FailureDetail {
  return {
    ...(typeof res.stop_reason === 'string' ? { stopReason: res.stop_reason } : {}),
    ...(typeof res.model === 'string' ? { model: res.model.slice(0, 100) } : {}),
    ...(message ? { message } : {}),
  };
}

interface ResponseShape { model?: unknown; stop_reason?: unknown; content?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } }

export async function recognize<T = ScanOutput>(jpeg: Buffer, arm: Required<Arm>, deps: Deps = {}, mode: RecognizeMode<T> = COLLECTION_MODE as unknown as RecognizeMode<T>): Promise<RecognizeResult<T>> {
  const create = deps.create ?? getDefaultCreate();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const started = now();
  const usage = { inputTokens: 0, outputTokens: 0 };
  let attempts = 0;
  let maxTokens = MAX_TOKENS;
  let billed = false; // a response with usage came back, so at least one attempt costs money
  const price = MODEL_PRICES[arm.model];
  const cost = () => (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  const fail = (code: Extract<RecognizeResult<T>, { ok: false }>['code'], detail: FailureDetail, retryAfterSeconds?: number): RecognizeResult<T> => ({
    ok: false,
    code,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    detail,
    // Billed failures carry their spend so the 30-day cost cap sees them.
    ...(billed ? { usage: { ...usage }, costUsd: cost() } : {}),
    latencyMs: now() - started,
    attempts,
  });

  // At most two billed attempts: a max_tokens stop, a 5xx/529 or a timeout spends the single retry.
  while (true) {
    attempts++;
    const canRetry = attempts < 2;
    let res: ResponseShape;
    try {
      res = (await create(buildParams(jpeg, arm, maxTokens, mode), mode.timeoutMs !== undefined ? { timeout: mode.timeoutMs } : undefined)) as ResponseShape;
    } catch (err) {
      const c = classify(err);
      const detail = errorDetail(err);
      if (c.kind === 'billing') return fail('billing_error', detail);
      if (c.kind === 'rate_limit') return fail('upstream_rate_limit', detail, c.retryAfterSeconds);
      if (c.kind === 'retryable' && canRetry && now() - started < mode.retryWithinMs) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      if (c.kind === 'retryable' && c.overloaded) return fail('upstream_overloaded', detail);
      return fail('recognizer_failed', detail);
    }

    const inT = res.usage?.input_tokens;
    const outT = res.usage?.output_tokens;
    if (typeof inT === 'number' || typeof outT === 'number') billed = true;
    usage.inputTokens += typeof inT === 'number' ? inT : 0;
    usage.outputTokens += typeof outT === 'number' ? outT : 0;

    if (typeof res.model !== 'string' || !res.model.startsWith(arm.model)) {
      return fail('recognizer_failed', responseDetail(res, `model mismatch: asked for ${arm.model}`));
    }
    if (res.stop_reason === 'refusal') return fail('recognizer_failed', responseDetail(res, 'refusal'));
    if (res.stop_reason === 'max_tokens') {
      if (!mode.retryLongOutput) return fail('too_many_cards', responseDetail(res, 'max_tokens'));
      if (!canRetry) return fail('recognizer_failed', responseDetail(res, 'max_tokens on the retry'));
      maxTokens = MAX_TOKENS_RETRY;
      continue;
    }
    const blocks = Array.isArray(res.content) ? (res.content as { type?: unknown; text?: unknown }[]) : [];
    const text = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
    const output = mode.parse(text);
    if (!output) return fail('recognizer_failed', responseDetail(res, 'unparseable output'));

    return { ok: true, output, model: res.model, usage: { ...usage }, costUsd: cost(), latencyMs: now() - started, attempts };
  }
}
