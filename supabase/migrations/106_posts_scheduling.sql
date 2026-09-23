-- 106_posts_scheduling.sql
-- Articles: let posters schedule a future publish time or backdate the
-- displayed publish date. Feature request, not from the original spec
-- (095_posts.sql originally set published_at on first publish and never
-- let it change — it is now editable at any time, including on already-
-- published posts).

alter table public.posts add column scheduled_at timestamptz;

-- The scheduling cron scans exactly this shape (status='draft', scheduled_at
-- due); a partial index keeps that scan cheap without indexing every row.
create index posts_scheduled_idx on public.posts (scheduled_at)
  where status = 'draft' and scheduled_at is not null;
