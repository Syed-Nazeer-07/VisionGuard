-- =====================================================================
-- SCHEDULED REPORT EXECUTION SERVICE
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.report_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_report_id UUID REFERENCES public.scheduled_reports(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    error TEXT
);

ALTER TABLE public.reports 
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS file_size INTEGER,
  ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS scheduled_report_id UUID REFERENCES public.scheduled_reports(id) ON DELETE SET NULL;

-- Ensure RLS is enabled for report_executions
ALTER TABLE public.report_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view report executions" ON public.report_executions
  FOR SELECT TO authenticated
  USING (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

-- Edge function or service_role will handle inserts/updates for executions

-- Create reports bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('reports', 'reports', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Staff can read reports" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'reports' AND public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

-- Optionally setup pg_cron and pg_net to call the edge function if extensions are available
-- This is a best-effort setup for standard Supabase instances
DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AND 
     EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    
    -- Schedule the execution every hour
    PERFORM cron.schedule(
      'invoke-report-scheduler',
      '0 * * * *',
      $cron$
      SELECT net.http_post(
          url:='https://project-ref.supabase.co/functions/v1/report-scheduler',
          headers:=jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || current_setting('request.jwt.claim.role', true))
      )
      $cron$
    );
  END IF;
END $outer$;
