-- Run ONLY on a new/nonproduction Supabase project, from SQL editor as
-- a database administrator. Staging transaction creates synthetic auth users
-- and video records, tests ownership, and always ROLLBACKS.
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users
(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
VALUES
('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vg-rls-probe-a@example.invalid','',now(),now(),now(),'{}','{}'),
('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000','authenticated','authenticated','vg-rls-probe-b@example.invalid','',now(),now(),now(),'{}','{}');

INSERT INTO public.video_assets(id,filename,storage_path,uploaded_by)
VALUES
('11111111-1111-4111-8111-111111111111','a.mp4','11111111-1111-4111-8111-111111111111/original.mp4','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'),
('22222222-2222-4222-8222-222222222222','b.mp4','22222222-2222-4222-8222-222222222222/original.mp4','bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');

INSERT INTO public.analysis_runs(id,video_id,created_by,status)
VALUES
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','completed'),
('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb','completed');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',true);

DO $$
BEGIN
  IF public.auth_user_role() IS DISTINCT FROM 'Viewer' THEN
    RAISE EXCEPTION 'Test profile not Viewer';
  END IF;
  IF (SELECT count(*) FROM public.video_assets) <> 1
    OR (SELECT count(*) FROM public.analysis_runs) <> 1 THEN
    RAISE EXCEPTION 'Viewer must see only their owned video and run';
  END IF;
  IF NOT public.can_manage_video_storage_object('11111111-1111-4111-8111-111111111111/original.mp4')
    OR public.can_manage_video_storage_object('22222222-2222-4222-8222-222222222222/original.mp4') THEN
    RAISE EXCEPTION 'Video storage ownership check failed';
  END IF;
  IF NOT public.can_manage_video_storage_object('artifacts/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333.json.gz')
    OR public.can_manage_video_storage_object('artifacts/11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444444.json.gz') THEN
    RAISE EXCEPTION 'Archived artifact identity check failed';
  END IF;
  BEGIN
    INSERT INTO public.incidents(video_id,analysis_run_id,incident_type,severity)
    VALUES ('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','overspeed','Medium');
    RAISE EXCEPTION 'Cross-user video incident was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.tracked_objects(video_id,analysis_run_id,track_id,object_type,confidence)
    VALUES ('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',1,'car',0.9);
    RAISE EXCEPTION 'Cross-user track/run link was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.incidents(video_id,analysis_run_id,incident_type,severity)
    VALUES ('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','overspeed','Medium');
    RAISE EXCEPTION 'Cross-user incident/run link was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

INSERT INTO public.tracked_objects(video_id,analysis_run_id,track_id,object_type,confidence)
VALUES ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',1,'car',0.9);
INSERT INTO public.incidents(video_id,analysis_run_id,incident_type,severity)
VALUES ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','overspeed','Medium');

RESET ROLE;
-- No synthetic users, videos, tracks or incidents may survive this test.
ROLLBACK;
