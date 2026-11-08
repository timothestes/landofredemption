-- 127: Forge release and lifecycle honesty (UX audit, 2026-11-08).
-- Safe to apply before the app deploys: every signature the deployed client calls is
-- unchanged, and each behaviour change is one that client already handles.
-- Bodies were taken from the migrations that last defined them and match production
-- by md5 of prosrc: forge_archive_card 075, forge_unarchive_card 072, forge_publish_card 083.

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

-- (U-16) A card needs a name and a type before it can be released.
--
-- Missing art stays allowed: art-less playtest releases are normal. The deployed client
-- treats the raised error as a failed release, and the current client checks first
-- (releaseBlockers in app/forge/lib/lifecycleCopy.ts), so this is the backstop. The
-- signature is unchanged, so CREATE OR REPLACE keeps the grants.
create or replace function public.forge_publish_card(p_card_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype; v_next int; v_version_id uuid;
        v_can_accept boolean; v_matched uuid;
begin
  select * into v_card from public.forge_cards where id = p_card_id for update;
  if not found then raise exception 'card not found'; end if;
  if not (v_card.owner_id = auth.uid() or public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to publish this card';
  end if;
  if v_card.set_id is null then raise exception 'only cards in a set can be published'; end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'only a draft or playtesting card can be published';
  end if;
  if btrim(coalesce(v_card.working_snapshot->>'name', '')) = ''
     or coalesce(v_card.working_snapshot->'cardType', 'null'::jsonb) in ('null'::jsonb, '[]'::jsonb, '""'::jsonb) then
    raise exception 'a card needs a name and a type before it can be released';
  end if;
  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = p_card_id;
  update public.card_versions set status = 'superseded'
    where card_id = p_card_id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by, note)
  values
    (p_card_id, v_next, 'published', v_card.working_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id, status = 'playtesting', updated_at = now()
   where id = p_card_id;

  -- Resolve open proposals. The card row is locked FOR UPDATE above and
  -- forge_create_proposal takes FOR SHARE on it, so no proposal can be created
  -- between the version insert and this sweep.
  v_can_accept := public.is_forge_superadmin() or public.is_forge_set_elder(v_card.set_id);
  if v_can_accept then
    select id into v_matched
      from public.card_proposals
     where card_id = p_card_id
       and status = 'open'
       and proposed_snapshot = v_card.working_snapshot
     order by created_at, id
     limit 1
       for update;
    if v_matched is not null then
      update public.card_proposals
         set status = 'accepted', resulting_version_id = v_version_id,
             closed_at = now(), closed_by = auth.uid()
       where id = v_matched;
    end if;
  end if;

  -- The accepted row (if any) is no longer 'open', so this sweep skips it
  -- without needing to name it.
  update public.card_proposals
     set status = 'superseded', closed_at = now(), closed_by = auth.uid()
   where card_id = p_card_id and status = 'open';

  return v_version_id;
end; $$;
