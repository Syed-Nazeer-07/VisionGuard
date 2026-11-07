-- Persist selectable stream configurations for each authenticated user.
-- Never upload video bytes; camera credentials must not be embedded in URLs.
create table if not exists public.user_stream_sources (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  source_url text not null check (char_length(source_url) between 1 and 2048),
  format text not null check (format in ('hls','video')),
  created_at timestamptz not null default now(),
  primary key (owner_id,source_id)
);
create index if not exists user_stream_sources_owner_created_idx
  on public.user_stream_sources(owner_id,created_at desc);
alter table public.user_stream_sources enable row level security;
revoke all on public.user_stream_sources from public,anon;
grant select, insert, update, delete on public.user_stream_sources to authenticated;
drop policy if exists "owner_read_streams" on public.user_stream_sources;
drop policy if exists "owner_insert_streams" on public.user_stream_sources;
drop policy if exists "owner_update_streams" on public.user_stream_sources;
drop policy if exists "owner_delete_streams" on public.user_stream_sources;
create policy "owner_read_streams" on public.user_stream_sources for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "owner_insert_streams" on public.user_stream_sources for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "owner_update_streams" on public.user_stream_sources for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "owner_delete_streams" on public.user_stream_sources for delete to authenticated
  using (owner_id = (select auth.uid()));
