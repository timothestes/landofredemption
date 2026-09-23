-- 107_forge_card_creator_id.sql
-- Fixes: pulling a card back to "Ideas" landed it in the ORIGINAL owner's idea
-- library, not the acting designer's — because forge_cards.owner_id doubled as
-- both "who this private idea belongs to" (Ideas library scoping + edit rights
-- for cards with no set_id) and "who gets author credit" (the Studio "Created by"
-- line). A set with cards attributed to whoever ran the import (owner_id) breaks
-- as soon as a different designer on that set tries to pull one of those cards
-- into their own Ideas: forge_send_card_to_private cleared set_id but never
-- reassigned owner_id, so the card stayed in the importer's Ideas library.
--
-- Split the two concerns: owner_id keeps meaning "current controller" (mutable —
-- it's how private-idea access/visibility already work, and how set elders already
-- have full run of any card in their set). creator_id is new: set once at card
-- creation, never reassigned, and is now what the "Created by" line reads.

alter table public.forge_cards
  add column creator_id uuid references auth.users(id) on delete set null;

update public.forge_cards set creator_id = owner_id where creator_id is null;

alter table public.forge_cards alter column creator_id set not null;

-- Body = 050 verbatim + creator_id.
create or replace function public.forge_create_card(p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_forge_elder_or_super() then
    raise exception 'only elders may create cards';
  end if;
  insert into public.forge_cards (owner_id, creator_id, title)
  values (auth.uid(), auth.uid(), nullif(btrim(p_title), ''))
  returning id into v_id;
  return v_id;
end; $$;

-- Body = 091 verbatim + creator_id.
create or replace function public.forge_create_card_in_set(p_title text, p_set_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (public.is_forge_set_elder(p_set_id) or public.is_forge_superadmin()) then
    raise exception 'not a designer on the target set';
  end if;
  if exists (select 1 from public.forge_sets s where s.id = p_set_id and s.status = 'released') then
    raise exception 'this set has been released and takes no new cards';
  end if;
  insert into public.forge_cards (owner_id, creator_id, title, set_id, status)
  values (auth.uid(), auth.uid(), nullif(btrim(p_title), ''), p_set_id, 'draft')
  returning id into v_id;
  return v_id;
end; $$;

-- Body = 091 verbatim + owner_id transfers to whoever is pulling the card out —
-- that's the whole point of "send to MY private ideas". creator_id is untouched,
-- so authorship credit survives the move.
create or replace function public.forge_send_card_to_private(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if v_card.set_id is null then raise exception 'card is not in a set'; end if;
  if v_card.status = 'promoted' then raise exception 'a promoted card is read-only'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or public.is_forge_set_elder(v_card.set_id)) then
    raise exception 'not authorized';
  end if;
  update public.card_versions set status = 'superseded'
   where card_id = p_card_id and status in ('published','approved');
  update public.forge_cards
     set set_id = null, status = 'private_idea', owner_id = auth.uid(),
         published_version_id = null, approved_version_id = null, updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_returned_to_ideas', p_card_id::text);
end; $$;
