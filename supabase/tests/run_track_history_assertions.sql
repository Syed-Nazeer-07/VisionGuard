-- Read-only run-scoped uniqueness assertions; execute after migration in staging.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tracked_objects'::regclass
      AND conname = 'tracked_objects_analysis_run_id_track_id_key'
      AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'Missing run-scoped tracked_objects unique constraint';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tracked_objects'::regclass
      AND conname IN ('tracked_objects_video_id_track_id_key',
                      'tracked_objects_camera_id_track_id_key')
  ) THEN
    RAISE EXCEPTION 'Obsolete source-level unique constraints remain';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tracked_objects
    WHERE analysis_run_id IS NOT NULL
    GROUP BY analysis_run_id, track_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate track IDs within a run';
  END IF;

  RAISE NOTICE 'Run-scoped tracking schema assertions passed';
END $$;
