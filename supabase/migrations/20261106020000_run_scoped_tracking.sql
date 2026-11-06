-- Fix history corruption when the same source is analyzed multiple times.
--
-- Previously UNIQUE(video_id, track_id) / UNIQUE(camera_id, track_id) caused
-- upserts from newer runs to UPDATE track rows owned by earlier runs.
-- Tracker IDs are only stable *within* an analysis run, not across runs.
--
-- Preserve all existing rows and IDs: do not delete or rewrite old run data.
-- Rows with analysis_run_id NULL are legacy data and remain readable, but all
-- new application writes use (analysis_run_id, track_id).

BEGIN;

-- Fail safely rather than silently deleting historical tracks when the
-- destination unique constraint could not be created.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tracked_objects
    WHERE analysis_run_id IS NOT NULL
    GROUP BY analysis_run_id, track_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate run-scoped track identifiers exist; resolve them before applying this migration.';
  END IF;
END $$;

-- Build new per-run identity BEFORE dropping obsolete source-level uniqueness,
-- ensuring there is never a migration step without an upsert identity.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tracked_objects'::regclass
      AND conname = 'tracked_objects_analysis_run_id_track_id_key'
  ) THEN
    ALTER TABLE public.tracked_objects
      ADD CONSTRAINT tracked_objects_analysis_run_id_track_id_key
      UNIQUE (analysis_run_id, track_id);
  END IF;
END $$;

ALTER TABLE public.tracked_objects
  DROP CONSTRAINT IF EXISTS tracked_objects_video_id_track_id_key;
ALTER TABLE public.tracked_objects
  DROP CONSTRAINT IF EXISTS tracked_objects_camera_id_track_id_key;

-- Do not add a partial UNIQUE index for legacy NULL-run rows. The existing
-- analysis_run_id foreign key uses ON DELETE SET NULL; deleting two runs that
-- both have track #1 on a video would otherwise fail when both rows become
-- NULL-run records. Legacy rows remain readable without data loss.
DROP INDEX IF EXISTS public.idx_tracked_objects_legacy_video_track;
DROP INDEX IF EXISTS public.idx_tracked_objects_legacy_camera_track;

CREATE INDEX IF NOT EXISTS idx_tracked_objects_video_run
  ON public.tracked_objects(video_id, analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_tracked_objects_camera_run
  ON public.tracked_objects(camera_id, analysis_run_id);

COMMENT ON CONSTRAINT tracked_objects_analysis_run_id_track_id_key
  ON public.tracked_objects IS
  'Track IDs are unique per analysis run, not per video/camera; historical runs are independent.';

NOTIFY pgrst, 'reload schema';

COMMIT;
