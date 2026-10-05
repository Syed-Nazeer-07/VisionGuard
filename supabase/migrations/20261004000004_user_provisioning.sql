-- =====================================================================
-- ENTERPRISE USER PROVISIONING
-- =====================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;

-- Drop constraints if they exist to allow updates (we enforce logic via triggers and RLS)
-- No changes to auth_user_role() needed, it correctly maps status to permissions.
