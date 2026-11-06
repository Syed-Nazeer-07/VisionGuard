-- Verified on Supabase staging: reports can contain confidential traffic
-- and case records. Never expose them with permanent public object URLs.
-- The report-scheduler Edge Function uses short-lived signed links instead.
UPDATE storage.buckets SET public = false WHERE id = 'reports';
