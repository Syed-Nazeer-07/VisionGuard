-- 1. Create videos bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('videos', 'videos', true)
ON CONFLICT (id) DO NOTHING;

-- Bucket policies
CREATE POLICY "Videos are publicly accessible" ON storage.objects
  FOR SELECT USING (bucket_id = 'videos');

CREATE POLICY "Authenticated users can upload videos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'videos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update their videos" ON storage.objects
  FOR UPDATE USING (bucket_id = 'videos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete their videos" ON storage.objects
  FOR DELETE USING (bucket_id = 'videos' AND auth.role() = 'authenticated');

-- 2. Create video_assets table
CREATE TABLE IF NOT EXISTS public.video_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size BIGINT,
    duration NUMERIC,
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ DEFAULT now(),
    processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed', 'paused')),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS for video_assets
ALTER TABLE public.video_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read video_assets" ON public.video_assets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert video_assets" ON public.video_assets
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update video_assets" ON public.video_assets
  FOR UPDATE TO authenticated USING (true);

-- 3. Create tracked_objects table
CREATE TABLE IF NOT EXISTS public.tracked_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE,
    track_id INTEGER NOT NULL,
    object_type TEXT NOT NULL,
    confidence NUMERIC NOT NULL,
    first_seen_timestamp NUMERIC,
    last_seen_timestamp NUMERIC,
    frame_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast queries by video
CREATE INDEX IF NOT EXISTS idx_tracked_objects_video_id ON public.tracked_objects(video_id);

-- Enable RLS for tracked_objects
ALTER TABLE public.tracked_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read tracked_objects" ON public.tracked_objects
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert tracked_objects" ON public.tracked_objects
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update tracked_objects" ON public.tracked_objects
  FOR UPDATE TO authenticated USING (true);

-- 4. Alter existing tables to add video_id linking
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='incidents' AND column_name='video_id') THEN
        ALTER TABLE public.incidents ADD COLUMN video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='evidence' AND column_name='video_id') THEN
        ALTER TABLE public.evidence ADD COLUMN video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='violations' AND column_name='video_id') THEN
        ALTER TABLE public.violations ADD COLUMN video_id UUID REFERENCES public.video_assets(id) ON DELETE CASCADE;
    END IF;
END $$;
