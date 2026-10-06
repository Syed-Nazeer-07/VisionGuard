-- Migration: 20261006033009_fix_analysis_pipeline.sql

DO $$
BEGIN
    -- Fix duplicate tracked_objects so unique constraint can be applied
    DELETE FROM public.tracked_objects
    WHERE id NOT IN (
        SELECT MIN(id::text)::uuid
        FROM public.tracked_objects
        GROUP BY COALESCE(video_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(camera_id, '00000000-0000-0000-0000-000000000000'::uuid), track_id
    );

    -- 1. Update analysis_runs table to match application
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='analysis_runs' AND column_name='camera_id' AND is_nullable='NO') THEN
        ALTER TABLE public.analysis_runs ALTER COLUMN camera_id DROP NOT NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='analysis_runs' AND column_name='video_id') THEN
        ALTER TABLE public.analysis_runs ADD COLUMN video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='analysis_runs' AND column_name='fps') THEN
        ALTER TABLE public.analysis_runs ADD COLUMN fps NUMERIC DEFAULT 0;
        ALTER TABLE public.analysis_runs ADD COLUMN latency NUMERIC DEFAULT 0;
        ALTER TABLE public.analysis_runs ADD COLUMN queue_depth INT DEFAULT 0;
        ALTER TABLE public.analysis_runs ADD COLUMN frames_processed INT DEFAULT 0;
        ALTER TABLE public.analysis_runs ADD COLUMN detections_generated INT DEFAULT 0;
        ALTER TABLE public.analysis_runs ADD COLUMN incidents_created INT DEFAULT 0;
        ALTER TABLE public.analysis_runs ADD COLUMN incidents_suppressed INT DEFAULT 0;
    END IF;

    -- Create analysis_logs if it failed earlier
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analysis_logs'
    ) THEN
        CREATE TABLE public.analysis_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE,
            camera_id UUID REFERENCES public.cameras(id) ON DELETE CASCADE,
            analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
            timestamp TIMESTAMPTZ DEFAULT now(),
            created_at TIMESTAMPTZ DEFAULT now(),
            category TEXT NOT NULL CHECK (category IN ('SYSTEM', 'UPLOAD', 'PROCESSING', 'MODEL', 'DETECTION', 'TRACKING', 'INCIDENT', 'EVIDENCE', 'PERSISTENCE', 'ERROR')),
            message TEXT NOT NULL,
            metadata JSONB DEFAULT '{}'::jsonb
        );
        CREATE INDEX idx_analysis_logs_video_id ON public.analysis_logs(video_id);
        CREATE INDEX idx_analysis_logs_camera_id ON public.analysis_logs(camera_id);
        CREATE INDEX idx_analysis_logs_run_id ON public.analysis_logs(analysis_run_id);
        CREATE INDEX idx_analysis_logs_timestamp ON public.analysis_logs(timestamp ASC);
        ALTER TABLE public.analysis_logs ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Allow authenticated read analysis_logs" ON public.analysis_logs FOR SELECT TO authenticated USING (true);
        CREATE POLICY "Allow authenticated insert analysis_logs" ON public.analysis_logs FOR INSERT TO authenticated WITH CHECK (true);
        CREATE POLICY "Allow authenticated delete analysis_logs" ON public.analysis_logs FOR DELETE TO authenticated USING (true);
    ELSE
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='analysis_logs' AND column_name='created_at') THEN
            ALTER TABLE public.analysis_logs ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
        END IF;
    END IF;

END $$;
