-- 120_log_trade_rpc.sql
-- Logging a trade writes the trade_log row AND adjusts collection_cards
-- (received copies added, given copies removed, floored at 0). The app-side
-- version shipped with 119 did that as 2N+1 sequential round trips with no
-- transaction, so a failure part-way left the record saved and the
-- collection half-updated. This RPC does the whole thing in one transaction.
--
-- SECURITY INVOKER: it runs as the caller, so the RLS policies from 119
-- (trade_log: insert own) and 043 (collection_cards: own rows only) still
-- apply. The function can only ever touch the caller's rows.
--
-- p_cards is the trade_log.cards JSON array described in 119:
--   { direction: 'gave'|'received', cardName, cardSet, cardImgFile,
--     quantity, unitPrice }
-- The app validates and clamps it before calling (see
-- app/trades/actions.ts logTradeAction).

create or replace function public.log_trade(
  p_traded_on date,
  p_partner text,
  p_notes text,
  p_cards jsonb
) returns public.trade_log
language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_entry public.trade_log;
  v_delta record;
  v_current integer;
  v_next integer;
begin
  if v_user is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) = 0 then
    raise exception 'A trade needs at least one card';
  end if;

  insert into public.trade_log (user_id, traded_on, partner, notes, cards)
  values (
    v_user,
    coalesce(p_traded_on, current_date),
    coalesce(p_partner, ''),
    coalesce(p_notes, ''),
    p_cards
  )
  returning * into v_entry;

  -- Net change per printing: received minus given. Printings that net to
  -- zero are skipped.
  for v_delta in
    select c->>'cardName' as card_name,
           coalesce(c->>'cardSet', '') as card_set,
           coalesce(c->>'cardImgFile', '') as card_img_file,
           sum(case when c->>'direction' = 'received' then 1 else -1 end
               * (c->>'quantity')::integer) as delta
      from jsonb_array_elements(p_cards) c
     group by 1, 2, 3
    having sum(case when c->>'direction' = 'received' then 1 else -1 end
               * (c->>'quantity')::integer) <> 0
  loop
    select quantity into v_current
      from public.collection_cards
     where user_id = v_user
       and card_name = v_delta.card_name
       and card_set = v_delta.card_set
       and card_img_file = v_delta.card_img_file
       for update;
    if not found then
      v_current := 0;
    end if;

    -- Giving away more than is tracked floors at 0 (collections are often
    -- incomplete). collection_cards.quantity must be > 0, so 0 is a delete.
    v_next := greatest(0, v_current + v_delta.delta);
    if v_next = 0 then
      delete from public.collection_cards
       where user_id = v_user
         and card_name = v_delta.card_name
         and card_set = v_delta.card_set
         and card_img_file = v_delta.card_img_file;
    else
      insert into public.collection_cards (user_id, card_name, card_set, card_img_file, quantity)
      values (v_user, v_delta.card_name, v_delta.card_set, v_delta.card_img_file, v_next)
      on conflict (user_id, card_name, card_set, card_img_file)
      do update set quantity = excluded.quantity, updated_at = now();
    end if;
  end loop;

  return v_entry;
end;
$$;

-- Supabase grants execute to anon by default privilege; revoke it directly
-- (revoking from public alone leaves it).
revoke all on function public.log_trade(date, text, text, jsonb) from public, anon;
grant execute on function public.log_trade(date, text, text, jsonb) to authenticated;
