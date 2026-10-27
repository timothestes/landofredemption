-- Card scanner (docs/superpowers/specs/2026-10-26-card-scanner-design.md,
-- "Migration 122_scan_events.sql" and "Reserve first, then call").
--
-- scan_events: one row per photo. Written only by scan_reserve() (insert) and
-- the service-role admin client (finish). scan_commits: one row per committed
-- scan, idempotent on the client-generated commit_id.
--
-- scan_reserve() takes ONE constant-key advisory lock,
-- pg_advisory_xact_lock(hashtext('scan_reserve')), because the global caps
-- count every user's rows and a per-user key cannot serialize them. The lock
-- is transaction-scoped and the cap counts and the row insert are in the same
-- transaction (one plpgsql function call), so the inserted row is committed
-- before the next caller can take the lock and count it.

-- scan_commits first: scan_events references it.
create table if not exists public.scan_commits (
  commit_id  uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  deltas     jsonb not null,
  result     jsonb
);

create table if not exists public.scan_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  status           text not null check (status in ('pending','done','failed','rejected')),
  source           text not null default 'player' check (source in ('player','eval')),
  rejected_cap     text,
  model            text,
  attempts         smallint,
  latency_ms       integer,
  input_tokens     integer,
  output_tokens    integer,
  cost_usd         numeric(8,5),
  photo_quality    text,
  detections       jsonb,
  outcomes         jsonb,
  commit_id        uuid references public.scan_commits(commit_id),
  image_pathname   text,
  image_expires_at timestamptz
);

create index if not exists scan_events_user_created_idx on public.scan_events (user_id, created_at desc);
create index if not exists scan_events_created_idx on public.scan_events (created_at);
create index if not exists scan_commits_user_created_idx on public.scan_commits (user_id, created_at desc);

alter table public.scan_events enable row level security;
alter table public.scan_commits enable row level security;

drop policy if exists scan_events_select on public.scan_events;
create policy scan_events_select on public.scan_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_superuser());

drop policy if exists scan_commits_select on public.scan_commits;
create policy scan_commits_select on public.scan_commits
  for select to authenticated
  using (user_id = auth.uid() or public.is_superuser());

-- No write policies; also revoke the grants Supabase gives by default.
revoke insert, update, delete on public.scan_events from authenticated, anon;
revoke insert, update, delete on public.scan_commits from authenticated, anon;
revoke select on public.scan_events from anon;
revoke select on public.scan_commits from anon;

create or replace function public.scan_reserve(p_source text default 'player')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_user_10m   constant integer := 20;
  c_user_24h   constant integer := 150;
  c_global_30d constant integer := 1500;
  c_spend_30d  constant numeric := 80.00;

  v_uid    uuid := auth.uid();
  v_source text;
  v_now    timestamptz;
  v_count  integer;
  v_oldest timestamptz;
  v_spend  numeric;
  v_cap    text;
  v_limit  numeric;
  v_resets timestamptz;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- 'eval' only for a superuser; anyone else is a player.
  if p_source = 'eval' and public.is_superuser() then
    v_source := 'eval';
  else
    v_source := 'player';
  end if;

  -- One constant key: the global caps count every user's rows.
  perform pg_advisory_xact_lock(hashtext('scan_reserve'));

  -- Read the clock after the lock so windows reflect when we actually count.
  v_now := clock_timestamp();

  -- Eval rows are inserted but never checked against, or counted by, any cap.
  if v_source = 'player' then
    -- 1. per user, 10 minutes
    select count(*), min(created_at) into v_count, v_oldest
      from public.scan_events
     where status in ('pending','done','failed') and source = 'player'
       and user_id = v_uid and created_at > v_now - interval '10 minutes';
    if v_count >= c_user_10m then
      v_cap := 'cap_user_10m'; v_limit := c_user_10m;
      v_resets := v_oldest + interval '10 minutes';
    end if;

    -- 2. per user, 24 hours
    if v_cap is null then
      select count(*), min(created_at) into v_count, v_oldest
        from public.scan_events
       where status in ('pending','done','failed') and source = 'player'
         and user_id = v_uid and created_at > v_now - interval '24 hours';
      if v_count >= c_user_24h then
        v_cap := 'cap_user_24h'; v_limit := c_user_24h;
        v_resets := v_oldest + interval '24 hours';
      end if;
    end if;

    -- 3. everyone, 30 days, photos
    if v_cap is null then
      select count(*), min(created_at), coalesce(sum(cost_usd), 0)
        into v_count, v_oldest, v_spend
        from public.scan_events
       where status in ('pending','done','failed') and source = 'player'
         and created_at > v_now - interval '30 days';
      if v_count >= c_global_30d then
        v_cap := 'cap_global_30d'; v_limit := c_global_30d;
        v_resets := v_oldest + interval '30 days';
      -- 4. everyone, 30 days, summed cost (same window and rows as check 3)
      elsif v_spend >= c_spend_30d then
        v_cap := 'cap_global_spend'; v_limit := c_spend_30d;
        v_resets := v_oldest + interval '30 days';
      end if;
    end if;
  end if;

  if v_cap is not null then
    insert into public.scan_events (user_id, status, source, rejected_cap)
    values (v_uid, 'rejected', v_source, v_cap);
    return jsonb_build_object('ok', false, 'cap', v_cap, 'limit', v_limit, 'resets_at', v_resets);
  end if;

  insert into public.scan_events (user_id, status, source)
  values (v_uid, 'pending', v_source)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Supabase grants execute to anon by default privilege; revoke it directly
-- (revoking from public alone leaves it).
revoke all on function public.scan_reserve(text) from public, anon;
grant execute on function public.scan_reserve(text) to authenticated;
