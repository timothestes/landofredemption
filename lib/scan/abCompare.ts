import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import { getDefaultCreate, MODEL_PRICES, type Arm, type Create, type FailureDetail } from '@/lib/scan/recognize';
import type { MatchResult } from '@/lib/scan/match';
import type { ScanDetection } from '@/lib/scan/schema';

// The second Claude call: for each card the matcher left as a card and its AB
// twin, show the photo beside both catalog images and ask which one it is.
// Asking "is this an alternate border?" without references was tried and
// rejected (spec, second pass); a choice between two pictures is the task here.
// Best effort: any failure leaves the matcher's result as it was. Server only.

export type AbPick = 'original' | 'ab';

/** Pairs per call; the rest keep the matcher's rule. 40 references plus the photo stays far under the image limit. */
export const MAX_AB_PAIRS = 20;
const MAX_TOKENS = 4_000;

export const AB_INSTRUCTION = `The first image is a photograph of Redemption CCG trading cards. Below it, each numbered card in the photo comes with two catalog images, A and B. A and B are two printings of that card: same title and text, but a different look. Usually the frame differs (the color and texture of the border around the art and the text box, or the art running to the card edges behind a see-through text box); sometimes the artwork itself differs.

For each numbered card, find it in the photo by its grid position and title, then say whether it is printing A or printing B. Compare the frame color, frame texture, whether the art runs to the edge, and the artwork. Ignore lighting, color cast, glare, sleeves and camera angle: they change both printings alike. Answer "unsure" only when that part of the card is hidden or too blurry to tell.

For each card, first describe in a few words the frame and art of the card in the photo (photoLook), of A (aLook) and of B (bLook), then give match.`;

const AB_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        // The three looks come first so the pick is made after looking at each image, not before.
        properties: {
          card: { type: 'integer' },
          photoLook: { type: 'string' },
          aLook: { type: 'string' },
          bLook: { type: 'string' },
          match: { type: 'string', enum: ['A', 'B', 'unsure'] },
        },
        required: ['card', 'photoLook', 'aLook', 'bLook', 'match'],
      },
    },
  },
  required: ['answers'],
};

interface Query { index: number; read: ScanDetection; pair: NonNullable<MatchResult['abPair']> }

/** Even queries show the original as A, odd ones as B, so a position bias cannot favor one printing. */
const originalIsA = (q: number) => q % 2 === 0;

function buildParams(jpeg: Buffer, queries: Query[], arm: Required<Arm>): MessageCreateParamsNonStreaming {
  const content: Exclude<MessageCreateParamsNonStreaming['messages'][number]['content'], string> = [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
  ];
  queries.forEach((q, n) => {
    const [a, b] = originalIsA(n) ? [q.pair.original, q.pair.ab] : [q.pair.ab, q.pair.original];
    const title = q.read.title ? `, titled "${q.read.title}"` : '';
    content.push(
      { type: 'text', text: `Card ${n + 1}: row ${q.read.grid.row}, column ${q.read.grid.col}${title}. A:` },
      { type: 'image', source: { type: 'url', url: getCardImageUrl(a.imgFile) } },
      { type: 'text', text: 'B:' },
      { type: 'image', source: { type: 'url', url: getCardImageUrl(b.imgFile) } },
    );
  });
  content.push({ type: 'text', text: AB_INSTRUCTION });
  return {
    model: arm.model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content }],
    output_config: { effort: arm.effort, format: { type: 'json_schema', schema: AB_JSON_SCHEMA } },
  };
}

/** The pick per query, null where unsure, missing or malformed. */
function parsePicks(text: string, count: number): (AbPick | null)[] {
  const picks: (AbPick | null)[] = new Array(count).fill(null);
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return picks;
  }
  const answers = (v as { answers?: unknown })?.answers;
  if (!Array.isArray(answers)) return picks;
  for (const a of answers as { card?: unknown; match?: unknown }[]) {
    const n = typeof a?.card === 'number' ? a.card - 1 : -1;
    if (!Number.isInteger(n) || n < 0 || n >= count || (a.match !== 'A' && a.match !== 'B')) continue;
    picks[n] = (a.match === 'A') === originalIsA(n) ? 'original' : 'ab';
  }
  return picks;
}

export interface AbSettleResult {
  matches: MatchResult[];
  /** Pairs asked about; zero means no call was made. */
  asked: number;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  latencyMs: number;
  detail?: FailureDetail;
}

/**
 * Asks about every match carrying an `abPair` (up to MAX_AB_PAIRS) in one call
 * and books each decided pick as Matched with printingReason 'frame'.
 */
export async function settleAbPairs(
  jpeg: Buffer, reads: ScanDetection[], matches: MatchResult[], arm: Required<Arm>, deps: { create?: Create } = {},
): Promise<AbSettleResult> {
  const queries: Query[] = matches
    .flatMap((m, index) => (m.abPair ? [{ index, read: reads[index], pair: m.abPair }] : []))
    .slice(0, MAX_AB_PAIRS);
  const none = { matches, asked: 0, usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, latencyMs: 0 };
  if (!queries.length) return none;

  const started = Date.now();
  const usage = { inputTokens: 0, outputTokens: 0 };
  const price = MODEL_PRICES[arm.model];
  const done = (out: MatchResult[], detail?: FailureDetail): AbSettleResult => ({
    matches: out, asked: queries.length, usage,
    costUsd: (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000,
    latencyMs: Date.now() - started,
    ...(detail ? { detail } : {}),
  });

  let res: { model?: unknown; stop_reason?: unknown; content?: unknown; usage?: { input_tokens?: unknown; output_tokens?: unknown } };
  try {
    res = (await (deps.create ?? getDefaultCreate())(buildParams(jpeg, queries, arm))) as typeof res;
  } catch (err) {
    const e = (err ?? {}) as { status?: unknown; message?: unknown };
    return done(matches, {
      ...(typeof e.status === 'number' ? { status: e.status } : {}),
      ...(typeof e.message === 'string' ? { message: e.message.slice(0, 300) } : {}),
    });
  }
  if (typeof res.usage?.input_tokens === 'number') usage.inputTokens = res.usage.input_tokens;
  if (typeof res.usage?.output_tokens === 'number') usage.outputTokens = res.usage.output_tokens;
  if (res.stop_reason !== 'end_turn') return done(matches, { stopReason: String(res.stop_reason) });

  const blocks = Array.isArray(res.content) ? (res.content as { type?: unknown; text?: unknown }[]) : [];
  const text = blocks.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
  const picks = parsePicks(text, queries.length);

  const out = [...matches];
  queries.forEach((q, n) => {
    const pick = picks[n];
    if (!pick) return;
    out[q.index] = { ...matches[q.index], status: 'matched', printingReason: 'frame', chosen: pick === 'ab' ? q.pair.ab : q.pair.original };
  });
  return done(out);
}
