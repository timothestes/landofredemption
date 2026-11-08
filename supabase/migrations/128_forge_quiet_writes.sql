-- 128: Forge writes that went through without telling anyone (UX audit, 2026-11-08).
-- Safe to apply before the app deploys: every signature is unchanged, so CREATE OR REPLACE keeps
-- the grants and no call can become ambiguous, and each new refusal is a raised error, which the
-- deployed client already reports as a failed action.
-- Bodies were taken from the migrations that last defined them and match production by md5 of
-- prosrc: forge_accept_proposal 075.

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
