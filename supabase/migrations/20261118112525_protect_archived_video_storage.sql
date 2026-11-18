-- Restrict archived metadata and footage. The active browser ledger already
-- uses separate, owner-scoped user_analysis_records policies.
drop policy if exists "Authenticated users can read video_assets" on public.video_assets;
drop policy if exists "Authenticated users can insert video_assets" on public.video_assets;
drop policy if exists "Authenticated users can update video_assets" on public.video_assets;
drop policy if exists "Owners and supervisors can delete video_assets" on public.video_assets;

create policy "Owners and staff can read video assets"
  on public.video_assets for select to authenticated
  using (
    ((select public.auth_user_role()) is not null and uploaded_by = (select auth.uid()))
    or (select public.auth_user_role()) in ('Operator', 'Supervisor', 'Admin')
  );
create policy "Owners can create video assets"
  on public.video_assets for insert to authenticated
  with check ((select public.auth_user_role()) is not null and uploaded_by = (select auth.uid()));
create policy "Owners can update video assets"
  on public.video_assets for update to authenticated
  using ((select public.auth_user_role()) is not null and uploaded_by = (select auth.uid()))
  with check ((select public.auth_user_role()) is not null and uploaded_by = (select auth.uid()));
create policy "Owners and supervisors can delete video_assets"
  on public.video_assets for delete to authenticated
  using (
    ((select public.auth_user_role()) is not null and uploaded_by = (select auth.uid()))
    or (select public.auth_user_role()) in ('Supervisor', 'Admin')
  );

-- Originals in this legacy bucket are now accessed using signed URLs.
-- Uploads in the current product are handled by the B2 Edge Function.
update storage.buckets set public = false where id = 'videos';
drop policy if exists "Videos are publicly accessible" on storage.objects;
drop policy if exists "Authenticated users can upload videos" on storage.objects;
drop policy if exists "Authenticated users can update their videos" on storage.objects;
drop policy if exists "Authenticated users can delete their videos" on storage.objects;

-- Storage's recorded owner is independent of editable video metadata.
-- Ownerless historical objects remain available to authorized review staff.
create policy "Owners and staff can read archived video objects"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'videos' and (
      (select public.auth_user_role()) in ('Operator', 'Supervisor', 'Admin')
      or ((select public.auth_user_role()) is not null
          and coalesce(owner_id, owner::text) = (select auth.uid())::text)
    )
  );

create policy "Owners and supervisors can delete archived video objects"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'videos' and (
      (select public.auth_user_role()) in ('Supervisor', 'Admin')
      or ((select public.auth_user_role()) is not null
          and coalesce(owner_id, owner::text) = (select auth.uid())::text)
    )
  );

-- Use the caller's metadata and object policies for size and duplicate lookup.
alter function public.video_asset_storage_info() security invoker;
