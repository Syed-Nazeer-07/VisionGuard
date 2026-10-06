-- Migration: 20261006140000_video_asset_storage_info.sql
-- Description: Read-only report of each video asset's Storage object, so the UI can state truthfully
-- when an asset's file is missing or is byte-identical to another asset's file (same size + MD5 eTag).
-- Historical rows are not modified.

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
               COALESCE(va.display_number, 2147483647) AS ord,
               o.id IS NOT NULL AS object_exists,
               (o.metadata->>'size')::bigint AS object_size,
               o.metadata->>'eTag' AS etag
        FROM public.video_assets va
        LEFT JOIN storage.objects o
               ON o.bucket_id = 'videos'
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
