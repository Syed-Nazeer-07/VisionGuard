-- Add review-related columns to violations table
ALTER TABLE public.violations
ADD COLUMN reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
ADD COLUMN reviewed_at TIMESTAMPTZ,
ADD COLUMN review_notes TEXT;

-- Update existing 'pending' status to 'pending_review' if any
UPDATE public.violations
SET status = 'pending_review'
WHERE status = 'pending';

-- Alter default for status
ALTER TABLE public.violations
ALTER COLUMN status SET DEFAULT 'pending_review';
