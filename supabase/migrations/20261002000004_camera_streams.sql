-- Add source_type and enabled to cameras table
ALTER TABLE public.cameras
ADD COLUMN source_type TEXT NOT NULL DEFAULT 'upload',
ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;

-- Update existing records if any
UPDATE public.cameras SET source_type = 'upload', enabled = true;
