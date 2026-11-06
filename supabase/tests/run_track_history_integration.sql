-- Integration fixture for a disposable PostgreSQL database, NOT live Supabase.
-- Run with: psql -X -v ON_ERROR_STOP=1 -f supabase/tests/run_track_history_integration.sql
\set ON_ERROR_STOP on

CREATE TABLE public.analysis_runs (id UUID PRIMARY KEY);
INSERT INTO public.analysis_runs(id) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

CREATE TABLE public.tracked_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID,
  camera_id UUID,
  analysis_run_id UUID,
  track_id INTEGER NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.tracked_objects
  ADD CONSTRAINT tracked_objects_video_id_track_id_key UNIQUE (video_id, track_id);
ALTER TABLE public.tracked_objects
  ADD CONSTRAINT tracked_objects_camera_id_track_id_key UNIQUE (camera_id, track_id);

ALTER TABLE public.tracked_objects
  ADD CONSTRAINT tracked_objects_analysis_run_id_fkey
  FOREIGN KEY (analysis_run_id) REFERENCES public.analysis_runs(id) ON DELETE SET NULL;

-- Seed one old run plus an unrelated NULL-run legacy record.
INSERT INTO public.tracked_objects (video_id, analysis_run_id, track_id, metadata)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, '{"run":"old-a"}'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, '{"run":"old-a"}'),
  ('22222222-2222-2222-2222-222222222222', NULL, 1, '{"legacy":true}');

\i supabase/migrations/20261106020000_run_scoped_tracking.sql

-- Run B legitimately restarts its tracker at #1 on the SAME video.
INSERT INTO public.tracked_objects (video_id, analysis_run_id, track_id, metadata)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, '{"run":"new-b"}')
ON CONFLICT (analysis_run_id, track_id) DO UPDATE
  SET metadata = EXCLUDED.metadata;

-- Re-saving B updates only B, never A.
INSERT INTO public.tracked_objects (video_id, analysis_run_id, track_id, metadata)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, '{"run":"new-b","retry":true}')
ON CONFLICT (analysis_run_id, track_id) DO UPDATE
  SET metadata = EXCLUDED.metadata;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.tracked_objects) <> 4 THEN
    RAISE EXCEPTION 'Expected four independent tracks after two runs and one legacy row';
  END IF;
  IF (SELECT metadata->>'run' FROM public.tracked_objects
      WHERE analysis_run_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        AND track_id = 1) IS DISTINCT FROM 'old-a' THEN
    RAISE EXCEPTION 'Run A history was overwritten';
  END IF;
  IF (SELECT metadata->>'retry' FROM public.tracked_objects
      WHERE analysis_run_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        AND track_id = 1) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Run B re-save did not update its own track';
  END IF;
  IF (SELECT COUNT(*) FROM public.tracked_objects WHERE analysis_run_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'Legacy NULL-run tracking row was lost';
  END IF;
END $$;

\i supabase/tests/run_track_history_assertions.sql

-- Deleting two different runs must not collide on the same source/track ID
-- when the existing foreign key turns both sets of rows into NULL-run data.
DELETE FROM public.analysis_runs
WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM public.tracked_objects
      WHERE video_id = '11111111-1111-1111-1111-111111111111'
        AND analysis_run_id IS NULL AND track_id = 1) <> 2 THEN
    RAISE EXCEPTION 'Deleting runs damaged or rejected surviving history';
  END IF;
END $$;

-- Re-applying the additive migration must remain safe.
\i supabase/migrations/20261106020000_run_scoped_tracking.sql
\i supabase/tests/run_track_history_assertions.sql

SELECT 'Run history migration integration test passed' AS result;
