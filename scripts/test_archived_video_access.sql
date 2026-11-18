-- Run against a disposable local database after applying the migrations.
begin;

insert into auth.users (id, email)
values
  ('ec0b7bd2-3595-4b45-8f9a-2e29b6000011', 'vision-test-owner@example.test'),
  ('ec0b7bd2-3595-4b45-8f9a-2e29b6000022', 'vision-test-viewer@example.test'),
  ('ec0b7bd2-3595-4b45-8f9a-2e29b6000033', 'vision-test-operator@example.test'),
  ('ec0b7bd2-3595-4b45-8f9a-2e29b6000044', 'vision-test-disabled@example.test');
insert into public.profiles (id, email, name, role, status)
select id, email, email, case when email like '%operator%' then 'Operator' else 'Viewer' end,
       case when email like '%disabled%' then 'Disabled' else 'Active' end
from auth.users where email like 'vision-test-%@example.test'
on conflict (id) do update set role = excluded.role, status = excluded.status;

insert into public.video_assets (id, filename, storage_path, storage_provider, uploaded_by)
values
  ('325cacab-24c6-4ba6-b720-6ad618000011', 'fixture-owner.mp4', 'qa/owner.mp4', 'supabase',
    'ec0b7bd2-3595-4b45-8f9a-2e29b6000011'),
  ('325cacab-24c6-4ba6-b720-6ad618000044', 'fixture-disabled.mp4', 'qa/disabled.mp4', 'supabase',
    'ec0b7bd2-3595-4b45-8f9a-2e29b6000044');

insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('videos', 'qa/owner.mp4', 'ec0b7bd2-3595-4b45-8f9a-2e29b6000011', '{"size": 42}');
do $$
begin
  if (select public from storage.buckets where id = 'videos') is distinct from false then
    raise exception 'The archive bucket must be private';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'ec0b7bd2-3595-4b45-8f9a-2e29b6000022', true);
do $$
begin
  if exists (select 1 from public.video_assets where filename like 'fixture-%')
    or exists (select 1 from storage.objects where bucket_id = 'videos' and name = 'qa/owner.mp4')
    or exists (select 1 from public.video_asset_storage_info() where video_id = '325cacab-24c6-4ba6-b720-6ad618000011') then
    raise exception 'Unrelated Viewer could read archived metadata or bytes';
  end if;
  begin
    insert into public.video_assets (filename, storage_path, uploaded_by)
    values ('fixture-forged.mp4', '', 'ec0b7bd2-3595-4b45-8f9a-2e29b6000011');
    raise exception 'Viewer could create a row on behalf of another owner';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', 'ec0b7bd2-3595-4b45-8f9a-2e29b6000011', true);
do $$
begin
  if not exists (select 1 from public.video_asset_storage_info()
      where video_id = '325cacab-24c6-4ba6-b720-6ad618000011' and object_exists and object_size = 42) then
    raise exception 'Owner lost the legacy object lookup';
  end if;
  update public.video_assets set filename = 'fixture-renamed.mp4' where id = '325cacab-24c6-4ba6-b720-6ad618000011';
  if not found then raise exception 'Owner cannot update their asset'; end if;
  begin
    update public.video_assets set uploaded_by = 'ec0b7bd2-3595-4b45-8f9a-2e29b6000022'
    where id = '325cacab-24c6-4ba6-b720-6ad618000011';
    raise exception 'Owner could change ownership';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', 'ec0b7bd2-3595-4b45-8f9a-2e29b6000033', true);
do $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'videos' and name = 'qa/owner.mp4') then
    raise exception 'Operator cannot access archived footage for review';
  end if;
  delete from storage.objects where bucket_id = 'videos' and name = 'qa/owner.mp4';
  if found then raise exception 'Operator deleted another owner''s object'; end if;
  delete from public.video_assets where id = '325cacab-24c6-4ba6-b720-6ad618000011';
  if found then raise exception 'Operator deleted another owner''s row'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'ec0b7bd2-3595-4b45-8f9a-2e29b6000044', true);
do $$
begin
  if exists (select 1 from public.video_assets where filename = 'fixture-disabled.mp4') then
    raise exception 'Disabled account retained archive access';
  end if;
end $$;

reset role;
set local role anon;
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'videos' and name = 'qa/owner.mp4') then
    raise exception 'Anonymous caller can read the archive object';
  end if;
end $$;
rollback;
