/**
 * E0 runner: posts eval photos to the deployed POST /api/scan with a
 * superuser session cookie and an `arm` override; one JSON per photo.
 *
 *   npx tsx scripts/scan-eval/run.ts --base-url https://<preview>.vercel.app \
 *     --cookie "$(cat .scan-session)" --photos scripts/scan-eval/photos \
 *     --arm '{"model":"claude-sonnet-5-5","effort":"low","tier":"high"}' \
 *     --out scripts/scan-eval/outputs/sonnet55-low-high [--concurrency 2] [--only <glob>]
 *
 * Deck photos (no --arm: the route's DECK_ARM applies; score with deckScore.ts):
 *   npx tsx scripts/scan-eval/run.ts --base-url https://<preview>.vercel.app \
 *     --cookie "$(cat .scan-session)" --mode deck --photos scripts/scan-eval/photos-deck \
 *     --out scripts/scan-eval/outputs/deck-default
 */
import fs from 'node:fs';
import path from 'node:path';

export interface RunOptions {
  baseUrl: string;
  cookie: string;
  photos: string;
  arm: Record<string, unknown> & { model?: string };
  out: string;
  concurrency: number;
  only: string | null;
  source: string;
  mode: 'collection' | 'deck';
}

export interface RunRecord {
  file: string;
  status: number;
  latencyMs: number;
  attempts: number;
  error?: string;
  [k: string]: unknown;
}

const MAX_ATTEMPTS = 5;

export function parseArgs(argv: string[]): RunOptions {
  const f: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${a}`);
    f[a.slice(2)] = v;
  }
  if (!f['base-url']) throw new Error('--base-url is required');
  if (!f.cookie) throw new Error('--cookie is required');
  const mode = f.mode ?? 'collection';
  if (mode !== 'collection' && mode !== 'deck') throw new Error('--mode must be collection or deck');
  let arm: RunOptions['arm'] = {};
  if (f.arm) {
    try {
      arm = JSON.parse(f.arm);
    } catch {
      throw new Error('--arm must be valid JSON');
    }
    if (!arm || typeof arm !== 'object' || Array.isArray(arm)) throw new Error('--arm must be a JSON object');
  }
  const concurrency = f.concurrency ? Number(f.concurrency) : 2;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('--concurrency must be a positive integer');
  return {
    baseUrl: f['base-url'].replace(/\/+$/, ''),
    cookie: f.cookie,
    photos: f.photos ?? 'scripts/scan-eval/photos',
    arm,
    out: f.out ?? 'scripts/scan-eval/outputs/run',
    concurrency,
    only: f.only ?? null,
    source: 'eval',
    mode,
  };
}

/** Minimal glob: `*` any run, `?` any one char; everything else literal. */
export function globToRegExp(glob: string): RegExp {
  const body = glob
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`);
}

export function recordFor(
  file: string,
  res: { status: number; headers: Headers; json: unknown },
  latencyMs: number,
  attempts: number,
): RunRecord {
  const base = { file, status: res.status, latencyMs, attempts };
  if (res.status === 200 && res.json && typeof res.json === 'object') {
    return { ...(res.json as Record<string, unknown>), ...base };
  }
  const code = (res.json as { code?: unknown } | null)?.code;
  const body = res.json && typeof res.json === 'object' ? (res.json as Record<string, unknown>) : {};
  return { ...body, ...base, error: typeof code === 'string' && code ? code : `http_${res.status}` };
}

const MAX_SLEEP_MS = 120_000;

/** Retry-After as delta-seconds or HTTP-date, in ms; default 5 s, capped at 120 s. */
export function parseRetryAfter(h: string | null, now: number = Date.now()): number {
  let ms = 5000;
  if (h && /^\s*\d+(\.\d+)?\s*$/.test(h)) ms = Number(h) * 1000;
  else if (h) {
    const t = Date.parse(h);
    if (Number.isFinite(t)) ms = Math.max(0, t - now);
  }
  return Math.min(ms, MAX_SLEEP_MS);
}

/** status 0 = network/read failure. Billing and global caps will not clear in minutes. */
export function isRetryable(status: number, json: unknown): boolean {
  if (status === 0) return true;
  if (status !== 429 && status !== 503) return false;
  const code = (json as { code?: unknown } | null)?.code;
  return !(typeof code === 'string' && (code === 'billing_error' || code.startsWith('cap_global_')));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postOnce(o: RunOptions, file: string) {
  const t0 = Date.now();
  try {
    return await postRaw(o, file);
  } catch (err) {
    return { status: 0, headers: new Headers(), json: { code: 'network_error', message: String(err) } as unknown, latencyMs: Date.now() - t0 };
  }
}

async function postRaw(o: RunOptions, file: string) {
  const buf = fs.readFileSync(path.join(o.photos, file));
  const form = new FormData();
  form.append('photo', new Blob([buf], { type: 'image/jpeg' }), file);
  if (o.mode === 'deck') form.append('mode', 'deck');
  if (o.mode === 'collection' || Object.keys(o.arm).length) form.append('arm', JSON.stringify(o.arm));
  form.append('source', o.source);
  const t0 = Date.now();
  const r = await fetch(`${o.baseUrl}/api/scan`, { method: 'POST', headers: { Cookie: o.cookie }, body: form });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body (e.g. Vercel text/plain 413) */
  }
  return { status: r.status, headers: r.headers, json, latencyMs: Date.now() - t0 };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  fs.mkdirSync(o.out, { recursive: true });
  const re = o.only ? globToRegExp(o.only) : null;
  const files = fs
    .readdirSync(o.photos)
    .filter((f) => /\.(jpe?g|png|webp|heic)$/i.test(f) && (!re || re.test(f)))
    .sort();
  const todo = files.filter((f) => !fs.existsSync(path.join(o.out, `${f}.json`)));
  console.log(`${files.length} photos, ${files.length - todo.length} already done, ${todo.length} to run`);

  let cost = 0;
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      let attempts = 0;
      let res = await postOnce(o, file);
      attempts++;
      while (isRetryable(res.status, res.json) && attempts < MAX_ATTEMPTS) {
        await sleep(res.status === 0 ? 2000 : parseRetryAfter(res.headers.get('retry-after')));
        res = await postOnce(o, file);
        attempts++;
      }
      const rec = recordFor(file, res, res.latencyMs, attempts);
      if (rec.error) {
        fs.appendFileSync(path.join(o.out, 'errors.jsonl'), JSON.stringify({ file, status: res.status, body: res.status === 0 ? String((res.json as { message?: unknown }).message) : res.json }) + '\n');
      } else {
        fs.writeFileSync(path.join(o.out, `${file}.json`), JSON.stringify(rec, null, 2));
        const c = (rec.usage as { costUsd?: unknown } | undefined)?.costUsd;
        if (typeof c === 'number') cost += c;
      }
      done++;
      console.log(`[${done}/${todo.length}] ${file} ${res.status}${rec.error ? ' ' + rec.error : ''} ${res.latencyMs}ms  cost $${cost.toFixed(4)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency, todo.length) }, worker));
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
