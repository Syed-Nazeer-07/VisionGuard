# Phase 1 security hardening — deployment and acceptance checks

This PR is intentionally additive. It changes **source code and migration files only**;
it does **not** deploy Supabase migrations or Edge Functions, and it does not change
the production database until an operator applies the migration.

## Deploy safely

1. Take a database backup/snapshot. Check that previous migrations through
   `20261006180000_fix_evidence_rls.sql` are applied, and inspect the live
   `pg_policies` output for custom policies not stored in Git.
2. Test on a **staging Supabase project first**, particularly with Viewer,
   Operator, Supervisor, Admin, and two unrelated signed-in users.
3. Apply `supabase/migrations/20261106000000_phase1_security_hardening.sql`
   with the Supabase migration workflow. Confirm it succeeds transactionally.
4. Set the Edge Function secret: `supabase secrets set REPORT_SCHEDULER_SECRET=<random-32+-char-value>`.
   Do not use the service-role key as the scheduler secret; do not place the
   scheduler secret in client-side `VITE_*` variables.
5. Deploy `report-scheduler` and configure a trusted invocation mechanism.
   It must call **POST** with header `x-visionguard-scheduler-key` equal to the
   secret. If Supabase JWT verification is enabled, that invocation additionally
   needs a valid deployment-specific JWT (the secret is not a replacement).
6. The old migration `20261004000005_scheduled_reports.sql` contains a
   `project-ref.supabase.co` placeholder cron target and an unsuitable
   authorization value. Replace the existing cron job with a correctly
   authenticated invocation **before** expecting automatic reports.
7. Only after successful staging verification, apply in production.

## Permission acceptance matrix

| Scenario | Expected |
|---|---|
| Viewer creates `video_assets` without `uploaded_by` (database default applies) | Allowed, owned by caller |
| Viewer inserts `video_assets` with a different `uploaded_by` | Denied |
| Viewer updates another user's `video_assets` | Denied |
| Viewer transfers ownership of own `video_assets` | Denied |
| Viewer inserts a tracked object for their own video | Allowed |
| Viewer inserts a tracked object for someone else's video | Denied |
| Viewer creates an analysis run for their own video | Allowed |
| Viewer creates a run for another user's video | Denied |
| Viewer creates an incident for their own run/video | Allowed |
| Viewer creates an unrelated incident | Denied |
| Viewer inserts a violation or alert with no elevated role | Denied |
| Viewer inserts an evidence row with another `uploaded_by` or null owner | Denied |
| Viewer modifies another user's evidence row | Denied |
| Viewer updates an existing object in evidence bucket | Denied |
| Viewer uploads into legacy videos bucket under a different video ID | Denied |
| Video owner uploads original video to video-id/original.mp4 | Allowed |
| Video owner uploads artifact to artifacts/video-id/owned-run-id.json.gz | Allowed |
| Viewer uploads artifact using another user's video ID | Denied |
| Viewer uploads artifact using a run ID for a different video | Denied |
| Owner re-uploads an existing run artifact (upsert UPDATE) | Allowed |
| Viewer deletes another user's archived run artifact | Denied |
| Viewer deletes video belonging to another user | Denied |
| Operator can operate on videos and evidence as permitted | Allowed |
| Supervisor/Admin can manage video ownership and video deletion | Allowed |
| Disabled account attempting a privileged write | Denied |
| Scheduler called without secret / with wrong secret / with GET | 401 / 401 / 405 |
| Scheduler called with correct secret and valid gateway auth | Can execute |

Run `supabase/tests/security_policy_assertions.sql` in staging to check that
known dangerously permissive policy names have been removed. Catalog assertions
cannot substitute for multi-account RLS tests.

## Known limitations intentionally *not* addressed by this PR

- The Supabase `videos` bucket is still **public** and the existing
  `getPublicUrl` caller relies on that behavior. Making it private requires
  a separate signed-URL playback migration. Do not treat this PR as footage
  confidentiality hardening.
- Existing dashboard `SELECT` policies allow all authenticated users to read
  much of the operational data, including all video asset records. Tenant/org
  isolation is not implemented. This PR focuses on **write restrictions**.
- Legacy `video_assets` rows with a null uploader need a supervised
  ownership backfill before ordinary users can edit them.
- Evidence storage object keys do not encode a secure uploader identity. This
  PR disables Viewer overwrites; an object-key redesign with ownership validation
  is a separate follow-up.
- Direct local Python inference APIs are not secured for internet deployment
  and must remain bound to localhost.
- The report scheduler still requires deployment-side cron configuration and
  a secure secret; it is not automatically deployed by this PR.
- Local-only browser demo mode uses mocked database behavior and does not test
  actual RLS.

## Saved analysis artifact compatibility

Artifacts are uploaded to the existing `videos` Supabase bucket at the path
`artifacts/<video-uuid>/<run-uuid>.json.gz`. The RLS helper
`public.can_manage_video_storage_object` checks the caller's asset ownership
(or Supervisor/Admin role) **and** that the referenced run belongs to that
same video. A per-file rule only checking `video_assets.storage_path` would
break backend History saving and review. Re-test storage INSERT, UPDATE
(upsert), DELETE, and download for both original videos and artifacts.

This PR still leaves the bucket publicly readable; this is an **authorization
of writes**, not private-footage protection. Coordinate Phase 3 and Phase 4
deployment with these storage rules on staging.
