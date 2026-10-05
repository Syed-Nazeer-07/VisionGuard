-- Allow any authenticated user to generate data from Live Analysis (incidents, violations, analysis_runs, evidence, alerts)
DROP POLICY IF EXISTS "Viewers can insert incidents for testing" ON public.incidents;
DROP POLICY IF EXISTS "Viewers can insert violations for testing" ON public.violations;
DROP POLICY IF EXISTS "Viewers can insert analysis_runs for testing" ON public.analysis_runs;
DROP POLICY IF EXISTS "Viewers can insert evidence for testing" ON public.evidence;
DROP POLICY IF EXISTS "Viewers can insert alerts for testing" ON public.alerts;

CREATE POLICY "Viewers can insert incidents for testing" ON public.incidents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Viewers can insert violations for testing" ON public.violations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Viewers can insert analysis_runs for testing" ON public.analysis_runs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Viewers can insert evidence for testing" ON public.evidence FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Viewers can insert alerts for testing" ON public.alerts FOR INSERT TO authenticated WITH CHECK (true);

-- Evidence produced by Live Analysis is linked to incidents (not legacy violations)
ALTER TABLE public.evidence DROP CONSTRAINT IF EXISTS evidence_incident_id_fkey;
ALTER TABLE public.evidence
  ADD CONSTRAINT evidence_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id) ON DELETE SET NULL NOT VALID;
