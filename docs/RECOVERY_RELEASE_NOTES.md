# VisionGuard detection-first recovery — implementation and verification

This document reflects the latest `fix/detection-first-recovery-b2-ui`
commits. PR #11 targets `integration/staging-all-phases`; **do not**
deploy this branch over production or assume a successful model benchmark
merely because CI is green.

## Changes pushed

### Vehicle detection and rendering

- Removed arbitrary aspect-ratio/lower-road size filters that silently
  suppressed legitimate motorcycles, and preserved overlapping road-user
  classes during duplicate filtering.
- Crops YOLO source rectangles to image boundaries **after unletterboxing
  corners**. Boxes near the edge no longer extend beyond the video due to
  independent centre/size clipping.
- Rejects malformed output tensor lengths and letterbox ratios.
- TrackStore ingests only genuine detector observations, not predicted or
  interpolated backend output; stale predictions cannot invent new tracks,
  reset freshness, or generate phantom displacement.
- Short bounded velocity interpolation is derived from observed video-media
  timestamps. Camera-preview/web playback supports optional **Sync video to
  AI** with a visible speed multiplier when inference cannot keep pace.
- Two-wheeler class-group matching tolerates motorcycle/bicycle flips, while
  pedestrian tracks remain separate.

### Speed measurement safety

- Surveyed 4-corner homography editor, video-letterbox coordinate mapping
  and measured road width/length in metres.
- Requires valid finite points, non-crossing geometry and plausible metric
  input; uncalibrated footage cannot produce honest km/h.
- Velocity is computed from observed bounding boxes only; 120ms minimum
  sampling and a short position median suppress one-frame detector jitter.
- A calibration change/missing calibration clears the estimator. Implausible
  track teleports and nonfinite world points also invalidate cached speed.

### B2 object storage

- Supabase remains the **authentication/relational metadata database**,
  while private B2 handles new video uploads and new compressed analysis
  artifacts, preventing those files from consuming Supabase Storage quota.
- Edge Function `video-storage` is deployed to **staging only** with
  JWT verification, per-object signed uploads/downloads, run-specific
  artifact authorization, and version-aware footage/artifact cleanup.
- Operations staff can review artifacts; only owners/Supervisors/Admins
  can delete them. B2 version cleanup precedes DB deletion to retain a
  retriable row if the object store is unreachable.
- Existing historical assets and older Supabase artifacts remain readable.
- **Remaining quota risk:** snapshot/plate-crop evidence and some reports
  still use the Supabase Storage `evidence`/`reports` buckets. They need
  their own B2 migration and privacy checks; do not declare all application
  storage migrated.
- B2 secrets and bucket CORS are *not configured or tested* through this
  project connection. The Edge Function being active is not proof that
  upload, playback, or deletion succeeds against a real B2 account.
- Browser-only temporary inference defaults to no saved video, so it can
  be tested without making any object-storage request.

### Product experience

- Unified password recovery/reset with the main sign-in design.
- Replaced first-run dashboard instructional wall with a responsive,
  honest getting-started screen.
- Browser ONNX WebGPU/WASM is the default; Python FastAPI is optional,
  especially on Snapdragon/Windows on ARM machines.

## Verification gates

| Area | Verified | Still required |
|---|---|---|
| Frontend | CI lint/typecheck/build and Vitest regression suite | Real Edge/Chrome video-frame overlay comparison |
| Backend | Deterministic pytest/syntax checks | Real Python ONNX and video processing on target hardware |
| Edge Function | Deno 2 typecheck CI; function v4 active, verify_jwt true | Restricted real B2 credentials + bucket CORS + signed upload and playback |
| Supabase | Staging migrations and two-user RLS smoke tested | Browser Auth signup + real saved video and user-role flow |
| Detector | Synthetic boundary, small-object and duplicate-box tests | Labeled motorcycle/day/night dataset with precision/recall |
| Tracking | Synthetic prediction/occlusion ID-lifecycle tests | High-FPS footage measurements: ID switches and overlay lag |
| Speed | Calibration and synthetic invalid-speed tests | Surveyed reference and ground-truth km/h error |
| Privacy | B2 server-side presigning, RLS permissions | Owner versus staff B2 read/delete tests with real accounts |

## Test the current pushed recovery branch on Windows

From the existing cloned VisionGuard folder:

```powershell
git fetch origin
git switch -C visionguard-recovery origin/fix/detection-first-recovery-b2-ui
Copy-Item .env.staging.example .env -Force
# Edit .env: use the *publishable* staging key, not sb_secret_.
# VITE_VIDEO_STORAGE_PROVIDER=b2 is the default.
npm ci
npm run dev
```

Put your licensed ONNX model at
`apps/web/public/models/yolo11n.onnx`; that binary is not versioned in Git.

Start with an authorized 20–30 second MP4 in **Browser** mode with
**Save to History off**. Use the pipeline dashboard to compare recorded
detections, tracking IDs and Sync video to AI behavior at 1x and adaptive
playback. Do not judge motorcycle recognition solely from green unit tests.
To persist footage and run artifacts, finish
`docs/B2_STAGING_SETUP.md` using private server-side secrets.

## Production readiness

**Not yet production-ready** for traffic enforcement or surveillance
recordkeeping. Benchmarks from older model versions are historical baselines,
not measured improvements on the current changes. The next acceptance
stage must use real traffic clips, actual B2 upload/read/delete, annotated
motorcycle ground truth, and surveyed calibration.
