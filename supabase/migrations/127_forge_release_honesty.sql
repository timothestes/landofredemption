-- 127: Forge release and lifecycle honesty (UX audit, 2026-11-08).
-- Safe to apply before the app deploys: every signature the deployed client calls is
-- unchanged, and each behaviour change is one that client already handles.
-- Bodies were taken from the migrations that last defined them and match production
-- by md5 of prosrc: forge_archive_card 075, forge_unarchive_card 072, forge_publish_card 083.

-- (U-17) Restore puts a card back the way it was before Shelve.
--
-- Shelving has to retire the live version: card_versions_select lets a granted
-- playtester read any 'published' or 'approved' row, whatever the card's status. So
-- by the time forge_unarchive_card runs, no row and no pointer says the card was ever
-- live, and it always came back as Draft. Picking the newest 'superseded' row instead
-- would be wrong: a card returned to ideas, re-shared and then shelved still has one,
-- and Restore would put a retired version back in front of playtesters.
--
-- So Shelve records what it clears, and Restore puts back exactly that, row statuses
-- included: setting forge_cards.status alone wouldn't reach playtesters, who read
-- card_versions by status. No new version is minted.
--   * In playtest comes back In playtest, Final comes back Final, Draft comes back Draft.
--   * forge_archive_card is the only way into 'archived' and always overwrites the
--     record, so one left behind by Return to ideas can't be read.
--   * No record means Draft, as before. Nothing was shelved on production when this was
--     written, so there is nothing to backfill.
--   * Open proposals carry on: no version is minted while a card is shelved, so their
--     base is still the latest version and the stale guard still passes.
-- Signatures are unchanged, so CREATE OR REPLACE keeps the grants, and the deployed
-- client only checks for an error and refreshes. Its Restore button works as it did and
-- the card shows its restored status.
alter table public.forge_cards
  add column if not exists shelved_status public.forge_card_status,
  add column if not exists shelved_published_version_id uuid,
  add column if not exists shelved_approved_version_id uuid;

do $$ begin
  alter table public.forge_cards
    add constraint fk_shelved_published foreign key (id, shelved_published_version_id)
      references public.card_versions(card_id, id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.forge_cards
    add constraint fk_shelved_approved foreign key (id, shelved_approved_version_id)
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
         shelved_status = v_card.status,
         shelved_published_version_id = v_card.published_version_id,
         shelved_approved_version_id = v_card.approved_version_id,
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
  -- In this order: on a Final card both pointers name the same row, and it must end 'approved'.
  update public.card_versions set status = 'published' where id = v_card.shelved_published_version_id;
  update public.card_versions set status = 'approved' where id = v_card.shelved_approved_version_id;
  update public.forge_cards
     set status = coalesce(v_card.shelved_status, 'draft'),
         published_version_id = v_card.shelved_published_version_id,
         approved_version_id = v_card.shelved_approved_version_id,
         shelved_status = null, shelved_published_version_id = null, shelved_approved_version_id = null,
         updated_at = now()
   where id = p_card_id;
  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'card_unarchived', p_card_id::text);
end; $$;

-- A snapshot with its empty fields removed. Typing into a blank field and erasing it
-- leaves "" where there was nothing, and that is not a change anyone can see.
-- sameCardContent in app/forge/lib/cardDiff.ts mirrors this. Internal: not callable over
-- RPC. Definer functions run as the owner, who keeps EXECUTE.
create or replace function public._forge_snapshot_content(p_snapshot jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
    from jsonb_each(p_snapshot)
   where value not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb);
$$;

revoke execute on function public._forge_snapshot_content(jsonb) from public, anon, authenticated;

-- forge_publish_card gains two guards. Same signature, so CREATE OR REPLACE keeps the
-- grants. Everything after them is 083 verbatim.
--
-- (U-16) A card needs a name and a type before it can be released. Missing art stays
-- allowed: art-less playtest releases are normal. The deployed client treats the raised
-- error as a failed release, and the current client checks first (releaseBlockers in
-- app/forge/lib/lifecycleCopy.ts), so this is the backstop.
--
-- (U-15) A card that matches its published version, in content and art, mints nothing
-- and returns null. Without this, a select-all release bumped every card and stamped it
-- with a fresh date, so History and the "Updated since" filter stopped meaning anything.
--   * The guard needs a published_version_id. A first release has none and always mints,
--     and so does a card whose last release was retired, since releasing it has an effect.
--   * Open proposals are left alone: no version was minted, so their base is still
--     current and they can still be accepted.
--   * Callers only look at `error`, so the deployed client and promote.ts's preflight
--     rename both carry on: the rename goes on to approve the version already published.
create or replace function public.forge_publish_card(p_card_id uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_card public.forge_cards%rowtype; v_next int; v_version_id uuid;
        v_can_accept boolean; v_matched uuid; v_live public.card_versions%rowtype;
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
  if v_card.published_version_id is not null then
    select * into v_live from public.card_versions where id = v_card.published_version_id;
    if public._forge_snapshot_content(v_live.data) = public._forge_snapshot_content(v_card.working_snapshot)
       and v_live.art_key is not distinct from v_card.working_art_key
       and v_live.art_is_placeholder = v_card.working_art_is_placeholder
       and v_live.art_original_key is not distinct from v_card.working_art_original_key
       and v_live.finished_key is not distinct from v_card.working_finished_key then
      return null;
    end if;
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
