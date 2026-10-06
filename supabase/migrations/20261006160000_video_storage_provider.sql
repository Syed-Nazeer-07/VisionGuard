-- Migration: 20261006160000_video_storage_provider.sql
-- Description: Records which physical storage provider holds each video asset's file.
--   supabase — Supabase Storage bucket `videos` (all assets uploaded before this migration)
--   b2       — Backblaze B2, via the `video-storage` Edge Function (storage_path = videos/<video_id>/original.<ext>)
-- video_assets.id remains the only video identity.

ALTER TABLE public.video_assets
    ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'supabase';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'video_assets_storage_provider_check') THEN
        ALTER TABLE public.video_assets
            ADD CONSTRAINT video_assets_storage_provider_check CHECK (storage_provider IN ('supabase', 'b2'));
    END IF;
END $$;

-- Supabase Storage objects can be checked here; B2 objects cannot (object_exists = NULL → unknown,
-- verified by the Edge Function when a playback URL is requested).
CREATE OR REPLACE FUNCTION public.video_asset_storage_info()
RETURNS TABLE (
    video_id UUID,
    object_exists BOOLEAN,
    object_size BIGINT,
    content_etag TEXT,
    identical_to_video_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
    WITH obj AS (
        SELECT va.id,
               va.storage_provider,
               COALESCE(va.display_number, 2147483647) AS ord,
               CASE WHEN va.storage_provider = 'supabase' THEN o.id IS NOT NULL END AS object_exists,
               (o.metadata->>'size')::bigint AS object_size,
               o.metadata->>'eTag' AS etag
        FROM public.video_assets va
        LEFT JOIN storage.objects o
               ON va.storage_provider = 'supabase'
              AND o.bucket_id = 'videos'
              AND va.storage_path <> ''
              AND o.name = va.storage_path
    )
    SELECT a.id,
           a.object_exists,
           a.object_size,
           a.etag,
           (SELECT b.id FROM obj b
             WHERE a.etag IS NOT NULL
               AND b.etag = a.etag
               AND b.object_size = a.object_size
               AND (b.ord, b.id) < (a.ord, a.id)
             ORDER BY b.ord, b.id
             LIMIT 1)
    FROM obj a;
$$;

REVOKE ALL ON FUNCTION public.video_asset_storage_info() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.video_asset_storage_info() TO authenticated;

NOTIFY pgrst, 'reload schema';
