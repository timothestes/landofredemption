-- 129_forge_release_artist.sql
-- A released Forge card carries its designer-entered artist credit into the
-- public catalog (CardData.artist). The manifest gains an artist column, and
-- forge_promote_set fills it from the frozen APPROVED version's artistCredit —
-- the same text CardSvg printed on the card image ("Illus. …"). It is read
-- from the version rather than the payload so the payload cannot smuggle an
-- unapproved credit, and so an app deploy that predates this migration still
-- releases with the right artist.
--
-- Rows released before this migration are backfilled the same way.
--
-- forge_promote_set is otherwise byte-for-byte 092's body (checked against the
-- live definition on 2026-11-18). Same signature, so create or replace keeps
-- it a single overload; EXECUTE grants are restated anyway.

alter table public.forge_public_release_cards
  add column if not exists artist text not null default '';

update public.forge_public_release_cards rc
   set artist = btrim(coalesce(v.data->>'artistCredit', ''))
  from public.card_versions v
 where v.id = rc.version_id
   and rc.artist = '';

create or replace function public.forge_promote_set(
  p_set_id uuid, p_set_code text, p_official_set text, p_rows jsonb,
  p_close_set boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_release_id uuid;
  v_row jsonb;
  v_card public.forge_cards%rowtype;
  v_card_id uuid; v_version_id uuid; v_name text; v_img text;
  v_artist text;
  v_count int;
  v_remaining int;
begin
  if not public.is_forge_superadmin() then
    raise exception 'only a forge superadmin may promote a set';
  end if;
  if btrim(coalesce(p_set_code, '')) = '' then raise exception 'set code required'; end if;
  if length(p_set_code) > 16 then raise exception 'set code too long'; end if;
  if p_set_code ~ '\(AB\)' then
    raise exception 'set code must not match the alternate-art (AB) pattern';
  end if;
  if btrim(coalesce(p_official_set, '')) = '' then raise exception 'official set name required'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then raise exception 'row count out of range'; end if;

  perform 1 from public.forge_sets where id = p_set_id for update;
  if not found then raise exception 'set not found'; end if;

  -- A set code belongs to exactly one forge set across all releases (waves reuse it).
  if exists (
    select 1 from public.forge_public_releases r
    where r.set_code = p_set_code and r.set_id <> p_set_id
  ) then
    raise exception 'set code % is already used by another released set', p_set_code;
  end if;
  -- 092: waves of one set code must never fork the catalog display name.
  if exists (
    select 1 from public.forge_public_releases r
    where r.set_code = btrim(p_set_code)
      and r.official_set <> btrim(p_official_set)
  ) then
    raise exception 'set code % was already released as a different official set name', p_set_code;
  end if;
  -- One release in flight per set; waves start only after the previous release
  -- fully lands (or is aborted, which deletes its manifest).
  if exists (
    select 1 from public.forge_public_releases r
    where r.set_id = p_set_id and r.status <> 'decks_migrated'
  ) then
    raise exception 'a release is already in progress for this set';
  end if;

  insert into public.forge_public_releases (set_id, set_code, official_set, card_count, created_by)
  values (p_set_id, btrim(p_set_code), btrim(p_official_set), v_count, auth.uid())
  returning id into v_release_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_card_id    := (v_row->>'card_id')::uuid;
    v_version_id := (v_row->>'version_id')::uuid;
    v_name       := btrim(coalesce(v_row->>'name', ''));
    v_img        := btrim(coalesce(v_row->>'img_file', ''));
    if v_name = '' then raise exception 'a row is missing its card name'; end if;
    if v_img  = '' then raise exception 'row % is missing its image file', v_name; end if;

    select * into v_card from public.forge_cards where id = v_card_id for update;
    if not found then raise exception 'card % not found', v_name; end if;
    if v_card.set_id is distinct from p_set_id then
      raise exception 'card % is not in this set', v_name;
    end if;
    if v_card.status <> 'approved' then
      raise exception 'card % is not approved', v_name;
    end if;
    if v_card.approved_version_id is distinct from v_version_id then
      raise exception 'card % approved version changed — re-run preflight', v_name;
    end if;
    if exists (select 1 from public.forge_public_release_cards c where c.card_id = v_card_id) then
      raise exception 'card % is already part of a release', v_name;
    end if;
    -- Global (set_code, name) uniqueness across all prior releases (waves included).
    if exists (
      select 1 from public.forge_public_release_cards c
      where c.set_code = btrim(p_set_code) and c.name = v_name
    ) then
      raise exception 'a card named % was already released under set code %', v_name, p_set_code;
    end if;

    -- 129: the credit printed on the card, from the frozen approved version.
    select btrim(coalesce(v.data->>'artistCredit', '')) into v_artist
      from public.card_versions v where v.id = v_version_id;

    insert into public.forge_public_release_cards (
      release_id, card_id, version_id, name, set_code, img_file, official_set,
      type, brigade, strength, toughness, class, identifier, special_ability,
      rarity, reference, alignment, legality, artist
    ) values (
      v_release_id, v_card_id, v_version_id, v_name, btrim(p_set_code), v_img, btrim(p_official_set),
      coalesce(v_row->>'type',''), coalesce(v_row->>'brigade',''),
      coalesce(v_row->>'strength',''), coalesce(v_row->>'toughness',''),
      coalesce(v_row->>'class',''), coalesce(v_row->>'identifier',''),
      coalesce(v_row->>'special_ability',''), coalesce(v_row->>'rarity',''),
      coalesce(v_row->>'reference',''), coalesce(v_row->>'alignment',''),
      coalesce(v_row->>'legality',''), coalesce(v_artist, '')
    );

    update public.forge_cards set status = 'promoted', updated_at = now()
     where id = v_card_id;
  end loop;

  -- 092: closing is explicit. A close must cover every remaining releasable
  -- card (selected cards were flipped 'promoted' above, so they no longer
  -- count as remaining). A partial release leaves forge_sets.status alone —
  -- the set keeps taking new cards and future waves.
  if p_close_set then
    select count(*) into v_remaining
      from public.forge_cards c
     where c.set_id = p_set_id and c.status not in ('archived', 'promoted');
    if v_remaining > 0 then
      raise exception 'cannot close the set: % card(s) remain unreleased', v_remaining;
    end if;
    update public.forge_sets set status = 'released', updated_at = now() where id = p_set_id;
  end if;

  insert into public.forge_audit (actor, action, target)
  values (auth.uid(), 'set_promoted', p_set_id::text);

  return v_release_id;
end; $$;

revoke execute on function public.forge_promote_set(uuid, text, text, jsonb, boolean) from public, anon;
grant execute on function public.forge_promote_set(uuid, text, text, jsonb, boolean) to authenticated;
