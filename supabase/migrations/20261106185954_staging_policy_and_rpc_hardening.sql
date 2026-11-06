-- Follow-up after an actual Supabase staging pg_policies/security-advisor audit.
-- Corrects subtle SQL name resolution bug: r.video_id = video_id had resolved
-- to r.video_id = r.video_id, permitting a mismatched owned run and video.
-- Restore explicit ownership of both objects by the same user.

ALTER POLICY "Tracked object insertion scoped to source" ON public.tracked_objects
WITH CHECK (
  public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
  OR (
    tracked_objects.video_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.video_assets v
      WHERE v.id = tracked_objects.video_id AND v.uploaded_by = auth.uid()
    )
    AND (
      tracked_objects.analysis_run_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.analysis_runs r
        WHERE r.id = tracked_objects.analysis_run_id
          AND r.video_id = tracked_objects.video_id
          AND r.created_by = auth.uid()
      )
    )
  )
);

ALTER POLICY "Tracked object updates scoped to source" ON public.tracked_objects
USING (
  public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
  OR (
    EXISTS (
      SELECT 1 FROM public.video_assets v
      WHERE v.id = tracked_objects.video_id AND v.uploaded_by = auth.uid()
    )
    AND (
      tracked_objects.analysis_run_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.analysis_runs r
        WHERE r.id = tracked_objects.analysis_run_id
          AND r.video_id = tracked_objects.video_id
          AND r.created_by = auth.uid()
      )
    )
  )
)
WITH CHECK (
  public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
  OR (
    EXISTS (
      SELECT 1 FROM public.video_assets v
      WHERE v.id = tracked_objects.video_id AND v.uploaded_by = auth.uid()
    )
    AND (
      tracked_objects.analysis_run_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.analysis_runs r
        WHERE r.id = tracked_objects.analysis_run_id
          AND r.video_id = tracked_objects.video_id
          AND r.created_by = auth.uid()
      )
    )
  )
);

ALTER POLICY "Incident insertion requires owned analysis source" ON public.incidents
WITH CHECK (
  public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
  OR (
    incidents.video_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.video_assets v
      WHERE v.id = incidents.video_id AND v.uploaded_by = auth.uid()
    )
    AND (
      incidents.analysis_run_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.analysis_runs r
        WHERE r.id = incidents.analysis_run_id
          AND r.video_id = incidents.video_id
          AND r.created_by = auth.uid()
      )
    )
  )
);

-- A legacy insert rule had WITH CHECK(auth.role()='authenticated'), which
-- allowed all signed-in users to upload evidence, bypassing staff controls.
DROP POLICY IF EXISTS "Authenticated users can upload evidence" ON storage.objects;

-- SECURITY DEFINER triggers must not be publicly exposed via PostgREST RPC.
REVOKE EXECUTE ON FUNCTION public.handle_new_incident_case() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_settings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_privileged_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_video_asset_owner() FROM PUBLIC, anon, authenticated;

-- Keep the authenticated role helper and storage-info RPC available to
-- signed-in users, but revoke access for unsigned/anonymous callers.
REVOKE EXECUTE ON FUNCTION public.auth_user_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.video_asset_storage_info() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_asset_storage_info() TO authenticated, service_role;

-- Stabilize resolution paths noted in the Supabase security advisor.
ALTER FUNCTION public.get_analytics_summary(uuid,timestamptz,timestamptz,text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user_settings()
  SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()
  SET search_path = public, pg_temp;
NOTIFY pgrst, 'reload schema';
