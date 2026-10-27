import Anthropic, { APIConnectionTimeoutError } from '@anthropic-ai/sdk';
import type { MessageCreateParamsNonStreaming, ThinkingConfigParam } from '@anthropic-ai/sdk/resources/messages/messages';
import { SCAN_INSTRUCTION, SCAN_JSON_SCHEMA, parseScanOutput, type ScanOutput } from '@/lib/scan/schema';
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

/** USD per million tokens. */
export const MODEL_PRICES: Record<Arm['model'] & string, { input: number; output: number }> = {
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

export type RecognizeResult =
  | { ok: true; output: ScanOutput; model: string; usage: { inputTokens: number; outputTokens: number }; costUsd: number; latencyMs: number; attempts: number }
  | { ok: false; code: 'upstream_rate_limit' | 'upstream_overloaded' | 'billing_error' | 'recognizer_failed'; retryAfterSeconds?: number; usage?: { inputTokens: number; outputTokens: number }; costUsd?: number; latencyMs: number; attempts: number };

type Create = (params: unknown) => Promise<unknown>;
interface Deps { create?: Create; sleep?: (ms: number) => Promise<void> }

const MAX_TOKENS = 16_000;
const MAX_TOKENS_RETRY = 32_000;
const RETRY_DELAY_MS = 2_000;

let defaultCreate: Create | null = null;
function getDefaultCreate(): Create {
  if (defaultCreate) return defaultCreate;
  const apiKey = process.env.SCANNER_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('SCANNER_ANTHROPIC_API_KEY is not set; the scanner cannot call Claude.');
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 25_000 });
  defaultCreate = (params) => client.messages.create(params as MessageCreateParamsNonStreaming);
  return defaultCreate;
}

function thinkingFor(arm: Required<Arm>): ThinkingConfigParam | undefined {
  if (arm.thinking !== 'off') return undefined;
  // 'between_tools' is not in the 0.78 SDK's ThinkingConfigParam union; the spec mandates it for Sonnet 5.5.
  if (arm.model === 'claude-sonnet-5-5') return { type: 'between_tools' } as unknown as ThinkingConfigParam;
  if (arm.model === 'claude-haiku-5-5') return { type: 'disabled' };
  return undefined; // Opus 5.5: thinking is always on.
}

function buildParams(jpeg: Buffer, arm: Required<Arm>, maxTokens: number): MessageCreateParamsNonStreaming {
  const thinking = thinkingFor(arm);
  return {
    model: arm.model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
          { type: 'text', text: SCAN_INSTRUCTION },
        ],
      },
    ],
    output_config: { effort: arm.effort, format: { type: 'json_schema', schema: SCAN_JSON_SCHEMA } },
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

interface ResponseShape { model?: unknown; stop_reason?: unknown; content?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } }

export async function recognize(jpeg: Buffer, arm: Required<Arm>, deps: Deps = {}): Promise<RecognizeResult> {
  const create = deps.create ?? getDefaultCreate();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = Date.now();
  const usage = { inputTokens: 0, outputTokens: 0 };
  let attempts = 0;
  let maxTokens = MAX_TOKENS;
  let billed = false; // a response with usage came back, so at least one attempt costs money
  const price = MODEL_PRICES[arm.model];
  const cost = () => (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
  const fail = (code: Extract<RecognizeResult, { ok: false }>['code'], retryAfterSeconds?: number): RecognizeResult => ({
    ok: false,
    code,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    // Billed failures carry their spend so the 30-day cost cap sees them.
    ...(billed ? { usage: { ...usage }, costUsd: cost() } : {}),
    latencyMs: Date.now() - started,
    attempts,
  });

  // At most two billed attempts: a max_tokens stop, a 5xx/529 or a timeout spends the single retry.
  while (true) {
    attempts++;
    const canRetry = attempts < 2;
    let res: ResponseShape;
    try {
      res = (await create(buildParams(jpeg, arm, maxTokens))) as ResponseShape;
    } catch (err) {
      const c = classify(err);
      if (c.kind === 'billing') return fail('billing_error');
      if (c.kind === 'rate_limit') return fail('upstream_rate_limit', c.retryAfterSeconds);
      if (c.kind === 'retryable' && canRetry) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      if (c.kind === 'retryable' && c.overloaded) return fail('upstream_overloaded');
      return fail('recognizer_failed');
    }

    const inT = res.usage?.input_tokens;
    const outT = res.usage?.output_tokens;
    if (typeof inT === 'number' || typeof outT === 'number') billed = true;
    usage.inputTokens += typeof inT === 'number' ? inT : 0;
    usage.outputTokens += typeof outT === 'number' ? outT : 0;

    if (typeof res.model !== 'string' || !res.model.startsWith(arm.model)) return fail('recognizer_failed');
    if (res.stop_reason === 'refusal') return fail('recognizer_failed');
    if (res.stop_reason === 'max_tokens') {
      if (!canRetry) return fail('recognizer_failed');
      maxTokens = MAX_TOKENS_RETRY;
      continue;
    }
    const blocks = Array.isArray(res.content) ? (res.content as { type?: unknown; text?: unknown }[]) : [];
    const text = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
    const output = parseScanOutput(text);
    if (!output) return fail('recognizer_failed');

    return { ok: true, output, model: res.model, usage: { ...usage }, costUsd: cost(), latencyMs: Date.now() - started, attempts };
  }
}
