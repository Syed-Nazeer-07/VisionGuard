# VisionGuard staging integration runbook

This branch combines implemented Phase 1–7 code **without touching main**.
Individual PRs remain open for review. GitHub Actions tests this combined
frontend, backend and database migration in a disposable environment. It is
**not** a staging Supabase deployment and cannot certify real footage.

## Changes combined

- Phase 1: owner/role-scoped Supabase write RLS and privileged scheduler
  secret gate, including video and run-artifact storage policy compatibility.
- Phase 2: already merged into main — accurate backend metrics, overspeed
  episode counts, and surfacing incomplete History saves.
- Phase 3: run-scoped track uniqueness and selected-run artifact review.
- Phase 4: frame-localized backend speeding candidates inserted as reviewable,
  explicitly **unverified** incidents (no legal enforcement).
- Phase 5: real Camera Directory, HLS Monitor and saved Scene Setup.
- Phase 6: browser-only live HLS YOLO worker inference/ByteTrack preview.
- Phase 7: model-export scripts, deterministic ONNX contract tests, CPU
  smoke check, environment doctor and opt-in model-export workflow.

**Code-integration decisions**: the Analyze page includes both
`runScopedTrackUpsertOptions` (Phase 3) and
`buildBackendSpeedIncidents` (Phase 4). Video Review preserves the
per-run artifact isolation and selects the originating run of an incident.
The CI workflow includes backend artifact tests, PostgreSQL run-history
tests, frontend checks and synthetic ONNX contract tests.

## Critical rollout order (staging first)

1. Take a Supabase staging DB snapshot and review existing `pg_policies`.
   In particular, remove permissive legacy policies before trusting the
   Phase 1 RLS rules. Test as unrelated Viewer, Operator, Supervisor and
   Admin accounts. The current `videos` bucket remains **public**.
2. Apply migrations in their correct filename order, including:
   `20261106000000_phase1_security_hardening.sql`, then
   `20261106020000_run_scoped_tracking.sql`. Do **not** deploy the
   updated frontend ahead of the run-scoped schema; old upsert constraints
   differ.
3. Provision `REPORT_SCHEDULER_SECRET` and a trusted scheduler invocation.
   Review the legacy placeholder cron target; merely deploying the
   Edge Function does not configure scheduling.
4. Export/obtain properly licensed static COCO80 YOLO11n ONNX weights,
   validate them with `scripts/validate_yolo_onnx.py` and
   `scripts/smoke_yolo_onnx.py`, and place them under
   `apps/web/public/models` **before** the frontend build.
5. Configure staging-only Supabase Auth credentials and storage B2/Supabase
   integration. Do not commit secrets or service-role keys.
6. Run real-video end-to-end scenarios as multiple roles:
   upload -> browser analysis -> tracking -> saved History -> second
   analysis of same video -> distinct per-run tracks and artifacts ->
   calibrated backend speeding events -> Review Queue -> Video Review
   correct run/timestamp. Run tests with forced storage and DB failures.
7. Configure a compatible HLS camera with explicit source/segment CORS,
   and run Monitor -> Camera AI Detection. Confirm the model actually
   returns detections and there are no database writes from preview.
   RTSP/YouTube gateway ingestion is not included.
8. Benchmark accuracy, FPS, ID switches and speed error against labeled
   reference footage. Review any camera calibration and actual road speed
   limits before authorizing real-world incident workflows.

## Regression checklist

- [ ] CI frontend lint, TypeScript build and all Vitest tests pass
- [ ] Backend pure/processor/artifact pytest tests pass
- [ ] PostgreSQL migration fixture passes and is idempotent
- [ ] ONNX graph validation and doctor fixture tests pass
- [ ] Real ONNX CPU and browser WebGPU/WASM smoke test passes
- [ ] Two independent authenticated users cannot edit each other's data
- [ ] Viewer uploads own video and own run-artifact object successfully
- [ ] Two runs with the same numerical track ID keep independent trajectories
- [ ] A saved speeding episode creates an unverified, linked review incident
- [ ] Live HLS feed shows tracks, with no plate OCR or evidence snapshots
- [ ] Browser-only/demo mode clearly distinguished from configured production
- [ ] Scheduler has an actual trusted invocation and tested secret
- [ ] Original footage and artifact privacy policies reviewed

## Known production blockers

- No trained ONNX weight is versioned/deployed from this repository.
- This environment has no access to your live/staging Supabase project,
  credentials, real videos or physical cameras. **CI green != deployed.**
- Supabase bucket footage read privacy is not yet hardened; Phase 1 is
  primarily write authorization, not tenant-level read isolation.
- Some legacy tracked history may already have been overwritten before
  Phase 3; schema migrations cannot reconstruct it.
- Speed-estimation quality and operator workflow need ground truth and
  role-based end-to-end testing before any real enforcement use.
- Client-driven multi-step history/incident persistence isn't transactional
  or retry-idempotent. Real-world failures need dedicated recovery testing.
- Additional traffic rules (helmet/triple riding, lane, red light) are still
  stubs, and the OCR backend endpoint is absent.
- Phase 5/6 HLS camera preview is browser-only; not a complete RTSP gateway
  with durable 24/7 server-side inference.

## Merge policy

**Do not merge this integration branch into main or deploy migrations
automatically.** It is a staging candidate to reduce isolated-PR conflict
risk. First validate with a real Supabase staging environment, owned model
binary, authentic footage, then resolve any remaining security/functional
issues before a coordinated production rollout.
