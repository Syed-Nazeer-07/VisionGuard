-- Migration: 20261005000002_video_processing_status_and_logs.sql
-- Description: Updates video_assets processing_status check constraint to support canonical upload lifecycle and adds persistent analysis_logs table.

DO $$
BEGIN
    -- 1. Update check constraint on public.video_assets.processing_status
    IF EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'video_assets'
    ) THEN
        ALTER TABLE public.video_assets 
            DROP CONSTRAINT IF EXISTS video_assets_processing_status_check;

        ALTER TABLE public.video_assets 
            ADD CONSTRAINT video_assets_processing_status_check 
            CHECK (processing_status IN ('pending', 'created', 'uploading', 'uploaded', 'processing', 'completed', 'failed', 'paused'));

        ALTER TABLE public.video_assets 
            ALTER COLUMN processing_status SET DEFAULT 'pending';
    END IF;
END $$;

-- 2. Create persistent analysis_logs table
CREATE TABLE IF NOT EXISTS public.analysis_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE,
    camera_id UUID REFERENCES public.cameras(id) ON DELETE CASCADE,
    analysis_run_id UUID REFERENCES public.analysis_runs(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT now(),
    category TEXT NOT NULL CHECK (category IN ('SYSTEM', 'UPLOAD', 'PROCESSING', 'MODEL', 'DETECTION', 'TRACKING', 'INCIDENT', 'EVIDENCE', 'PERSISTENCE', 'ERROR')),
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_analysis_logs_video_id ON public.analysis_logs(video_id);
CREATE INDEX IF NOT EXISTS idx_analysis_logs_camera_id ON public.analysis_logs(camera_id);
CREATE INDEX IF NOT EXISTS idx_analysis_logs_run_id ON public.analysis_logs(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_analysis_logs_timestamp ON public.analysis_logs(timestamp ASC);

-- Enable RLS
ALTER TABLE public.analysis_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read analysis_logs" ON public.analysis_logs
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated insert analysis_logs" ON public.analysis_logs
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated delete analysis_logs" ON public.analysis_logs
    FOR DELETE TO authenticated USING (true);
