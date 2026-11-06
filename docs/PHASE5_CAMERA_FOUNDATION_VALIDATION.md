# Phase 5 — Camera Directory / HLS Monitor / Scene Setup

## Shipped in this branch

- `/app/cameras` is now a real Camera Directory, not a redirect to Analyze.
  Search, Edit, Add, soft delete and direct links to preview and scene
  settings are wired. Database save/deletion failures are surfaced.
- `/app/monitor?camera=<id>` is a real monitor with a camera directory,
  status filters, searchable camera names, selected camera priority,
  distinct 1/4/9-feed layout, and the real Incident Review Queue.
- `/app/scene-setup/<camera-uuid>` loads and saves geometry/calibration for
  the selected **existing** camera. A background reference clip can be
  uploaded locally for drawing; it is **not** uploaded to the backend.
- Camera configuration now attempts real HLS playback in a media element
  before it reports a test as successful. A syntactically valid URL alone
  is never treated as a healthy camera.
- Saved camera coordinates are shown in a location directory. Fabricated
  pseudo-geographic markers were removed.

## Hard limitations — no false promises

- **Browser playback supports HLS only**, with HTTPS/HTTP `.m3u8`
  manifests, appropriate network access, CORS, codec support, and HLS.js
  (or native HLS on Safari).
- Direct RTSP playback and YouTube ingestion require real gateway services.
  The UI explains the missing capability; it does not claim to deploy
  MediaMTX, go2rtc or yt-dlp. The uploaded-video camera wizard option is
  disabled until its simulation workflow exists.
- Preview is **not YOLO inference** or video recording. The Analyze page
  presently accepts uploaded/library video, not `?camera=<id>`.
- A successful browser playback attempt is not a continuous health check.
  The wizard no longer writes fabricated `online` health scores.
- Saved scene polygons are reference configuration; actual camera
  inference/violation rules are not wired to them yet. No implied
  calibration accuracy or automatic legal speeding enforcement.
- Camera stream URLs may contain tokens in query parameters. UI source
  labels show only the hostname, not the query token; however, the current
  Supabase client still retrieves the entire source record. Future
  access-scoped secret storage would be required for private credentials.
- Supabase RLS must permit authorized roles to manage cameras/scene
  profiles; staging roles may expose policy inconsistencies.

## Manual staging checks

1. Add a publicly accessible CORS-enabled HLS stream, open Monitor
   and verify an actual moving video starts. Switch between 1/4/9 grid
   and select the camera from the directory.
2. Enter an invalid HLS URL. Verify Connection Test fails and the
   monitor displays an actionable error, not a false success.
3. Add an RTSP or YouTube URL. Verify it explicitly displays the
   missing-gateway message and never claims playback.
4. With one camera and a 2x2 grid, verify one real stream only — not
   four copies labeled as four cameras.
5. Open `/app/scene-setup/<id>`; load a local reference video; draw a
   zone and 4-point calibration area; save and reload to verify the
   same polygon points and values return. No dummy camera is created.
6. Verify required camera ID, calibration dimension validations and
   database permission errors appear in the UI.
7. Verify searching cameras and filtering statuses works, and
   Admin deletion removes the camera from the directory. Test a Viewer
   cannot create/edit/delete a camera even through direct database APIs.
8. Verify the monitor incident feed opens the review queue; check
   realtime camera and incident subscriptions reconnect after navigation.
9. Test both Chrome/Edge HLS.js and Safari native HLS if supported.
10. Confirm that a browser playback test does not silently mark the
    backend camera as continuously online.

Automated tests cover source capability classification, URL masking and
nonduplicated camera grid selection. GitHub Actions runs the frontend
lint/build/Vitest and deterministic backend suite on pull requests.

## Integration constraints

This PR is based on the current merged main (Phase 2). Security Phase 1
(PR #2), run-scoped History Phase 3 (PR #4) and speeding incidents Phase 4
(PR #5) are separate and unmerged. Avoid treating this camera-preview
foundation as completed live AI inference. Coordinate staging RLS tests
before deploying the other pending database migrations.
