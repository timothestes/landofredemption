-- 116: which side of the match the host plays in an online bracket game.
--
-- The host used to always play the match's entry A and the invited friend
-- entry B. The host can now swap before the friend joins, and the invite
-- page, the friend's deck load and the result write-back all have to agree,
-- so the choice lives on the game row. 'a' (the old behaviour) is the default.

alter table public.deck_bracket_games
  add column host_side text not null default 'a' check (host_side in ('a', 'b'));
