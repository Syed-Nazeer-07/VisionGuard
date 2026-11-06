# Phase 4 — Backend speeding episodes as reviewable incidents

## What this changes
- The calibrated local Python processor emits one structured candidate record on
  each **confirmed overspeed episode**, not one per frame.
- Each record contains the actual detector-observed video frame, media time,
  bounding box, track ID, estimated speed, configured speed limit and tolerance,
  source video dimensions, and object detection confidence.
- Backend artifacts (schema version 1.1) retain these event records.
- When **Save to History** is selected, the frontend links those records to the
  persisted analysis run, uploaded video and archived result artifact in
  public.incidents. The Incident Center and Review Queue display them.
- The Incident Center links to the original video time. Video Review selects
  the incident's own run if available.

## Safety and interpretation
**Every record is an unverified detection candidate, not a legal speeding
determination.** An incident is created only when the processor has a ground-plane
homography, and three separate detector observations confirm estimated speed
above the configured 60 km/h limit plus 10 km/h tolerance.

The 60 / 10 km/h configuration is a model default; it is **not** proof of the
road's legal speed limit. Survey calibration quality, camera geometry, GPS/video
time alignment, speed-estimator accuracy and model confidence need independent
validation before any official enforcement use. No automatic penalty or approval
is implemented.

The metadata includes an **evidence pointer** (video, artifact, frame ID,
media time, bounding box), not an independent image. This phase does **not**
manufacture a screenshot, license plate, OCR result, or claim that an image was
saved to the private evidence bucket. A reviewer can replay the original video.

## Staging verification
1. Deploy the backend and frontend from this PR on staging with a model and a
   real calibrated video. Ensure the desired speed limit and tolerance are set.
2. With **Save to History**, analyze an uncalibrated video; ensure zero
   speeding incidents are recorded.
3. In a calibrated sample where one vehicle is estimated above threshold for
   many consecutive frames, ensure exactly one candidate per confirmed episode.
4. Confirm the downloaded gzip artifact contains `speeding_events` and
   `summary.speed_violations_count` equals their number.
5. Open Incident Center → Review Queue. The incident should show the track,
   measured speed, configured threshold, media time, frame number, and human
   review warning. Video Review should seek to the recorded media time.
6. Disable Save to History. Check that local inference does not create DB incidents.
7. Simulate an incident INSERT permission error and an artifact upload failure;
   the analysis UI should report persistence failure, not pretend it saved.
8. Test with Viewer and Operator accounts if Phase 1 security PR #2 is applied.
9. Test replaying a previous run of the same video after Phase 3 PR #4, which
   isolates history and artifacts across analysis runs.

## Compatibility
- Older artifact version 1.0 files do not have event records. They remain
  readable, but the UI does **not** invent incident rows from an old summary
  counter without actual frame-level provenance.
- Backend artifacts are stored in the preexisting 'videos' Supabase bucket,
  currently public. This phase must not be considered a footage privacy fix.
- Stored incidents are insert-only candidates; review status changes happen
  manually through existing case-management UI.
- Frontend persistence is a sequence of client-driven operations, not an
  atomic DB transaction. A subsequent idempotent persistence RPC is recommended.
- Phase 3 PR #4 is not yet merged. This PR branches from the current main so
  it is independently reviewable, but both change Analyze and Video Review:
  coordinate conflict resolution and migration rollout before deploying both.
