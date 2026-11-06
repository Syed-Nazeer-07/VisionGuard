-- Disposable PostgreSQL 16 fixture, NOT a live Supabase database.
-- Run with: psql -X -v ON_ERROR_STOP=1 -f supabase/tests/security_policy_integration.sql
\set ON_ERROR_STOP on

CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE SCHEMA storage;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE FUNCTION public.auth_user_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('visionguard.role', true), '');
$$;

CREATE TABLE public.video_assets (
  id uuid PRIMARY KEY,
  uploaded_by uuid
);
CREATE TABLE public.analysis_runs (
  id uuid PRIMARY KEY,
  video_id uuid,
  created_by uuid
);
CREATE TABLE public.tracked_objects (
  id uuid PRIMARY KEY,
  video_id uuid,
  analysis_run_id uuid,
  track_id int
);
CREATE TABLE public.incidents (
  id uuid PRIMARY KEY,
  video_id uuid,
  analysis_run_id uuid
);
CREATE TABLE public.evidence (
  id uuid PRIMARY KEY,
  uploaded_by uuid,
  incident_id uuid
);
CREATE TABLE public.violations (id uuid PRIMARY KEY);
CREATE TABLE public.alerts (id uuid PRIMARY KEY);
CREATE TABLE storage.objects (
  name text PRIMARY KEY,
  bucket_id text NOT NULL
);

GRANT USAGE ON SCHEMA auth, storage TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_role() TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public, storage TO authenticated;

ALTER TABLE public.video_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracked_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Live Supabase has multiple migrations with SELECT policies. This fixture
-- only reproduces their publicly readable state so ownership policy writes
-- can be exercised in PostgreSQL without a Supabase installation.
CREATE POLICY read_assets ON public.video_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY read_runs ON public.analysis_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY read_tracks ON public.tracked_objects FOR SELECT TO authenticated USING (true);
CREATE POLICY read_incidents ON public.incidents FOR SELECT TO authenticated USING (true);
CREATE POLICY read_evidence ON public.evidence FOR SELECT TO authenticated USING (true);
CREATE POLICY read_storage ON storage.objects FOR SELECT TO authenticated USING (true);

-- Simulate legacy broad permissions; the migration must DROP these or the
-- narrower new policies would be OR'd with them.
CREATE POLICY "Authenticated users can insert video_assets" ON public.video_assets
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update video_assets" ON public.video_assets
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can insert tracked_objects" ON public.tracked_objects
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update tracked_objects" ON public.tracked_objects
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Viewers can insert incidents for testing" ON public.incidents
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Viewers can insert violations for testing" ON public.violations
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Viewers can insert analysis_runs for testing" ON public.analysis_runs
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Viewers can insert evidence for testing" ON public.evidence
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Viewers can insert alerts for testing" ON public.alerts
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can insert their own evidence" ON public.evidence
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update their own evidence" ON public.evidence
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can update their evidence" ON storage.objects
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Staff can update evidence" ON storage.objects
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can upload videos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update their videos" ON storage.objects
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete their videos" ON storage.objects
  FOR DELETE TO authenticated USING (true);

-- Two unrelated video owners and their associated analysis runs.
INSERT INTO public.video_assets VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.analysis_runs VALUES
  ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
INSERT INTO public.evidence VALUES
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL);
INSERT INTO storage.objects VALUES
  ('22222222-2222-2222-2222-222222222222/original.mp4', 'videos');

\i supabase/migrations/20261106000000_phase1_security_hardening.sql
\i supabase/tests/security_policy_assertions.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
SELECT set_config('visionguard.role', 'Viewer', false);

-- Default owner and RLS must permit an ordinary Viewer to save their own video.
INSERT INTO public.video_assets (id) VALUES
  ('55555555-5555-5555-5555-555555555555');
DO $$
BEGIN
  IF (SELECT uploaded_by FROM public.video_assets
      WHERE id = '55555555-5555-5555-5555-555555555555')
      IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Video default uploader must be the current user';
  END IF;
END $$;

-- Test unauthorized insert uses 42501 RLS denial.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.video_assets (id, uploaded_by) VALUES
      ('66666666-6666-6666-6666-666666666666',
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    RAISE EXCEPTION 'Viewer created another user-owned video!';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

-- User A cannot modify user B's video or transfer their own ownership.
DO $$
DECLARE touched integer;
BEGIN
  UPDATE public.video_assets SET uploaded_by = uploaded_by
    WHERE id = '22222222-2222-2222-2222-222222222222';
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> 0 THEN
    RAISE EXCEPTION 'Viewer modified someone else''s video';
  END IF;

  BEGIN
    UPDATE public.video_assets SET uploaded_by = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      WHERE id = '11111111-1111-1111-1111-111111111111';
    RAISE EXCEPTION 'Viewer transferred own video to another person!';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- A viewer can create their own run, track, and linked incident.
INSERT INTO public.analysis_runs VALUES
  ('77777777-7777-7777-7777-777777777777',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
INSERT INTO public.tracked_objects VALUES
  ('88888888-8888-8888-8888-888888888888',
   '11111111-1111-1111-1111-111111111111',
   '77777777-7777-7777-7777-777777777777', 1);
INSERT INTO public.incidents VALUES
  ('99999999-9999-9999-9999-999999999999',
   '11111111-1111-1111-1111-111111111111',
   '77777777-7777-7777-7777-777777777777');

-- A run-id must match the same video AND be owned by this user. Matching only
-- one of the two is a cross-user integrity vulnerability.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.tracked_objects VALUES
      ('aaaaaaaa-1111-1111-1111-111111111111',
       '11111111-1111-1111-1111-111111111111',
       '44444444-4444-4444-4444-444444444444', 2);
    RAISE EXCEPTION 'Viewer linked track to another user''s run!';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.incidents VALUES
      ('aaaaaaaa-2222-2222-2222-222222222222',
       '22222222-2222-2222-2222-222222222222',
       '77777777-7777-7777-7777-777777777777');
    RAISE EXCEPTION 'Viewer linked own run to someone else''s video!';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO public.incidents VALUES
      ('aaaaaaaa-3333-3333-3333-333333333333',
       '11111111-1111-1111-1111-111111111111',
       '44444444-4444-4444-4444-444444444444');
    RAISE EXCEPTION 'Viewer inserted foreign analysis run into own video!';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Uploaded video object and saved analysis artifact must both be writable.
INSERT INTO storage.objects VALUES
  ('11111111-1111-1111-1111-111111111111/original.mp4', 'videos');
INSERT INTO storage.objects VALUES
  ('artifacts/11111111-1111-1111-1111-111111111111/77777777-7777-7777-7777-777777777777.json.gz', 'videos');

-- User A cannot write/update the other user's footage or artifact.
DO $$
DECLARE touched integer;
BEGIN
  BEGIN
    INSERT INTO storage.objects VALUES
      ('artifacts/22222222-2222-2222-2222-222222222222/44444444-4444-4444-4444-444444444444.json.gz', 'videos');
    RAISE EXCEPTION 'Viewer uploaded another user''s run artifact!';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO storage.objects VALUES
      ('artifacts/11111111-1111-1111-1111-111111111111/44444444-4444-4444-4444-444444444444.json.gz', 'videos');
    RAISE EXCEPTION 'Viewer forged a mismatched analysis artifact!';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE storage.objects SET name = name
    WHERE name = '22222222-2222-2222-2222-222222222222/original.mp4';
  GET DIAGNOSTICS touched = ROW_COUNT;
  IF touched <> 0 THEN
    RAISE EXCEPTION 'Viewer overwrote someone else''s stored video';
  END IF;
END $$;

RESET ROLE;
SELECT 'Phase 1 RLS write-authority fixture passed' AS result;
