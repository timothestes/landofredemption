-- 126_forge_save_card_fields.sql
-- Field-level saves of a card's working draft.
--
-- forge_save_card writes the whole snapshot, so one elder's autosave silently reverted
-- another's saved edit in a different field, and an import overwrite blanked every field its
-- sheet lacked. This merges only the fields the caller changed into the row as it stands. Two
-- people on the same field still get last-write-wins.
--
-- forge_save_card is untouched: a new imported card and the promote preflight rename
-- legitimately write whole snapshots, and the deployed app keeps calling it until it ships.
--
-- FUNCTION ONLY: no schema change, no data.

-- Auth checks and size limit = forge_save_card as of 091. The limit is on the merged result,
-- since that is what gets stored. p_set wins if a key is in both, which the app never sends.
create or replace function public.forge_save_card_fields(p_card_id uuid, p_set jsonb, p_remove text[])
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_merged jsonb;
  v_updated timestamptz;
begin
  if not exists (
    select 1 from public.forge_cards c
    where c.id = p_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  if exists (select 1 from public.forge_cards c where c.id = p_card_id and c.status = 'promoted') then
    raise exception 'a promoted card is read-only';
  end if;
  -- `||` or `-` with a null would store a null snapshot, and `||` with a non-object an array.
  if jsonb_typeof(p_set) is distinct from 'object' or p_remove is null then
    raise exception 'invalid card fields';
  end if;
  -- FOR UPDATE: two saves on one card take turns, so neither merges into a row the other is
  -- about to replace.
  select (c.working_snapshot - p_remove) || p_set into v_merged
    from public.forge_cards c
   where c.id = p_card_id
     for update;
  if octet_length(v_merged::text) > 64000 then
    raise exception 'snapshot too large';
  end if;
  -- The title only follows the name when the name is what changed. forge_create_card sets a
  -- title on an empty snapshot, and saving another field must not blank it.
  update public.forge_cards
     set working_snapshot = v_merged,
         title = case
                   when p_set ? 'name' or 'name' = any(p_remove)
                     then nullif(btrim(coalesce(v_merged->>'name','')), '')
                   else title
                 end,
         updated_at = now()
   where id = p_card_id
  returning updated_at into v_updated;
  return v_updated;
end; $$;

-- Strip anon (Supabase default-grants directly), grant authenticated. Same as forge_save_card.
revoke execute on function public.forge_save_card_fields(uuid, jsonb, text[]) from public, anon;
grant execute on function public.forge_save_card_fields(uuid, jsonb, text[]) to authenticated;
