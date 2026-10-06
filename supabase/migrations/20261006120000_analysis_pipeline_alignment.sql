-- Migration: 20261006120000_analysis_pipeline_alignment.sql
-- Description: Aligns the live schema with the application's analysis pipeline. Written against the
-- schema as it exists after 20261006033009 (verified on the linked project), and idempotent so it is
-- also safe on databases where earlier 20261005* migrations only partially applied.
--
--   analysis_runs   : camera_id nullable, video_id + metric columns, created_by, owner-update policy
--   tracked_objects : camera_id / analysis_run_id, de-duplication, upsert unique keys
--   incidents       : analysis_run_id / violation_type / track_id / confidence / metadata (media_time, speed, OCR)
--   evidence        : video_id / analysis_run_id
--   video_assets    : canonical processing_status, uploaded_by default, stable display_number,
--                     owner/supervisor delete policy
--   analysis_logs   : table, created_at, RLS (read/insert for authenticated, delete for Supervisor/Admin)

-- ---------------------------------------------------------------------------
-- 1. analysis_runs
-- ---------------------------------------------------------------------------
ALTER TABLE public.analysis_runs ALTER COLUMN camera_id DROP NOT NULL;

ALTER TABLE public.analysis_runs
    ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS fps NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS latency NUMERIC NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS queue_depth INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS frames_processed INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS detections_generated INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS incidents_created INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS incidents_suppressed INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid();

-- Legacy rows stored the uploaded video id inside metrics JSON; promote it to the real column.
UPDATE public.analysis_runs ar
SET video_id = va.id
FROM public.video_assets va
WHERE ar.video_id IS NULL
  AND va.id::text = ar.metrics->>'video_id';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analysis_runs_source_check') THEN
        ALTER TABLE public.analysis_runs
            ADD CONSTRAINT analysis_runs_source_check
            CHECK (camera_id IS NOT NULL OR video_id IS NOT NULL) NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_analysis_runs_video_id ON public.analysis_runs(video_id);

-- Any authenticated user may already INSERT runs (viewer_testability). Without this, a non-staff user
-- could create a run but never update its metrics or close it. Ownership-scoped; no role escalation.
DROP POLICY IF EXISTS "Users can update own analysis runs" ON public.analysis_runs;
CREATE POLICY "Users can update own analysis runs" ON public.analysis_runs
    FOR UPDATE TO authenticated
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. tracked_objects
-- ---------------------------------------------------------------------------
ALTER TABLE public.tracked_objects
    ADD COLUMN IF NOT EXISTS camera_id UUID REFERENCES public.cameras(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracked_objects_camera_id ON public.tracked_objects(camera_id);
CREATE INDEX IF NOT EXISTS idx_tracked_objects_analysis_run_id ON public.tracked_objects(analysis_run_id);

-- Keep only the most recent row per (video_id, track_id) and per (camera_id, track_id).
DELETE FROM public.tracked_objects t
WHERE t.video_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.tracked_objects d
    WHERE d.video_id = t.video_id AND d.track_id = t.track_id
      AND (COALESCE(d.created_at, 'epoch'::timestamptz), d.id) > (COALESCE(t.created_at, 'epoch'::timestamptz), t.id)
  );

DELETE FROM public.tracked_objects t
WHERE t.camera_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.tracked_objects d
    WHERE d.camera_id = t.camera_id AND d.track_id = t.track_id
      AND (COALESCE(d.created_at, 'epoch'::timestamptz), d.id) > (COALESCE(t.created_at, 'epoch'::timestamptz), t.id)
  );

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_objects_video_id_track_id_key') THEN
        ALTER TABLE public.tracked_objects ADD CONSTRAINT tracked_objects_video_id_track_id_key UNIQUE (video_id, track_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_objects_camera_id_track_id_key') THEN
        ALTER TABLE public.tracked_objects ADD CONSTRAINT tracked_objects_camera_id_track_id_key UNIQUE (camera_id, track_id);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. incidents / evidence / violations
-- ---------------------------------------------------------------------------
ALTER TABLE public.incidents
    ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS violation_type TEXT,
    ADD COLUMN IF NOT EXISTS track_id INTEGER,
    ADD COLUMN IF NOT EXISTS confidence NUMERIC,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_incidents_video_id ON public.incidents(video_id);
CREATE INDEX IF NOT EXISTS idx_incidents_analysis_run_id ON public.incidents(analysis_run_id);

ALTER TABLE public.evidence
    ADD COLUMN IF NOT EXISTS video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_video_id ON public.evidence(video_id);
CREATE INDEX IF NOT EXISTS idx_evidence_analysis_run_id ON public.evidence(analysis_run_id);

ALTER TABLE public.violations ALTER COLUMN camera_id DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. video_assets
-- ---------------------------------------------------------------------------
-- processing_status is the analysis lifecycle only; upload progress lives in metadata.upload_status.
ALTER TABLE public.video_assets DROP CONSTRAINT IF EXISTS video_assets_processing_status_check;
UPDATE public.video_assets
SET processing_status = 'pending'
WHERE processing_status IS NULL
   OR processing_status NOT IN ('pending', 'processing', 'completed', 'failed', 'paused');
ALTER TABLE public.video_assets
    ADD CONSTRAINT video_assets_processing_status_check
    CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed', 'paused'));
ALTER TABLE public.video_assets ALTER COLUMN processing_status SET DEFAULT 'pending';

ALTER TABLE public.video_assets ALTER COLUMN uploaded_by SET DEFAULT auth.uid();

-- Stable, human-facing numbering ("Video 1", "Video 2", ...). Assigned once by the database at insert
-- time and never renumbered, so names stay tied to the asset even after other videos are deleted.
CREATE SEQUENCE IF NOT EXISTS public.video_assets_display_number_seq;
ALTER TABLE public.video_assets ADD COLUMN IF NOT EXISTS display_number INTEGER;

WITH numbered AS (
    SELECT id,
           (SELECT COALESCE(MAX(display_number), 0) FROM public.video_assets)
             + ROW_NUMBER() OVER (ORDER BY uploaded_at NULLS FIRST, id) AS n
    FROM public.video_assets
    WHERE display_number IS NULL
)
UPDATE public.video_assets va SET display_number = numbered.n
FROM numbered WHERE va.id = numbered.id;

SELECT setval('public.video_assets_display_number_seq',
              GREATEST(COALESCE((SELECT MAX(display_number) FROM public.video_assets), 0), 1),
              (SELECT MAX(display_number) IS NOT NULL FROM public.video_assets));

ALTER SEQUENCE public.video_assets_display_number_seq OWNED BY public.video_assets.display_number;
ALTER TABLE public.video_assets ALTER COLUMN display_number SET DEFAULT nextval('public.video_assets_display_number_seq');
GRANT USAGE, SELECT ON SEQUENCE public.video_assets_display_number_seq TO authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS idx_video_assets_display_number ON public.video_assets(display_number);

-- Previously no DELETE policy existed, so Video Library deletes were silently filtered by RLS.
DROP POLICY IF EXISTS "Owners and supervisors can delete video_assets" ON public.video_assets;
CREATE POLICY "Owners and supervisors can delete video_assets" ON public.video_assets
    FOR DELETE TO authenticated
    USING (uploaded_by = auth.uid() OR public.auth_user_role() IN ('Supervisor', 'Admin'));

-- ---------------------------------------------------------------------------
-- 5. analysis_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analysis_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE,
    camera_id UUID REFERENCES public.cameras(id) ON DELETE CASCADE,
    analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
    category TEXT NOT NULL CHECK (category IN ('SYSTEM', 'UPLOAD', 'PROCESSING', 'MODEL', 'DETECTION', 'TRACKING', 'INCIDENT', 'EVIDENCE', 'PERSISTENCE', 'ERROR')),
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.analysis_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_analysis_logs_video_id ON public.analysis_logs(video_id);
CREATE INDEX IF NOT EXISTS idx_analysis_logs_camera_id ON public.analysis_logs(camera_id);
CREATE INDEX IF NOT EXISTS idx_analysis_logs_run_id ON public.analysis_logs(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_analysis_logs_timestamp ON public.analysis_logs(timestamp ASC);

ALTER TABLE public.analysis_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.analysis_logs TO authenticated;

DROP POLICY IF EXISTS "Allow authenticated read analysis_logs" ON public.analysis_logs;
CREATE POLICY "Allow authenticated read analysis_logs" ON public.analysis_logs
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert analysis_logs" ON public.analysis_logs;
CREATE POLICY "Allow authenticated insert analysis_logs" ON public.analysis_logs
    FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Allow authenticated delete analysis_logs" ON public.analysis_logs;
DROP POLICY IF EXISTS "Supervisors can delete analysis_logs" ON public.analysis_logs;
CREATE POLICY "Supervisors can delete analysis_logs" ON public.analysis_logs
    FOR DELETE TO authenticated
    USING (public.auth_user_role() IN ('Supervisor', 'Admin'));

-- Make PostgREST pick up the new relation/columns immediately (fixes the /rest/v1/analysis_logs 404).
NOTIFY pgrst, 'reload schema';
