-- User-scoped history is locally cached. A stale laptop must not replace
-- newer cloud-synced observations for the same analysis run.
-- Existing user_analysis_records owner RLS remains in effect.
CREATE OR REPLACE FUNCTION public.keep_latest_analysis_revision()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.updated_at <= OLD.updated_at THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activity_prevent_stale_updates
  ON public.user_analysis_records;
CREATE TRIGGER activity_prevent_stale_updates
BEFORE UPDATE ON public.user_analysis_records
FOR EACH ROW EXECUTE FUNCTION public.keep_latest_analysis_revision();
