-- Executive Reporting & Intelligence Schema

-- 1. Scheduled Reports Table
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'Traffic', 'Incident', 'Case', 'Performance'
  frequency TEXT NOT NULL, -- 'Daily', 'Weekly', 'Monthly'
  format TEXT NOT NULL, -- 'PDF', 'CSV', 'Excel'
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of email strings
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_generated_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.scheduled_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Scheduled reports readable by all staff" 
ON public.scheduled_reports FOR SELECT TO authenticated USING (true);

CREATE POLICY "Scheduled reports modifiable by staff" 
ON public.scheduled_reports FOR ALL TO authenticated 
USING (auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));
