-- 112_post_preview_links.sql
-- Articles: a secret link a poster can send to a proofreader so they can read
-- a draft before it is published. Anyone holding the token can read the post
-- through get_post_preview(); nobody can list tokens but the post's editors.
--
-- A separate table, not a posts column: posts_select_published exposes every
-- column of a published row to anon, which would leak the token of any post
-- that is later unpublished.

create table public.post_preview_links (
  post_id    uuid primary key references public.posts(id) on delete cascade,
  token      text not null unique check (char_length(token) >= 32),
  created_at timestamptz not null default now()
);

-- Supabase's default privileges grant new tables to anon; tokens are never anon's.
revoke all on public.post_preview_links from anon;
grant select, insert, update, delete on public.post_preview_links to authenticated;

alter table public.post_preview_links enable row level security;

-- Same editor rule as posts_update_owner_or_super (095). The posts subquery
-- runs under the caller's RLS, which already shows them their own drafts.
create policy "post_preview_links_editor" on public.post_preview_links
  for all to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_id
        and ((p.author_id = auth.uid() and 'publish_posts' = any(public.get_my_admin_permissions()))
             or public.is_superuser())
    )
  )
  with check (
    exists (
      select 1 from public.posts p
      where p.id = post_id
        and ((p.author_id = auth.uid() and 'publish_posts' = any(public.get_my_admin_permissions()))
             or public.is_superuser())
    )
  );

-- The one way in for a link holder: exact token match only, so the anon key
-- can't enumerate drafts. Returns the post whatever its status; the preview
-- page redirects published posts to their real URL.
create or replace function public.get_post_preview(p_token text)
returns setof public.posts
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.post_preview_links l
  join public.posts p on p.id = l.post_id
  where l.token = p_token;
$$;

revoke execute on function public.get_post_preview(text) from public;
grant execute on function public.get_post_preview(text) to anon, authenticated;
