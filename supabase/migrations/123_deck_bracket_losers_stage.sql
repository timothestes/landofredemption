-- 123_deck_bracket_losers_stage.sql
-- Deck Bracket: an optional losers bracket (double elimination). Each match
-- now says which part of the bracket it is in; a bracket has a losers bracket
-- exactly when it has 'losers'/'final' match rows, so the bracket row needs no
-- flag. Round and position number within a stage.

alter table public.deck_bracket_matches
  add column stage text not null default 'winners'
    check (stage in ('winners', 'losers', 'final'));

alter table public.deck_bracket_matches
  drop constraint deck_bracket_matches_bracket_id_round_position_key;

alter table public.deck_bracket_matches
  add constraint deck_bracket_matches_bracket_id_stage_round_position_key
    unique (bracket_id, stage, round, position);
