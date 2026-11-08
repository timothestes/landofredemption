-- 128: Forge writes that went through without telling anyone (UX audit, 2026-11-08).
-- Safe to apply before the app deploys: every signature is unchanged, so CREATE OR REPLACE keeps
-- the grants and no call can become ambiguous, and each new refusal is a raised error, which the
-- deployed client already reports as a failed action.
-- Bodies were taken from the migrations that last defined them and match production by md5 of
-- prosrc: forge_accept_proposal 075, forge_set_working_finished 061, forge_set_working_art and
-- forge_set_art_placeholder 052, forge_add_art_candidate and forge_delete_art_candidate 082,
-- forge_set_art_candidate_source 101.

-- Accept skipped the name-and-type gate. forge_publish_card (127) refuses to release a card with
-- no name or type, but accepting on an In playtest card mints a 'published' version too, so a
-- proposal that cleared the name reached playtesters. The check reads the proposed snapshot,
-- since that is what gets released, not the working draft.
--   * A Draft card's accept makes an elder-only iteration and reaches nobody, so it isn't blocked.
--   * After the stale-base guard, so a stale proposal still closes as superseded and returns null.
--   * Everything except the check is 075 verbatim.
create or replace function public.forge_accept_proposal(p_proposal_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prop public.card_proposals%rowtype; v_card public.forge_cards%rowtype;
        v_latest uuid; v_next int; v_version_id uuid;
begin
  -- initial read to learn the card_id
  select * into v_prop from public.card_proposals where id = p_proposal_id;
  if not found then raise exception 'proposal not found'; end if;
  -- lock the card first, then re-read+lock the proposal under that lock
  select * into v_card from public.forge_cards where id = v_prop.card_id for update;
  if not found then raise exception 'card not found'; end if;
  select * into v_prop from public.card_proposals where id = p_proposal_id for update;
  if v_prop.status <> 'open' then raise exception 'proposal is not open'; end if;
  if not (public.is_forge_superadmin()
          or (v_card.set_id is not null and public.is_forge_set_elder(v_card.set_id))) then
    raise exception 'not authorized to accept proposals on this card';
  end if;
  if v_card.status not in ('draft','playtesting') then
    raise exception 'unapprove or unarchive this card before accepting changes';
  end if;
  -- stale-base guard vs the LATEST version of any status (NULL-aware).
  -- DO NOT raise — a raise would roll back this update.
  select id into v_latest from public.card_versions
   where card_id = v_card.id
   order by version_number desc limit 1;
  if v_prop.base_version_id is distinct from v_latest then
    update public.card_proposals
       set status = 'superseded', closed_at = now(), closed_by = auth.uid()
     where id = p_proposal_id;
    return null;
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
    from public.card_versions where card_id = v_card.id;

  if v_card.status = 'draft' then
    -- Draft: record the iteration as an elder-only 'draft' version and fold
    -- it into the working draft. No supersede (nothing published exists; and
    -- prior draft rows keep their label), no pointer changes, no release.
    insert into public.card_versions
      (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by)
    values
      (v_card.id, v_next, 'draft', v_prop.proposed_snapshot,
       v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
       v_card.working_finished_key, auth.uid())
    returning id into v_version_id;
    update public.forge_cards
       set working_snapshot = v_prop.proposed_snapshot,
           title = nullif(btrim(coalesce(v_prop.proposed_snapshot->>'name','')), ''),
           updated_at = now()
     where id = v_card.id;
    update public.card_proposals
       set status = 'accepted', resulting_version_id = v_version_id, closed_at = now(), closed_by = auth.uid()
     where id = p_proposal_id;
    update public.card_proposals
       set status = 'superseded', closed_at = now(), closed_by = auth.uid()
     where card_id = v_card.id and status = 'open' and id <> p_proposal_id;
    return v_version_id;
  end if;

  -- Playtesting: this releases the proposal, so it answers to the same check as a release.
  -- Before anything changes, so the raise leaves the proposal open and the card as it was.
  if btrim(coalesce(v_prop.proposed_snapshot->>'name', '')) = ''
     or coalesce(v_prop.proposed_snapshot->'cardType', 'null'::jsonb) in ('null'::jsonb, '[]'::jsonb, '""'::jsonb) then
    raise exception 'a card needs a name and a type before it can be released';
  end if;

  -- Playtesting: freeze a new published version from the proposed snapshot
  update public.card_versions set status = 'superseded'
    where card_id = v_card.id and status = 'published';
  insert into public.card_versions
    (card_id, version_number, status, data, art_key, art_is_placeholder, art_original_key, finished_key, created_by)
  values
    (v_card.id, v_next, 'published', v_prop.proposed_snapshot,
     v_card.working_art_key, v_card.working_art_is_placeholder, v_card.working_art_original_key,
     v_card.working_finished_key, auth.uid())
  returning id into v_version_id;
  update public.forge_cards
     set published_version_id = v_version_id,
         working_snapshot = v_prop.proposed_snapshot,
         title = nullif(btrim(coalesce(v_prop.proposed_snapshot->>'name','')), ''),
         status = 'playtesting',
         updated_at = now()
   where id = v_card.id;
  update public.card_proposals
     set status = 'accepted', resulting_version_id = v_version_id, closed_at = now(), closed_by = auth.uid()
   where id = p_proposal_id;
  update public.card_proposals
     set status = 'superseded', closed_at = now(), closed_by = auth.uid()
   where card_id = v_card.id and status = 'open' and id <> p_proposal_id;
  return v_version_id;
end; $$;

-- A promoted card is read-only, but the working-art writers never said so. forge_save_card and
-- forge_save_card_fields refuse one, and a promoted card still took a new finished image, new art,
-- the placeholder flag and candidate changes. Same check, same text, after the authorization check.
-- Each body is the latest verbatim plus that check. The readers forge_art_key and
-- forge_candidate_art_key write nothing, so they stay as they are.
--
-- Nothing in promote's flow writes through these on a promoted card:
--   * forge_promote_set (092) copies the approved version into the manifest and flips the status.
--   * The image step reads finished_key from that frozen version, and forge_mark_release_image_uploaded
--     and forge_set_release_image_transform write manifest rows only.
--   * applyRenameFix (promote.ts) runs before promotion, on an approved card.
--   * forge_abort_release puts the card back to approved, so its art can change again.
-- The upload that this refuses never reached players either: a release reads the frozen version.
create or replace function public.forge_set_working_finished(
  p_card_id uuid, p_key text
) returns void language plpgsql security definer set search_path = '' as $$
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
  update public.forge_cards
     set working_finished_key = p_key, updated_at = now()
   where id = p_card_id;
end; $$;

create or replace function public.forge_set_working_art(
  p_card_id uuid, p_key text, p_original_key text
) returns void language plpgsql security definer set search_path = '' as $$
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
  update public.forge_cards
     set working_art_key = p_key, working_art_original_key = p_original_key,
         working_art_is_placeholder = false, updated_at = now()
   where id = p_card_id;
end; $$;

create or replace function public.forge_set_art_placeholder(
  p_card_id uuid, p_is_placeholder boolean
) returns void language plpgsql security definer set search_path = '' as $$
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
  update public.forge_cards
     set working_art_is_placeholder = coalesce(p_is_placeholder, false), updated_at = now()
   where id = p_card_id;
end; $$;

create or replace function public.forge_add_art_candidate(p_card_id uuid, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  -- Serialize concurrent adds per card so the count-then-insert cap can't race.
  perform pg_advisory_xact_lock(hashtext(p_card_id::text));
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
  if (select count(*) from public.forge_card_art_candidates a where a.card_id = p_card_id) >= 12 then
    raise exception 'candidate limit reached (12)';
  end if;
  insert into public.forge_card_art_candidates (card_id, key)
  values (p_card_id, p_key)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.forge_delete_art_candidate(p_candidate_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card_id uuid; v_key text;
begin
  select a.card_id, a.key into v_card_id, v_key
    from public.forge_card_art_candidates a where a.id = p_candidate_id;
  if v_card_id is null then
    raise exception 'no such candidate';
  end if;
  if not exists (
    select 1 from public.forge_cards c
    where c.id = v_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  if exists (select 1 from public.forge_cards c where c.id = v_card_id and c.status = 'promoted') then
    raise exception 'a promoted card is read-only';
  end if;
  if exists (
    select 1 from public.forge_cards c
    where c.id = v_card_id and c.working_art_original_key = v_key
  ) then
    raise exception 'candidate is the source of the current artwork';
  end if;
  delete from public.forge_card_art_candidates where id = p_candidate_id;
end; $$;

create or replace function public.forge_set_art_candidate_source(p_candidate_id uuid, p_source_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card_id uuid;
begin
  select a.card_id into v_card_id
    from public.forge_card_art_candidates a where a.id = p_candidate_id;
  if v_card_id is null then
    raise exception 'no such candidate';
  end if;
  if not exists (
    select 1 from public.forge_cards c
    where c.id = v_card_id
      and (c.owner_id = auth.uid()
           or public.is_forge_superadmin()
           or (c.set_id is not null and public.is_forge_set_elder(c.set_id)))
  ) then
    raise exception 'not authorized to edit this card';
  end if;
  if exists (select 1 from public.forge_cards c where c.id = v_card_id and c.status = 'promoted') then
    raise exception 'a promoted card is read-only';
  end if;
  update public.forge_card_art_candidates
    set source_url = nullif(trim(p_source_url), '')
    where id = p_candidate_id;
end; $$;
