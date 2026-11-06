# Live staging verification — November 2026

This document records **actual** Supabase staging operations, not just
disposable CI/PostgreSQL simulations. All changes were applied to the
new isolated Supabase project and were **not** deployed to production.

## Environment

- Project: **visionguard-staging**
- Region: **Mumbai (ap-south-1)**
- Project ref: `wpkwxlhwjkgtvyersust`
- Supabase project dashboard:
  https://supabase.com/dashboard/project/wpkwxlhwjkgtvyersust
- Organization plan when project was created: **Free**
- Cost quoted by Supabase at project creation: **$0/month**
- Branch under test: `integration/staging-all-phases`
- Default new video upload provider: set
  `VITE_VIDEO_STORAGE_PROVIDER=supabase` in local `.env`
  (this staging project has no B2 secrets or Edge Function deployment).

## Database applied and verified

- Applied **30 original repo migrations** in filename order to a fresh
  Supabase 17.x PostgreSQL project, with success confirmed for each.
- Applied four additional audited security migrations:
  `20261106185954_staging_policy_and_rpc_hardening.sql`,
  `20261106190514_private_footage_and_owner_scoped_reads.sql`,
  `20261106191554_private_scheduled_report_downloads.sql`, and
  `20261106191932_restrict_signed_report_links.sql`.
- Normalized the originally generated migration ledger version IDs to match
  the repository's canonical filenames, enabling future Supabase CLI
  migration-history comparisons. Rechecked the list.
- All **24 public application tables** have RLS enabled.
- `videos`, `evidence` and `reports` Supabase Storage buckets are all
  **private**. Videos have SELECT/INSERT/
  UPDATE/DELETE rules scoped to the uploaded video owner's asset/run
  reference or authorized staff. Frontend now creates a one-hour signed
  playback URL rather than publishing a permanent public URL.
- Scoped video assets, analysis runs, tracks, incidents and evidence SELECT
  policies to the owner or staff.
- Fixed an authorization bug where an unqualified `video_id` in a policy
  resolved to the run's own column rather than the incident's video ID.
  New policies explicitly compare both source IDs.
- Removed a permissive legacy evidence upload policy.
- Revoked anonymous invocation of all seven identified SECURITY DEFINER
  functions. Revoked direct authenticated invocation of trigger-only
  functions and fixed mutable function search paths.
- Changed the video storage metadata lookup function to
  SECURITY INVOKER to respect caller RLS.
- Security advisor after changes: **one signed-in SECURITY DEFINER
  warning remains** for `auth_user_role()`, the narrowly authorized
  role lookup used by RLS. Review before production.

## Real Supabase RLS authorization exercise

Ran an isolated SQL transaction with **two synthetic authentication users**,
separate owner profiles, two video assets and two analysis runs. Within
`SET LOCAL ROLE authenticated` + a Viewer JWT subject, confirmed:

- Viewer sees only their own video and run.
- Own video and own analysis artifact pass storage authorization.
- Another user's video and mismatched artifact path fail authorization.
- Cross-user video/incident and cross-user run/track combinations are
  rejected by RLS (not merely fake UI restrictions).
- Legitimate owner track and incident INSERT succeed.

Then issued **ROLLBACK**. A subsequent query confirmed **zero synthetic
users, video assets, analysis runs, incidents and tracks** remained.
The repeatable test script is
`supabase/tests/staging_rls_live_smoke.sql`.

This is a real database policy test, but it is **not a browser signup
or signed-URL playback test**; no actual Supabase Auth session was issued.

## Frontend code and CI

- The Vite workspace explicitly reads the repository root `.env`.
- `apps/web/src/services/videoStorage.ts` now requests signed URLs for
  stored Supabase videos. Unit tests verify that it never constructs a
  public URL, that signing uses a 3600s expiry, and that unauthorized
  video reads do not reveal internal storage error details.
- Create your local root `.env` from `.env.staging.example`,
  then replace the placeholder with the project's **publishable** key
  from the Supabase dashboard. Never use a service role key in Vite.
- Full CI (frontend, backend, synthetic model contract, disposable
  PostgreSQL migration/authorization tests) must remain green.

## Remaining real-world test gates

1. **Model:** Manual GitHub Actions export is now merged on `main`
   through PR #10. The user still needs to review Ultralytics licensing
   and explicitly run that workflow to obtain the model file.
2. **Login:** Create a real staging user through the app's Auth UI.
   New users start as Viewer. Promote only an intended trusted tester to
   Operator/Admin using an authorized administrative path. Verify
   email confirmation and profile bootstrap.
3. **Actual storage:** Upload a short authorized traffic MP4 using the
   Supabase provider, generate a signed URL, play it, sign out and
   confirm other signed-in accounts cannot retrieve it. Test 1-hour
   renewal for long viewing sessions.
4. **Actual inference:** Install the exported `yolo11n.onnx` under
   `apps/web/public/models`, run the model validators and inspect real
   box/track output in Edge or Chrome on Windows on ARM.
5. **Saved workflow:** Verify repeated video analysis, run-scoped
   trajectories, gzipped artifacts and incident review timestamp.
6. **Camera:** HLS requires a real authorized feed with manifest/segment
   CORS; RTSP/YouTube gateway ingestion has not been implemented.
7. **Scheduler/B2:** Report scheduler secret, trusted invocation, and
   Backblaze credentials/function deployment are intentionally absent
   from this new staging project.
8. **Private reports:** The reports bucket is private, the scheduler
   emails seven-day signed links, and the reports/scheduled_reports table
   reads are now scoped to authorized staff or the creating user. These
   changes have not yet been tested via a deployed scheduler/email run;
   archived email links expire and require re-signing by authorized staff.
9. **Performance:** Some unindexed FKs, multiple permissive policies,
   and unused-index notices remain in the performance advisor.
   These are not equivalent to a completed performance tuning pass.

## Exact local staging startup

From the `VisionGuard` clone:

```powershell
git fetch origin
git switch --track origin/integration/staging-all-phases
Copy-Item .env.staging.example .env
# Edit .env and set VITE_SUPABASE_ANON_KEY from staging dashboard
npm ci
# Put the licensed model at apps/web/public/models/yolo11n.onnx
python scripts/visionguard_doctor.py
npm run dev
```

Do **not** merge the whole staging PR into main until the real-video,
real-signup and signed-URL acceptance tests pass.
