# Detection-first recovery plan — VisionGuard

**Context:** The current staging build compiles, but real users report severe browser detection jitter, poor vehicle/motorcycle recall, flickering/off-target boxes, unreliable speed, mismatched auth/onboarding UI, a confusing optional Python backend, and Supabase video storage limits. These are product defects; green CI does not establish real-world accuracy.

## Priority order and acceptance

1. **Restore B2 as the default video-storage provider.**
   - Keep Supabase for Auth, tables and tracking metadata; use private Backblaze B2 for video *bytes* through the `video-storage` Edge Function with short-lived presigned URLs.
   - Never ship B2 application keys in `VITE_*` or JavaScript to the browser.
   - Deploy and authorize the function in staging, then configure B2 endpoint, region, bucket and restricted credentials through project secrets. B2 bucket CORS must expose ETag; only genuine test uploads establish readiness.
   - Never silently fall back to quota-limited Supabase Storage.
2. **Fix browser detection/tracking correctness.**
   - Remove arbitrary detector/overlay heuristics which suppress small motorcycles or produce different sets of boxes in the worker and on-screen renderer.
   - Match motorcycle/bicycle class flips as one two-wheeler association group; avoid cross-class takeover by pedestrians.
   - Improve overlay smoothing/frame-time velocity and protection against stale/noisy predictions.
   - Add synthetic moving/occluded-vehicle tests, low-resolution motorcycle tests, and cross-generation/seek regression tests. Record FPS and dropped-frame diagnostics.
3. **Calibrate speed instead of guessing.**
   - Speed in km/h is unavailable without validated road-plane scale; pixel motion is not a physically meaningful velocity. Show `Calibration required`, not a number invented from arbitrary video.
   - Only update speed from actual matched detector observations; protect against bbox-height jitter and near-duplicate frames. Review scene quadrilateral calibration and unit consistency.
   - Ground-truth speed tests on measured footage before treating any violation as an incident.
4. **Fix app experience.**
   - Match password recovery and reset UI to the main light/dark authentication split layout; add expired-link/error affordances.
   - Replace the first-login four-step wall with a modern professional onboarding and honest storage/inference status.
   - Explain the Python FastAPI backend is optional for browser inference and give a diagnostics/launcher path on incompatible ARM devices.
5. **Quality and validation.**
   - CI for source changes, but also verify *real* YOLO ONNX weight, real annotated traffic clips (motorcycles, distant vehicles, night scenes), tracking ID switches, overlay alignment, and speed error against surveyed ground truth.
   - Target latency (p50/p95), recall per class, MOTA/IDF1, calibration residuals; do not claim improvement until measured. Acceptance: no fake boxes, good track continuity and no spoofed speed values.

## Scope and deployment gates

- Branch: `fix/detection-first-recovery-b2-ui` based on staging integration branch.
- Changes remain behind a PR until combined CI and manual acceptance.
- B2 application secrets are absent from the staging Supabase project; configuring actual Backblaze bucket credentials requires secure dashboard entry, never copying keys into this repo/chat.
- Live Supabase metadata is separate from private B2 object storage.
