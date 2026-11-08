-- 127: Forge release and lifecycle honesty (UX audit, 2026-11-08).
-- Safe to apply before the app deploys: every signature the deployed client calls is
-- unchanged, and each behaviour change is one that client already handles.
-- Bodies were taken from the migrations that last defined them and match production
-- by md5 of prosrc: forge_archive_card 075, forge_unarchive_card 072.

-- (U-17) Restore returns a released card to In playtest.
--
-- Shelving has to retire the live version: card_versions_select lets a granted
-- playtester read any 'published' or 'approved' row, whatever the card's status. So
-- by the time forge_unarchive_card runs, no row and no pointer says the card was ever
-- live, and it always came back as Draft. Picking the newest 'superseded' row instead
-- would be wrong: a card returned to ideas, re-shared and then shelved still has one,
-- and Restore would put a retired version back in front of playtesters.
--
-- So Shelve records which version it took down. forge_archive_card is the only way
-- into 'archived' and always overwrites the pointer, so a value left behind by Return
-- to ideas can't be read. Nothing was shelved on production when this was written, so
-- there is nothing to backfill. A card with no pointer restores to Draft as before.
-- A Final card restores to In playtest; Mark final is one click away.
alter table public.forge_cards add column if not exists shelved_version_id uuid;

do $$ begin
  alter table public.forge_cards
    add constraint fk_shelved foreign key (id, shelved_version_id)
      references public.card_versions(card_id, id);
exception when duplicate_object then null; end $$;

create or replace function public.forge_archive_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  if v_card.status not in ('draft','playtesting','approved') then
    raise exception 'card cannot be archived from its current state';
  end if;
  update public.card_versions set status = 'superseded'
   where card_id = p_card_id and status in ('published','approved');
  update public.forge_cards
     set status = 'archived', published_version_id = null, approved_version_id = null,
         shelved_version_id = coalesce(v_card.approved_version_id, v_card.published_version_id),
         updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_archived', p_card_id::text);
end; $$;

create or replace function public.forge_unarchive_card(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized';
  end if;
  if v_card.status <> 'archived' then raise exception 'card is not archived'; end if;
  if v_card.shelved_version_id is not null then
    update public.card_versions set status = 'published' where id = v_card.shelved_version_id;
    update public.forge_cards
       set status = 'playtesting', published_version_id = v_card.shelved_version_id,
           shelved_version_id = null, updated_at = now()
     where id = p_card_id;
  else
    update public.forge_cards set status = 'draft', updated_at = now() where id = p_card_id;
  end if;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_unarchived', p_card_id::text);
end; $$;
