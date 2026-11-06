-- Read-only catalog assertions. Run AFTER the Phase 1 migration in staging.
-- These checks catch regressions to known allow-all policy names, but cannot
-- prove real permission behavior. Also test with multiple JWTs as documented.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('%I.%I: %s', schemaname, tablename, policyname), E'\n')
  INTO bad
  FROM pg_policies
  WHERE schemaname IN ('public', 'storage')
    AND (
      (tablename = 'video_assets' AND policyname IN
        ('Authenticated users can insert video_assets', 'Authenticated users can update video_assets'))
      OR (tablename = 'tracked_objects' AND policyname IN
        ('Authenticated users can insert tracked_objects', 'Authenticated users can update tracked_objects'))
      OR (tablename = 'storage.objects' AND policyname IN
        ('Authenticated users can update their videos', 'Authenticated users can delete their videos'))
      OR (tablename = 'objects' AND policyname IN
        ('Authenticated users can upload videos',
         'Authenticated users can update their videos',
         'Authenticated users can delete their videos',
         'Authenticated users can update their evidence'))
      OR (policyname IN
        ('Viewers can insert incidents for testing',
         'Viewers can insert violations for testing',
         'Viewers can insert analysis_runs for testing',
         'Viewers can insert evidence for testing',
         'Viewers can insert alerts for testing',
         'Users can insert their own evidence',
         'Users can update their own evidence'))
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unsafe legacy policies still exist: %', bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'video_assets'
      AND policyname = 'Video asset updates require ownership or staff')
    OR NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'incidents'
      AND policyname = 'Incident insertion requires owned analysis source')
    OR NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Video storage inserts require asset owner') THEN
    RAISE EXCEPTION 'Missing expected Phase 1 policies';
  END IF;
  RAISE NOTICE 'Phase 1 known-policy assertions passed';
END $$;
