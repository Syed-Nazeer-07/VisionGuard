-- Upgrade Cameras table for the Camera Management Module

ALTER TABLE public.cameras
ADD COLUMN IF NOT EXISTS camera_identifier TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS latitude FLOAT,
ADD COLUMN IF NOT EXISTS longitude FLOAT,
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- Update RLS policies to handle soft deletes
-- Drop existing select policy
DROP POLICY IF EXISTS "Cameras are readable by all" ON public.cameras;

-- Create new policy excluding deleted cameras
CREATE POLICY "Active cameras readable by all" ON public.cameras
FOR SELECT TO authenticated
USING (is_deleted = false OR auth_user_role() = 'Admin');
