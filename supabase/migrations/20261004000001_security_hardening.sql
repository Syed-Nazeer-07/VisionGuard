-- =====================================================================
-- SECURITY HARDENING (Production-readiness audit: S1–S7, data integrity)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. One-time role reconciliation (before switching the source of truth)
--    Legacy 'Authority' -> 'Operator'. Preserve elevated roles that were
--    previously only present in user_metadata so existing staff keep access.
-- ---------------------------------------------------------------------
UPDATE public.profiles SET role = 'Operator' WHERE role = 'Authority';

UPDATE public.profiles p
SET role = CASE WHEN u.raw_user_meta_data->>'role' = 'Authority' THEN 'Operator'
                ELSE u.raw_user_meta_data->>'role' END
FROM auth.users u
WHERE p.id = u.id
  AND p.role = 'Viewer'
  AND u.raw_user_meta_data->>'role' IN ('Authority', 'Operator', 'Supervisor', 'Admin');

UPDATE public.profiles SET role = 'Viewer'
WHERE role NOT IN ('Viewer', 'Operator', 'Supervisor', 'Admin');

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('Viewer', 'Operator', 'Supervisor', 'Admin'));

-- ---------------------------------------------------------------------
-- 1. S1/S3: Role comes from public.profiles (server-controlled), never from
--    user-editable JWT user_metadata. Disabled accounts resolve to NULL,
--    which fails every role-gated policy.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
    AND COALESCE(status, 'Active') <> 'Disabled'
$$;

REVOKE ALL ON FUNCTION public.auth_user_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_role() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. S1: New users ALWAYS start as Viewer, regardless of signup metadata.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, email, name, organization)
  VALUES (
    NEW.id,
    'Viewer',
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'organization'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 3. S2: Only Admins (or the service role) may change role/status.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() is NULL for service-role / migrations: allowed.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status)
     AND COALESCE(public.auth_user_role(), '') <> 'Admin' THEN
    RAISE EXCEPTION 'Only administrators can change role or status'
      USING ERRCODE = '42501';
  END IF;

  -- Admins cannot lock themselves out.
  IF NEW.id = auth.uid() AND (NEW.role <> 'Admin' OR NEW.status = 'Disabled')
     AND OLD.role = 'Admin' THEN
    RAISE EXCEPTION 'Administrators cannot demote or disable their own account'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_privileged_columns ON public.profiles;
CREATE TRIGGER protect_profile_privileged_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_columns();

-- S7: users may create ONLY their own profile, and only as Viewer.
DROP POLICY IF EXISTS "Users can insert own viewer profile" ON public.profiles;
CREATE POLICY "Users can insert own viewer profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id AND role = 'Viewer');

-- ---------------------------------------------------------------------
-- 4. S4: Replace all policies that referenced the removed 'Authority' role.
-- ---------------------------------------------------------------------

-- Cameras: staff create/edit (soft delete = update); hard delete Admin only.
DROP POLICY IF EXISTS "Authorities and Admins can insert/update cameras" ON public.cameras;
CREATE POLICY "Staff can insert cameras" ON public.cameras
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));
CREATE POLICY "Staff can update cameras" ON public.cameras
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'))
  WITH CHECK (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));
CREATE POLICY "Admins can delete cameras" ON public.cameras
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'Admin');

DROP POLICY IF EXISTS "Authorities and Admins can modify scene profiles" ON public.scene_profiles;
CREATE POLICY "Staff can modify scene profiles" ON public.scene_profiles
  FOR ALL TO authenticated
  USING (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'))
  WITH CHECK (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

DROP POLICY IF EXISTS "Authorities and Admins can modify analysis runs" ON public.analysis_runs;
CREATE POLICY "Staff can modify analysis runs" ON public.analysis_runs
  FOR ALL TO authenticated
  USING (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'))
  WITH CHECK (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

DROP POLICY IF EXISTS "Authorities and Admins can modify violations" ON public.violations;
CREATE POLICY "Staff can modify violations" ON public.violations
  FOR ALL TO authenticated
  USING (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'))
  WITH CHECK (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

DROP POLICY IF EXISTS "Authorities and Admins can insert traffic stats" ON public.traffic_stats;
CREATE POLICY "Staff can insert traffic stats" ON public.traffic_stats
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

-- Alerts (S4 + S6): staff only, no more open inserts.
DROP POLICY IF EXISTS "Authorities and Admins can modify alerts" ON public.alerts;
DROP POLICY IF EXISTS "Authorities and Admins can update alerts" ON public.alerts;
DROP POLICY IF EXISTS "Anyone can insert alerts via triggers/API" ON public.alerts;
CREATE POLICY "Staff can insert alerts" ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));
CREATE POLICY "Staff can update alerts" ON public.alerts
  FOR UPDATE TO authenticated
  USING (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'))
  WITH CHECK (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));
CREATE POLICY "Admins can delete alerts" ON public.alerts
  FOR DELETE TO authenticated
  USING (public.auth_user_role() = 'Admin');

-- Evidence storage bucket.
DROP POLICY IF EXISTS "Authorities and Admins can upload evidence" ON storage.objects;
DROP POLICY IF EXISTS "Authorities and Admins can update evidence" ON storage.objects;
DROP POLICY IF EXISTS "Authorities and Admins can delete evidence" ON storage.objects;
CREATE POLICY "Staff can upload evidence" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'evidence' AND public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));
CREATE POLICY "Staff can update evidence" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'evidence' AND public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));
CREATE POLICY "Supervisors and Admins can delete evidence" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'evidence' AND public.auth_user_role() IN ('Supervisor', 'Admin'));

-- System settings: staff can read (pipeline needs it), Admin writes.
DROP POLICY IF EXISTS "Enable read for Authority and Admin" ON public.system_settings;
CREATE POLICY "Staff can read system settings" ON public.system_settings
  FOR SELECT TO authenticated
  USING (public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin'));

-- ---------------------------------------------------------------------
-- 5. S6: Case timeline entries must be authored by the caller, staff only.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Case events insertable by staff" ON public.case_events;
CREATE POLICY "Case events insertable by staff" ON public.case_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    AND actor_id = auth.uid()
  );

DROP POLICY IF EXISTS "Case notes insertable by staff" ON public.case_notes;
CREATE POLICY "Case notes insertable by staff" ON public.case_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
    AND author_id = auth.uid()
  );

ALTER TABLE public.case_notes DROP CONSTRAINT IF EXISTS case_notes_note_length;
ALTER TABLE public.case_notes
  ADD CONSTRAINT case_notes_note_length CHECK (char_length(note) BETWEEN 1 AND 5000) NOT VALID;

-- Audit logs must be attributed to the caller (already enforced) — add an
-- FK to profiles so PostgREST can embed profiles(name, email).
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_profile_fkey;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_user_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;

-- ---------------------------------------------------------------------
-- 6. Data integrity: cases.updated_at maintained by trigger.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cases_set_updated_at ON public.cases;
CREATE TRIGGER cases_set_updated_at
  BEFORE UPDATE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Harden the incident->case trigger function.
CREATE OR REPLACE FUNCTION public.handle_new_incident_case()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.cases (incident_id, status) VALUES (NEW.id, 'New');
  RETURN NEW;
END;
$$;

-- Backfill: incidents created before the case trigger existed get a case.
INSERT INTO public.cases (incident_id, status, created_at, updated_at)
SELECT i.id, 'New', i.created_at, i.created_at
FROM public.incidents i
WHERE NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.incident_id = i.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_incident_id_unique ON public.cases(incident_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON public.cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_created_at ON public.cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON public.incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_camera_id ON public.incidents(camera_id);

-- ---------------------------------------------------------------------
-- 7. Realtime: add operational tables to the publication (idempotent).
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cameras', 'incidents', 'cases', 'case_notes', 'case_events', 'evidence', 'alerts', 'profiles']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
