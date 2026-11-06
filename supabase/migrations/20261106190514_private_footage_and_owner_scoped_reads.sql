-- Verified on real VisionGuard staging Supabase project (Mumbai).
-- Supabase video objects are private; web playback uses 1-hour signed URLs.
-- Owner-scoped reads prevent one Viewer from browsing others' footage.

UPDATE storage.buckets SET public = false WHERE id = 'videos';
DROP POLICY IF EXISTS "Videos are publicly accessible" ON storage.objects;
CREATE POLICY "Videos require authorized reader" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'videos' AND public.can_manage_video_storage_object(name));

ALTER POLICY "Authenticated users can read video_assets" ON public.video_assets
USING (
  uploaded_by = auth.uid()
  OR public.auth_user_role() IN ('Operator','Supervisor','Admin')
);
ALTER POLICY "Analysis runs readable by all" ON public.analysis_runs
USING (
  public.auth_user_role() IN ('Operator','Supervisor','Admin')
  OR created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.video_assets v
    WHERE v.id = analysis_runs.video_id AND v.uploaded_by = auth.uid()
  )
);
ALTER POLICY "Authenticated users can read tracked_objects" ON public.tracked_objects
USING (
  public.auth_user_role() IN ('Operator','Supervisor','Admin')
  OR EXISTS (
    SELECT 1 FROM public.video_assets v
    WHERE v.id = tracked_objects.video_id AND v.uploaded_by = auth.uid()
  )
);
ALTER POLICY "Incidents are readable by all" ON public.incidents
USING (
  public.auth_user_role() IN ('Operator','Supervisor','Admin')
  OR EXISTS (
    SELECT 1 FROM public.video_assets v
    WHERE v.id = incidents.video_id AND v.uploaded_by = auth.uid()
  )
);
ALTER POLICY "Evidence readable by all" ON public.evidence
USING (
  public.auth_user_role() IN ('Operator','Supervisor','Admin')
  OR uploaded_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.video_assets v
    WHERE v.id = evidence.video_id AND v.uploaded_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Evidence is readable by all authenticated users" ON storage.objects;
CREATE POLICY "Evidence objects require uploader or staff" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'evidence'
    AND (
      public.auth_user_role() IN ('Operator','Supervisor','Admin')
      OR EXISTS (
        SELECT 1 FROM public.evidence e
        WHERE e.file_path = storage.objects.name
          AND e.uploaded_by = auth.uid()
      )
    )
  );

-- No privileged bypass: metadata enumeration honors the new owner RLS.
ALTER FUNCTION public.video_asset_storage_info() SECURITY INVOKER;
NOTIFY pgrst, 'reload schema';
