-- 109: Public live round view for players (/t/[code]).
--
-- Every tournament table is host-only under RLS, so a player's phone cannot
-- read pairings or standings directly. This SECURITY DEFINER function is the
-- one public window: given a join code it returns exactly what the live page
-- needs — and nothing that identifies a person beyond the display name the
-- host already prints on pairing sheets.
--
-- Returns NULL unless a tournament with that code exists AND has started.
-- Never returns: emails, user_ids, host_id, deck snapshots, join blocks.

create or replace function public.get_public_round_view(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t record;
begin
  if p_code is null or length(p_code) <> 6 then
    return null;
  end if;

  select id, name, current_round, n_rounds, round_length, max_score,
         has_started, has_ended, results_published, deck_format, category,
         starting_table_number, numbering_mode
    into v_t
    from public.tournaments
   where code = p_code
     and has_started = true;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'server_now', now(),
    'tournament', jsonb_build_object(
      'id', v_t.id,
      'name', v_t.name,
      'current_round', v_t.current_round,
      'n_rounds', v_t.n_rounds,
      'round_length', v_t.round_length,
      'max_score', v_t.max_score,
      'has_started', v_t.has_started,
      'has_ended', v_t.has_ended,
      'results_published', v_t.results_published,
      'deck_format', v_t.deck_format,
      'category', v_t.category,
      'starting_table_number', v_t.starting_table_number,
      'numbering_mode', v_t.numbering_mode
    ),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'round_number', r.round_number,
        'started_at', r.started_at,
        'is_completed', r.is_completed
      ) order by r.round_number)
      from public.rounds r
      where r.tournament_id = v_t.id
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'round', m.round,
        'match_order', m.match_order,
        'table_number', m.table_number,
        'player1_id', m.player1_id,
        'player2_id', m.player2_id,
        'player1_score', m.player1_score,
        'player2_score', m.player2_score,
        'winner_id', m.winner_id,
        'is_tie', m.is_tie
      ) order by m.round, m.table_number nulls first, m.match_order)
      from public.matches m
      where m.tournament_id = v_t.id
    ), '[]'::jsonb),
    'byes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'round_number', b.round_number,
        'participant_id', b.participant_id
      ) order by b.round_number)
      from public.byes b
      where b.tournament_id = v_t.id
    ), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'match_points', p.match_points,
        'differential', p.differential,
        'dropped_out', p.dropped_out
      ) order by p.name)
      from public.participants p
      where p.tournament_id = v_t.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_public_round_view(text) from public;
grant execute on function public.get_public_round_view(text) to anon, authenticated;

comment on function public.get_public_round_view(text) is
  'Public, read-only live view of a started tournament by join code: rounds, pairings, scores and participant display names. NULL when the code is unknown or the event has not started.';
