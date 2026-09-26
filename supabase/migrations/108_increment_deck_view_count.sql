-- 108_increment_deck_view_count.sql
-- Fixes: every deck's view_count has been 0 forever. loadPublicDeckAction
-- bumped view_count through the VIEWER's RLS-scoped client, but the only
-- UPDATE policy on decks is "Users can update own decks" (001), so a
-- non-owner's write was rejected silently. The community "Most viewed" sort
-- has therefore never ordered anything.
--
-- A definer RPC lets any viewer record a view without granting UPDATE on the
-- row. It touches only view_count, and only on decks that are reachable by
-- link (public / unlisted, the same set 041's is_public mirror covers) — a
-- private deck's count cannot be probed or bumped from outside.

create or replace function public.increment_deck_view_count(p_deck_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.decks
     set view_count = coalesce(view_count, 0) + 1
   where id = p_deck_id
     and visibility in ('public', 'unlisted');
$$;

revoke all on function public.increment_deck_view_count(uuid) from public;
grant execute on function public.increment_deck_view_count(uuid) to anon, authenticated;
