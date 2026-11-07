-- User-owned live analysis history. Video bytes remain opt-in local files.
-- Applied to staging through Supabase migration user_analysis_activity_rls.
create table if not exists public.user_analysis_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id text not null check (char_length(run_id) between 1 and 512),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) < 1000000),
  updated_at timestamptz not null default now(),
  primary key (owner_id, run_id)
);
create index if not exists user_analysis_records_recent_idx on
  public.user_analysis_records(owner_id, updated_at desc);
alter table public.user_analysis_records enable row level security;
revoke all on table public.user_analysis_records from public, anon;
grant select, insert, update, delete on table public.user_analysis_records to authenticated;
drop policy if exists "owner_select_activity" on public.user_analysis_records;
drop policy if exists "owner_insert_activity" on public.user_analysis_records;
drop policy if exists "owner_update_activity" on public.user_analysis_records;
drop policy if exists "owner_delete_activity" on public.user_analysis_records;
create policy "owner_select_activity" on public.user_analysis_records
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "owner_insert_activity" on public.user_analysis_records
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "owner_update_activity" on public.user_analysis_records
  for update to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "owner_delete_activity" on public.user_analysis_records
  for delete to authenticated using (owner_id = (select auth.uid()));
