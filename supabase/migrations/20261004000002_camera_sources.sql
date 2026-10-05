-- Add new columns for enterprise camera source and video ingestion

ALTER TABLE public.cameras
ADD COLUMN IF NOT EXISTS source_url TEXT,
ADD COLUMN IF NOT EXISTS storage_path TEXT,
ADD COLUMN IF NOT EXISTS stream_status TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS connection_error TEXT,
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
