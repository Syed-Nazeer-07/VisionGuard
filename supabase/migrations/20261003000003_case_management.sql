-- Case Management & Evidence Schema

-- 1. Cases Table
CREATE TABLE IF NOT EXISTS public.cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES public.incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'New',
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Evidence Table
CREATE TABLE IF NOT EXISTS public.evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE,
  camera_id UUID REFERENCES public.cameras(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INT,
  confidence FLOAT,
  detection_type TEXT,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Case Notes Table
CREATE TABLE IF NOT EXISTS public.case_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Case Timeline (Events)
CREATE TABLE IF NOT EXISTS public.case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_events ENABLE ROW LEVEL SECURITY;

-- Cases: Readable by all, Modifiable by Operators/Supervisors/Admins
CREATE POLICY "Cases readable by all" ON public.cases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Cases modifiable by staff" ON public.cases FOR ALL TO authenticated USING (auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

-- Evidence: Readable by all, Modifiable by staff
CREATE POLICY "Evidence readable by all" ON public.evidence FOR SELECT TO authenticated USING (true);
CREATE POLICY "Evidence modifiable by staff" ON public.evidence FOR ALL TO authenticated USING (auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

-- Case Notes: Readable by all, Insertable by staff
CREATE POLICY "Case notes readable by all" ON public.case_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Case notes insertable by staff" ON public.case_notes FOR INSERT TO authenticated WITH CHECK (auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

-- Case Events: Readable by all, Insertable by system/staff
CREATE POLICY "Case events readable by all" ON public.case_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Case events insertable by staff" ON public.case_events FOR INSERT TO authenticated WITH CHECK (true);

-- Trigger to auto-create a Case when an Incident is created
CREATE OR REPLACE FUNCTION public.handle_new_incident_case()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.cases (incident_id, status)
  VALUES (NEW.id, 'New');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_incident_created
  AFTER INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_incident_case();
