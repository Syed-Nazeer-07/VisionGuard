-- Migration: 20261005000001_live_camera_analysis.sql
-- Description: Extends tracked_objects, incidents, and evidence tables for live camera persistence and analysis run tracking.

DO $$
BEGIN
    -- Remove duplicate (video_id, track_id) rows so the unique constraint below can be applied.
    -- Keeps the most recent row per pair; rows without a video_id are untouched.
    DELETE FROM public.tracked_objects t
    WHERE t.video_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.tracked_objects d
        WHERE d.video_id = t.video_id
          AND d.track_id = t.track_id
          AND (COALESCE(d.created_at, 'epoch'::timestamptz), d.id) > (COALESCE(t.created_at, 'epoch'::timestamptz), t.id)
      );

    -- 1. Add camera_id and analysis_run_id to tracked_objects
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tracked_objects' AND column_name='camera_id') THEN
        ALTER TABLE public.tracked_objects ADD COLUMN camera_id UUID REFERENCES public.cameras(id) ON DELETE CASCADE;
        CREATE INDEX IF NOT EXISTS idx_tracked_objects_camera_id ON public.tracked_objects(camera_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tracked_objects' AND column_name='analysis_run_id') THEN
        ALTER TABLE public.tracked_objects ADD COLUMN analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_tracked_objects_analysis_run_id ON public.tracked_objects(analysis_run_id);
    END IF;

    -- Add unique constraints for upsert on conflict
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_objects_camera_id_track_id_key') THEN
        ALTER TABLE public.tracked_objects ADD CONSTRAINT tracked_objects_camera_id_track_id_key UNIQUE (camera_id, track_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracked_objects_video_id_track_id_key') THEN
        ALTER TABLE public.tracked_objects ADD CONSTRAINT tracked_objects_video_id_track_id_key UNIQUE (video_id, track_id);
    END IF;

    -- 2. Add analysis_run_id, violation_type, track_id, and confidence to incidents
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='incidents' AND column_name='analysis_run_id') THEN
        ALTER TABLE public.incidents ADD COLUMN analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_incidents_analysis_run_id ON public.incidents(analysis_run_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='incidents' AND column_name='violation_type') THEN
        ALTER TABLE public.incidents ADD COLUMN violation_type TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='incidents' AND column_name='track_id') THEN
        ALTER TABLE public.incidents ADD COLUMN track_id INT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='incidents' AND column_name='confidence') THEN
        ALTER TABLE public.incidents ADD COLUMN confidence NUMERIC;
    END IF;

    -- 3. Add analysis_run_id to evidence
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='evidence' AND column_name='analysis_run_id') THEN
        ALTER TABLE public.evidence ADD COLUMN analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_evidence_analysis_run_id ON public.evidence(analysis_run_id);
    END IF;

    -- 4. Ensure violations camera_id can be nullable for video uploads
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='violations' AND column_name='camera_id' AND is_nullable='NO') THEN
        ALTER TABLE public.violations ALTER COLUMN camera_id DROP NOT NULL;
    END IF;
END $$;
