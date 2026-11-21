-- 130: guest join. A player without an account joins an event that needs no
-- decklist by name alone. Their browser holds a random token in a cookie; only
-- its SHA-256 lands here, so a participant row never carries a usable token.

alter table public.participants
  add column guest_key text;

-- One join per browser per event, the guest counterpart of
-- participants_tournament_user_uniq.
create unique index participants_tournament_guest_uniq
  on public.participants (tournament_id, guest_key)
  where guest_key is not null;

-- Atomic guest join. Locks the tournament row like tournament_qr_join, so a
-- join cannot land after the host starts the event. Service-role only.
create or replace function public.tournament_guest_join(
  p_code text,
  p_guest_key text,
  p_display_name text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t record;
  v_participant_id uuid;
begin
  if coalesce(p_guest_key, '') = '' or coalesce(p_display_name, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  select id, has_started, require_decklists into v_t
    from public.tournaments
    where code = p_code
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_t.has_started then
    return jsonb_build_object('ok', false, 'error', 'started');
  end if;
  -- A decklist is tied to an account, so these events stay sign-in only.
  if v_t.require_decklists then
    return jsonb_build_object('ok', false, 'error', 'decklist_required');
  end if;

  if exists (
    select 1 from public.participants
    where tournament_id = v_t.id and guest_key = p_guest_key
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_joined');
  end if;

  -- Backstop for an anonymous write: far above any real event's guest count.
  if (
    select count(*) from public.participants
    where tournament_id = v_t.id and guest_key is not null
  ) >= 250 then
    return jsonb_build_object('ok', false, 'error', 'guests_full');
  end if;

  insert into public.participants (tournament_id, name, guest_key)
    values (v_t.id, p_display_name, p_guest_key)
    returning id into v_participant_id;

  return jsonb_build_object('ok', true, 'participant_id', v_participant_id);
end
$$;

revoke execute on function public.tournament_guest_join(text, text, text)
  from public, anon, authenticated;
