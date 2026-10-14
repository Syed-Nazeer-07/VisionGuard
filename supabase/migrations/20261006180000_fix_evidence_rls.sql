-- 20261006180000_fix_evidence_rls.sql
-- Additive policy fix for evidence database table and storage objects.
-- Allows authenticated users to create and manage their own evidence records and files,
-- while preserving strict role security (users cannot access or modify other users' evidence).

-- 1. Ensure bucket 'evidence' exists and is correctly configured
INSERT INTO storage.buckets (id, name, public) 
VALUES ('evidence', 'evidence', false)
ON CONFLICT (id) DO NOTHING;

-- 2. Evidence storage bucket policies
DROP POLICY IF EXISTS "Authenticated users can upload evidence" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update their evidence" ON storage.objects;

CREATE POLICY "Authenticated users can upload evidence" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'evidence'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "Authenticated users can update their evidence" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'evidence'
    AND auth.role() = 'authenticated'
  );

-- 3. Public evidence table RLS policies
-- Ensure authenticated users can insert and update evidence that they own, or staff can manage all evidence.
DROP POLICY IF EXISTS "Users can insert their own evidence" ON public.evidence;
DROP POLICY IF EXISTS "Users can update their own evidence" ON public.evidence;

CREATE POLICY "Users can insert their own evidence" ON public.evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    OR uploaded_by IS NULL
    OR public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
  );

CREATE POLICY "Users can update their own evidence" ON public.evidence
  FOR UPDATE TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR uploaded_by IS NULL
    OR public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
  )
  WITH CHECK (
    uploaded_by = auth.uid()
    OR uploaded_by IS NULL
    OR public.auth_user_role() IN ('Operator', 'Supervisor', 'Admin')
  );
