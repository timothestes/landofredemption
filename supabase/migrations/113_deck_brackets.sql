-- 113_deck_brackets.sql
-- Deck Bracket: a single-elimination bracket of decks (2/4/8/16 entries) that a
-- signed-in player creates and plays through, solo, online, or by recording
-- results. The bracket page is shareable by link, so every table is readable by
-- anon; only the bracket's owner can write. Entries snapshot the deck's name,
-- format and preview art at creation, so rendering someone else's bracket never
-- reads a private deck.

create table public.deck_brackets (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  format            text not null check (format in ('T1', 'T2', 'Paragon')),
  size              int  not null check (size in (2, 4, 8, 16)),
  best_of           int  not null check (best_of in (1, 3, 5)),
  status            text not null default 'active' check (status in ('active', 'complete')),
  champion_entry_id uuid null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz null
);

create table public.deck_bracket_entries (
  id             uuid primary key default gen_random_uuid(),
  bracket_id     uuid not null references public.deck_brackets(id) on delete cascade,
  seed           int  not null,
  deck_id        uuid null references public.decks(id) on delete set null,
  deck_name      text not null,
  deck_format    text not null,
  preview_card_1 text null,
  preview_card_2 text null,
  paragon        text null,
  unique (bracket_id, seed)
);

-- The champion is set after the entries exist, so this FK is added afterwards.
alter table public.deck_brackets
  add constraint deck_brackets_champion_entry_id_fkey
  foreign key (champion_entry_id) references public.deck_bracket_entries(id) on delete set null;

create table public.deck_bracket_matches (
  id              uuid primary key default gen_random_uuid(),
  bracket_id      uuid not null references public.deck_brackets(id) on delete cascade,
  round           int  not null,
  position        int  not null,
  entry_a_id      uuid null references public.deck_bracket_entries(id) on delete set null,
  entry_b_id      uuid null references public.deck_bracket_entries(id) on delete set null,
  winner_entry_id uuid null references public.deck_bracket_entries(id) on delete set null,
  is_bye          boolean not null default false,
  unique (bracket_id, round, position)
);

create table public.deck_bracket_games (
  id              uuid primary key default gen_random_uuid(),
  match_id        uuid not null references public.deck_bracket_matches(id) on delete cascade,
  game_number     int  not null,
  mode            text not null check (mode in ('solo', 'online', 'manual')),
  code            text null,
  first_entry_id  uuid null references public.deck_bracket_entries(id) on delete set null,
  winner_entry_id uuid null references public.deck_bracket_entries(id) on delete set null,
  souls_a         int  null,
  souls_b         int  null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz null,
  unique (match_id, game_number)
);

create index deck_brackets_owner_idx on public.deck_brackets (owner_id);
create index deck_bracket_games_match_idx on public.deck_bracket_games (match_id);

-- Reuses the trigger function from 001_create_deck_tables.sql.
create trigger update_deck_brackets_updated_at
  before update on public.deck_brackets
  for each row
  execute function public.update_updated_at_column();

-- Reads are public (shareable page); writes are authenticated, owner-gated by RLS.
grant select on public.deck_brackets, public.deck_bracket_entries,
  public.deck_bracket_matches, public.deck_bracket_games to anon, authenticated;
grant insert, update, delete on public.deck_brackets, public.deck_bracket_entries,
  public.deck_bracket_matches, public.deck_bracket_games to authenticated;

alter table public.deck_brackets enable row level security;
alter table public.deck_bracket_entries enable row level security;
alter table public.deck_bracket_matches enable row level security;
alter table public.deck_bracket_games enable row level security;

create policy "deck_brackets_select_all" on public.deck_brackets
  for select to anon, authenticated using (true);

create policy "deck_brackets_owner_write" on public.deck_brackets
  for all to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "deck_bracket_entries_select_all" on public.deck_bracket_entries
  for select to anon, authenticated using (true);

create policy "deck_bracket_entries_owner_write" on public.deck_bracket_entries
  for all to authenticated
  using (exists (select 1 from public.deck_brackets b where b.id = bracket_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.deck_brackets b where b.id = bracket_id and b.owner_id = auth.uid()));

create policy "deck_bracket_matches_select_all" on public.deck_bracket_matches
  for select to anon, authenticated using (true);

create policy "deck_bracket_matches_owner_write" on public.deck_bracket_matches
  for all to authenticated
  using (exists (select 1 from public.deck_brackets b where b.id = bracket_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from public.deck_brackets b where b.id = bracket_id and b.owner_id = auth.uid()));

create policy "deck_bracket_games_select_all" on public.deck_bracket_games
  for select to anon, authenticated using (true);

create policy "deck_bracket_games_owner_write" on public.deck_bracket_games
  for all to authenticated
  using (exists (
    select 1 from public.deck_bracket_matches m
    join public.deck_brackets b on b.id = m.bracket_id
    where m.id = match_id and b.owner_id = auth.uid()))
  with check (exists (
    select 1 from public.deck_bracket_matches m
    join public.deck_brackets b on b.id = m.bracket_id
    where m.id = match_id and b.owner_id = auth.uid()));
