-- Expand alerts table for Milestone 13
ALTER TABLE public.alerts
ADD COLUMN severity TEXT NOT NULL DEFAULT 'medium',
ADD COLUMN camera_id UUID REFERENCES public.cameras(id) ON DELETE SET NULL,
ADD COLUMN violation_id UUID REFERENCES public.violations(id) ON DELETE SET NULL,
ADD COLUMN status TEXT NOT NULL DEFAULT 'active',
ADD COLUMN acknowledged_at TIMESTAMPTZ,
ADD COLUMN resolved_at TIMESTAMPTZ,
ADD COLUMN acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Enable RLS and add policies for alerts (if not already present or updated)
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if we want to replace them, but we'll just add new ones using DO block
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'alerts' AND policyname = 'Alerts are readable by all authenticated users') THEN
        CREATE POLICY "Alerts are readable by all authenticated users" 
        ON public.alerts FOR SELECT 
        TO authenticated 
        USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'alerts' AND policyname = 'Authorities and Admins can update alerts') THEN
        CREATE POLICY "Authorities and Admins can update alerts" 
        ON public.alerts FOR UPDATE 
        TO authenticated 
        USING (auth_user_role() IN ('Authority', 'Admin'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'alerts' AND policyname = 'Anyone can insert alerts via triggers/API') THEN
        CREATE POLICY "Anyone can insert alerts via triggers/API" 
        ON public.alerts FOR INSERT 
        TO authenticated 
        WITH CHECK (true);
    END IF;
END $$;
