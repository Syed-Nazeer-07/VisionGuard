"""Guard against reintroducing permanently public video/report URLs.

These are source contract checks. The real staging database security advisor,
RLS fixture, and browser signed-URL playback are separate verification steps.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class StoragePrivacyContractTests(unittest.TestCase):
    def test_video_playback_requires_signed_url(self):
        service = source("apps/web/src/services/videoStorage.ts")
        self.assertIn(".createSignedUrl(asset.storage_path, 60 * 60)", service)
        self.assertNotIn("getPublicUrl(asset.storage_path)", service)

    def test_private_video_and_evidence_sql(self):
        migration = source(
            "supabase/migrations/20261106190514_private_footage_and_owner_scoped_reads.sql"
        )
        self.assertIn("SET public = false WHERE id = 'videos'", migration)
        self.assertIn('DROP POLICY IF EXISTS "Videos are publicly accessible"', migration)
        self.assertIn('ALTER POLICY "Authenticated users can read video_assets"', migration)
        self.assertIn('ALTER FUNCTION public.video_asset_storage_info() SECURITY INVOKER', migration)

    def test_scheduled_reports_are_private_and_signed(self):
        migration = source(
            "supabase/migrations/20261106191554_private_scheduled_report_downloads.sql"
        )
        scheduler = source("supabase/functions/report-scheduler/index.ts")
        self.assertIn("SET public = false WHERE id = 'reports'", migration)
        self.assertIn(".createSignedUrl(storagePath, 7 * 24 * 60 * 60)", scheduler)
        self.assertNotIn(".getPublicUrl(storagePath)", scheduler)


if __name__ == "__main__":
    unittest.main()
