#!/usr/bin/env npx tsx
/**
 * Concurrency check for public.scan_reserve() (migration 122): every cap holds
 * when two reserves race, eval rows count against nothing, and only the
 * service role can call it (anon and authenticated get a permission error).
 *
 * Usage (a Supabase project or branch, never production):
 *   npx tsx scripts/scan-eval/check-reserve.ts --url <supabase url> \
 *     --anon-key <key> --service-key <key>
 *   Creates two throwaway users (deleted at the end) and reserves as the service
 *   role with p_user, as /api/scan does. The anon key is only for the
 *   permission check (one of the throwaway users signs in).
 *
 * Usage (a bare PostgREST over a local Postgres with migration 122 applied):
 *   npx tsx scripts/scan-eval/check-reserve.ts --rest-url <PostgREST root> \
 *     --jwt-secret <secret> --user-id <uuid> --user2-id <uuid>
 *
 * Refuses the production project (dhxxsolhgvimxtusepht) unless
 * --i-know-this-is-prod: it seeds 1,499 rows and $79.99 of spend, which pauses
 * scanning for everyone while it runs. Deletes every scan_events row of both
 * users before each check and at the end. Prints a table; exits 1 on any failure.
 */

import { join } from 'path';
import { createHmac, randomBytes } from 'crypto';
import { parseArgs } from 'util';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { PostgrestClient } from '@supabase/postgrest-js';

// The slice of the client API this script uses; supabase-js and postgrest-js both fit it.
type Db = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
type Reserve = { ok: boolean; cap?: string; id?: string };

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    'anon-key': { type: 'string' },
    'service-key': { type: 'string' },
    'rest-url': { type: 'string' },
    'jwt-secret': { type: 'string' },
    'user-id': { type: 'string' },
    'user2-id': { type: 'string' },
    'i-know-this-is-prod': { type: 'boolean' },
  },
});

const PROD_REF = 'dhxxsolhgvimxtusepht';
for (const u of [args.url, args['rest-url']]) {
  if (u?.includes(PROD_REF) && !args['i-know-this-is-prod']) {
    console.error(`refusing ${u}: that is the production project. Pass --i-know-this-is-prod to run anyway.`);
    process.exit(2);
  }
}

function b64url(s: string | Buffer) {
  return Buffer.from(s).toString('base64url');
}

function mintJwt(secret: string, role: string, sub?: string) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({ role, sub, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }),
  );
  const sig = b64url(createHmac('sha256', secret).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

// service: reserves and seeds, as the route does. anon/authenticated: only for the permission check.
type Setup = { service: Db; anon: Db; authenticated: Db; uid: string; uid2: string; done: () => Promise<void> };

async function setup(): Promise<Setup> {
  if (args['rest-url']) {
    const secret = args['jwt-secret'];
    const uid = args['user-id'];
    const uid2 = args['user2-id'];
    if (!secret || !uid || !uid2) throw new Error('--rest-url needs --jwt-secret, --user-id and --user2-id');
    const rest = (jwt: string) =>
      new PostgrestClient(args['rest-url']!, { headers: { Authorization: `Bearer ${jwt}` } }) as unknown as Db;
    return {
      service: rest(mintJwt(secret, 'service_role')),
      anon: rest(mintJwt(secret, 'anon')),
      authenticated: rest(mintJwt(secret, 'authenticated', uid)),
      uid,
      uid2,
      done: async () => {},
    };
  }

  const { url, 'anon-key': anonKey, 'service-key': serviceKey } = args;
  if (!url || !anonKey || !serviceKey) {
    throw new Error('need --url --anon-key --service-key (or --rest-url mode)');
  }
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(url, serviceKey, opts);
  const anon = createClient(url, anonKey, opts);
  const authenticated = createClient(url, anonKey, opts);
  // Two throwaway users: the reserving user and the one the global cap is seeded on.
  const password = randomBytes(18).toString('base64url');
  const made: string[] = [];
  const done = async () => {
    for (const id of made) await service.auth.admin.deleteUser(id);
  };
  try {
    const emails = [1, 2].map((n) => `scan-check-${Date.now()}-${n}@example.invalid`);
    for (const email of emails) {
      const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new Error(`could not create ${email}: ${error?.message}`);
      made.push(data.user.id);
    }
    const { error: signInErr } = await authenticated.auth.signInWithPassword({ email: emails[0], password });
    if (signInErr) throw new Error(`sign-in failed: ${signInErr.message}`);
  } catch (e) {
    await done();
    throw e;
  }
  return {
    service: service as unknown as Db,
    anon: anon as unknown as Db,
    authenticated: authenticated as unknown as Db,
    uid: made[0],
    uid2: made[1],
    done,
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

async function main() {
  const { service, anon, authenticated, uid, uid2, done } = await setup();

  async function clean() {
    const { error } = await service.from('scan_events').delete().in('user_id', [uid, uid2]);
    if (error) throw new Error(`cleanup: ${error.message}`);
  }

  // n rows spread evenly between `fromAgo` and `toAgo` ms before now.
  async function seed(
    n: number,
    who: string,
    fromAgo: number,
    toAgo: number,
    extra: Record<string, unknown> = {},
  ) {
    const now = Date.now();
    const rows = Array.from({ length: n }, (_, i) => ({
      user_id: who,
      status: 'done',
      source: 'player',
      created_at: new Date(now - fromAgo - ((toAgo - fromAgo) * i) / Math.max(n - 1, 1)).toISOString(),
      ...extra,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await service.from('scan_events').insert(rows.slice(i, i + 500));
      if (error) throw new Error(`seed: ${error.message}`);
    }
  }

  async function reserve(): Promise<Reserve> {
    const { data, error } = await service.rpc('scan_reserve', { p_user: uid, p_source: 'player' });
    if (error) throw new Error(`scan_reserve: ${error.message}`);
    return data as Reserve;
  }

  const show = (r: Reserve) => (r.ok ? 'ok' : r.cap ?? 'refused');

  // Two reserves at once: exactly one ok and one refused with `cap`.
  async function race(cap: string) {
    const results = await Promise.all([reserve(), reserve()]);
    const pass = results.filter((r) => r.ok).length === 1 && results.filter((r) => r.cap === cap).length === 1;
    return { got: results.map(show).join(' + '), pass };
  }

  const checks: { name: string; seeded: string; expected: string; run: () => Promise<{ got: string; pass: boolean }> }[] = [
    {
      name: 'per user, 10 minutes (20)',
      seeded: '19 rows, last 10 min',
      expected: 'ok + cap_user_10m',
      run: async () => {
        await seed(19, uid, 1 * MIN, 8 * MIN);
        return race('cap_user_10m');
      },
    },
    {
      name: 'per user, 24 hours (150)',
      seeded: '149 rows, 1-20 h ago',
      expected: 'ok + cap_user_24h',
      run: async () => {
        await seed(149, uid, 1 * HOUR, 20 * HOUR);
        return race('cap_user_24h');
      },
    },
    {
      name: 'everyone, 30 days (1,500)',
      seeded: '1,499 rows (user 2), 2-25 d ago',
      expected: 'ok + cap_global_30d',
      run: async () => {
        await seed(1499, uid2, 2 * DAY, 25 * DAY);
        return race('cap_global_30d');
      },
    },
    {
      name: 'everyone, 30 days ($80)',
      seeded: '$79.99 then +$0.02 (user 2)',
      expected: 'ok, then cap_global_spend',
      run: async () => {
        await seed(1, uid2, 2 * DAY, 2 * DAY, { cost_usd: 79.99 });
        const under = await reserve();
        await seed(1, uid2, 2 * DAY, 2 * DAY, { cost_usd: 0.02 });
        const over = await reserve();
        return {
          got: `${show(under)}, then ${show(over)}`,
          pass: under.ok && over.cap === 'cap_global_spend',
        };
      },
    },
    {
      name: 'eval rows exempt',
      seeded: '50 eval rows ($2 each), last 10 min',
      expected: 'ok',
      run: async () => {
        await seed(50, uid, 1 * MIN, 8 * MIN, { source: 'eval', cost_usd: 2 });
        const r = await reserve();
        return { got: show(r), pass: r.ok };
      },
    },
    {
      name: 'only service_role can call it',
      seeded: 'none',
      expected: 'anon + authenticated refused, 0 rows',
      run: async () => {
        const refused = async (db: Db) => {
          const { error } = await db.rpc('scan_reserve', { p_user: uid, p_source: 'player' });
          return error && (error.code === '42501' || /permission denied/i.test(error.message)) ? 'refused' : `allowed (${error?.message ?? 'no error'})`;
        };
        const a = await refused(anon);
        const u = await refused(authenticated);
        const { count, error } = await service.from('scan_events').select('id', { count: 'exact', head: true }).eq('user_id', uid);
        if (error) throw new Error(`count: ${error.message}`);
        return {
          got: `anon ${a}, authenticated ${u}, ${count} rows`,
          pass: a === 'refused' && u === 'refused' && count === 0,
        };
      },
    },
  ];

  const rows: string[][] = [];
  let failed = false;
  try {
    for (const c of checks) {
      await clean();
      let got: string;
      let pass: boolean;
      try {
        ({ got, pass } = await c.run());
      } catch (e) {
        got = `error: ${(e as Error).message}`;
        pass = false;
      }
      failed ||= !pass;
      rows.push([pass ? 'PASS' : 'FAIL', c.name, c.seeded, c.expected, got]);
    }
  } finally {
    try {
      await clean();
    } finally {
      await done();
    }
  }

  const header = ['result', 'check', 'seeded', 'expected', 'got'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((v, i) => v.padEnd(widths[i])).join(' | ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  rows.forEach((r) => console.log(line(r)));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
