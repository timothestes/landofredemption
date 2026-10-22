-- 115: key cards on a bracket entry.
--
-- The matchup preview (/brackets/[id]/matchup/[matchId]) lets the bracket
-- owner star the cards a deck's plan turns on. They are stored on the entry,
-- not the deck, because they are a statement about this bracket's matchups
-- and must survive the deck being edited or made private. Each element is
-- the catalog key `name|set|imgFile` (imgFile sanitized), the same key
-- CARD_BY_FULL_KEY uses. The owner-write policy from 114 already covers
-- updates; reads stay public with the rest of the bracket.

alter table public.deck_bracket_entries
  add column key_cards text[] not null default '{}';
