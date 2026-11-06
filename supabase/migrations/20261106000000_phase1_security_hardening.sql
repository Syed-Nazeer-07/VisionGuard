-- Phase 1: replace broad development policies with ownership/role-scoped access.
-- Apply after 20261006180000_fix_evidence_rls.sql.
-- IMPORTANT: review the impact with Viewer/Operator/Supervisor/Admin accounts before deploying.

-- RLS policies are PERMISSIVE by default (combined with OR). Remove the legacy
-- broad policies; adding a restrictive-looking policy alone would not be enough.

-- Video assets: viewers can create/update their own assets; staff can manage
-- existing assets. The uploader cannot be changed by a normal account.
ALTER TABLE public.video_assets ALTER COLUMN uploaded_by SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "Authenticated users can insert video_assets" ON public.video_assets;
DROP POLICY IF EXISTS "Authenticated users can update video_assets" ON public.video_assets;
CREATE POLICY "Video asset creation requires ownership" ON public.video_assets
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.auth_user_role() IS NOT NULL
  );
CREATE POLICY "Video asset updates require ownership or staff" ON public.video_assets
  FOR UPDATE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
  )
  WITH CHECK (
    uploaded_by = auth.uid()
    OR public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
  );

-- Prevent an uploader from changing the owner of an existing video. Admin
-- reassignment is permitted; service-role maintenance remains possible.
CREATE OR REPLACE FUNCTION public.protect_video_asset_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
     AND public.auth_user_role() IS DISTINCT FROM 'Admin' THEN
    RAISE EXCEPTION 'Only an administrator may transfer video ownership'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_video_asset_owner ON public.video_assets;
CREATE TRIGGER protect_video_asset_owner
  BEFORE UPDATE ON public.video_assets FOR EACH ROW
  EXECUTE FUNCTION public.protect_video_asset_owner();

-- Tracking rows must belong to a video the caller owns or an analysis run the
-- caller created. Camera-only tracking remains a staff operation.
DROP POLICY IF EXISTS "Authenticated users can insert tracked_objects" ON public.tracked_objects;
DROP POLICY IF EXISTS "Authenticated users can update tracked_objects" ON public.tracked_objects;
CREATE POLICY "Tracked object insertion scoped to source" ON public.tracked_objects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    OR (
      video_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.video_assets v
                  WHERE v.id = video_id AND v.uploaded_by = auth.uid())
    )
  );
CREATE POLICY "Tracked object updates scoped to source" ON public.tracked_objects
  FOR UPDATE TO authenticated
  USING (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    OR EXISTS (SELECT 1 FROM public.video_assets v
               WHERE v.id = video_id AND v.uploaded_by = auth.uid())
  )
  WITH CHECK (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    OR EXISTS (SELECT 1 FROM public.video_assets v
               WHERE v.id = video_id AND v.uploaded_by = auth.uid())
  );

-- Drop the development-era allow-all INSERTs. Live analysis can still write an
-- incident when it belongs to its own analysis run or uploaded video.
DROP POLICY IF EXISTS "Viewers can insert incidents for testing" ON public.incidents;
DROP POLICY IF EXISTS "Viewers can insert violations for testing" ON public.violations;
DROP POLICY IF EXISTS "Viewers can insert analysis_runs for testing" ON public.analysis_runs;
DROP POLICY IF EXISTS "Viewers can insert evidence for testing" ON public.evidence;
DROP POLICY IF EXISTS "Viewers can insert alerts for testing" ON public.alerts;

CREATE POLICY "Incident insertion requires owned analysis source" ON public.incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    OR (
      analysis_run_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.analysis_runs r
                  WHERE r.id = analysis_run_id AND r.created_by = auth.uid())
    )
    OR (
      video_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.video_assets v
                  WHERE v.id = video_id AND v.uploaded_by = auth.uid())
    )
  );

CREATE POLICY "Analysis run insertion requires source ownership" ON public.analysis_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    OR (
      created_by = auth.uid()
      AND video_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.video_assets v
                  WHERE v.id = video_id AND v.uploaded_by = auth.uid())
    )
  );

-- Evidence rows: do not let a Viewer claim an unowned/null uploaded_by value.
DROP POLICY IF EXISTS "Users can insert their own evidence" ON public.evidence;
DROP POLICY IF EXISTS "Users can update their own evidence" ON public.evidence;
CREATE POLICY "Evidence insertion requires uploader" ON public.evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    OR (
      uploaded_by = auth.uid()
      AND (
        incident_id IS NULL OR EXISTS (
          SELECT 1 FROM public.incidents i
          WHERE i.id = incident_id
          AND (
            EXISTS (SELECT 1 FROM public.analysis_runs r
                    WHERE r.id = i.analysis_run_id AND r.created_by = auth.uid())
            OR EXISTS (SELECT 1 FROM public.video_assets v
                       WHERE v.id = i.video_id AND v.uploaded_by = auth.uid())
          )
        )
      )
    )
  );
CREATE POLICY "Evidence updates require uploader" ON public.evidence
  FOR UPDATE TO authenticated
  USING (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    OR uploaded_by = auth.uid()
  )
  WITH CHECK (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    OR uploaded_by = auth.uid()
  );

-- The 20261006 migration enabled UPDATE to any evidence object by any user.
-- Existing folder layouts do not include a user id, so do not attempt to infer
-- storage ownership from filenames. Allow Viewer INSERT but only staff UPDATE.
DROP POLICY IF EXISTS "Authenticated users can update their evidence" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update evidence" ON storage.objects;
CREATE POLICY "Staff can update evidence" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'evidence' AND public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'))
  WITH CHECK (bucket_id = 'evidence' AND public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

-- Remove broad bucket-wide overwrites and deletes of OTHER users' videos.
-- Existing public playback is unchanged in this migration; converting the
-- public videos bucket to private requires signed-URL client changes first.
DROP POLICY IF EXISTS "Authenticated users can upload videos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update their videos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their videos" ON storage.objects;
CREATE POLICY "Video storage inserts require asset owner" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'videos' AND EXISTS (
      SELECT 1 FROM public.video_assets v
      WHERE v.id::text = split_part(name, '/', 1)
        AND v.uploaded_by = auth.uid()
    )
  );
CREATE POLICY "Video storage updates require asset owner" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'videos' AND EXISTS (
      SELECT 1 FROM public.video_assets v
      WHERE v.storage_path = name AND
        (v.uploaded_by = auth.uid() OR public.auth_user_role() IN ('Supervisor', 'Admin'))
    )
  )
  WITH CHECK (
    bucket_id = 'videos' AND EXISTS (
      SELECT 1 FROM public.video_assets v
      WHERE v.storage_path = name AND
        (v.uploaded_by = auth.uid() OR public.auth_user_role() IN ('Supervisor', 'Admin'))
    )
  );
CREATE POLICY "Video storage deletions require asset owner" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'videos' AND EXISTS (
      SELECT 1 FROM public.video_assets v
      WHERE v.storage_path = name AND
        (v.uploaded_by = auth.uid() OR public.auth_user_role() IN ('Supervisor', 'Admin'))
    )
  );

-- Legacy records and storage permissions intentionally stay readable here.
-- A later migration should align SELECT visibility with the desired privacy model.
