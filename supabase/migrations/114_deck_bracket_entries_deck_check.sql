-- 114: deck_bracket_entries owner-write must only point at a deck the owner may use.
--
-- 113's policy checked bracket ownership only, so a bracket owner could write
-- any deck_id into an entry. loadBracketSeatDeckAction reads entry B's deck
-- with the service role, so that would leak a stranger's private decklist.
-- The action now checks the deck itself; this closes the write side too:
-- an inserted or updated entry's deck must be the caller's own or public.

drop policy if exists "deck_bracket_entries_owner_write" on public.deck_bracket_entries;

create policy "deck_bracket_entries_owner_write" on public.deck_bracket_entries
  for all to authenticated
  using (exists (select 1 from public.deck_brackets b where b.id = bracket_id and b.owner_id = auth.uid()))
  with check (
    exists (select 1 from public.deck_brackets b where b.id = bracket_id and b.owner_id = auth.uid())
    and (
      deck_bracket_entries.deck_id is null
      or exists (
        select 1 from public.decks d
        where d.id = deck_bracket_entries.deck_id
          and (d.user_id = auth.uid() or d.is_public)
      )
    )
  );
