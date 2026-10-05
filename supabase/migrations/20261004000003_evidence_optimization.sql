-- 20261004000003_evidence_optimization.sql

-- Add new columns to evidence table
ALTER TABLE public.evidence 
  ADD COLUMN IF NOT EXISTS incident_id UUID REFERENCES public.violations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_path TEXT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS capture_timestamp TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS upload_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Migrate old columns logic if needed (optional depending on use cases)
UPDATE public.evidence SET file_path = file_url WHERE file_path IS NULL;
UPDATE public.evidence SET mime_type = file_type WHERE mime_type IS NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_evidence_incident_id ON public.evidence(incident_id);
CREATE INDEX IF NOT EXISTS idx_evidence_status ON public.evidence(status);
CREATE INDEX IF NOT EXISTS idx_evidence_capture_timestamp ON public.evidence(capture_timestamp);

-- Realtime replication for queue workers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'evidence'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.evidence;
  END IF;
END $$;
