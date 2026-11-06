# Phase 6 — Browser HLS → YOLO/ByteTrack camera inference

This is a **stacked PR** based on Phase 5
(`feat/phase5-camera-monitoring-foundation`), NOT current `main`.

## What the browser actually does

1. Monitor → an HLS camera → **AI Detect** navigates to
   `/app/camera-inference/<camera-id>`.
2. Supabase looks up that particular nondeleted camera, and camera source
   validation accepts only HTTP(S) `.m3u8` HLS manifests.
3. Hls.js or native HLS decodes the stream in a CORS-enabled HTML video
   element. Browser playback must begin before **Start AI Detection**
   becomes available.
4. The model preflight checks `/models/yolo11n.onnx` for a real model
   response (not the SPA HTML fallback), then creates the existing ONNX
   worker with WebGPU → WASM fallback.
5. Each `requestVideoFrameCallback` delivers a newly presented frame,
   transferred via `createImageBitmap(video)` to the single inference
   worker. Older browsers can use the guarded media-time fallback.
6. An `InferenceCoordinator` enforces **one outstanding request**, rejects
   stale/out-of-order results, and tracks dropped frames. The frame time
   is the browser's monotonic presentation time, not HLS mediaTime (which
   may jump on stream discontinuities).
7. Existing YOLO postprocessing / ByteTrack returns vehicle tracks.
   Existing `drawBoundingBoxes` renders only timely overlays, scaled
   to source-frame resolution.
8. Changing/stopping the stream terminates the worker and removes its
   listeners, callbacks and ImageBitmap ownership. Worker stalls stop
   inference with a visible error.

## Model prerequisite — IMPORTANT

The repo **does not contain the ONNX weight file**. Do not assume the
camera model will load after merging. A compatible, authorized ONNX model
matching the app's YOLO11n output contract must be placed at:

`apps/web/public/models/yolo11n.onnx`

The app's detector/postprocessor currently assumes a particular 640×640
YOLO output shape and class mapping; check the actual exported model
before enabling real deployments. The model is not committed by this
PR. The UI reports missing/HTML-fallback model responses explicitly.

## Privacy and scope

- **No Supabase writes** from camera AI preview; no video/history saving,
  automatic incidents, report generation or OCR.
- Worker `collectEvidence: false` disables expensive vehicle crop and
  plate-evidence collection for camera preview. The normal uploaded-video
  analysis worker keeps its existing behavior.
- All camera feature flags are **false** (speeding, red light, lane,
  helmet, triple riding, plate). No legal traffic violation/plate claim.
- Saved Scene Setup polygons are **not yet** used in live camera inference.
  Speed limits and calibration would require measured, reviewed geometry
  and separate validation.
- Video bytes are still accessed by the user's browser. An upstream HLS
  gateway must explicitly allow origin/segment CORS, video codecs and
  authenticated streaming as appropriate. Remote RTSP and YouTube
  ingestion are **not** implemented by this PR.
- The camera source URL could be a credential-bearing signed HLS URL.
  This app does not yet provide a secure server-side stream-token proxy
  and should not be exposed to untrusted Viewer roles if source URLs
  themselves are confidential.

## Real-world staging acceptance

1. Merge/validate Phase 5 first. The Phase 6 PR is stacked on its branch,
   so **do not merge Phase 6 directly into main before Phase 5**.
2. Install a compatible authorized YOLO11n ONNX model on staging. Open
   a known compatible public HLS feed with proper CORS and codecs.
3. Open Monitor → AI Detect, and verify video plays before Start becomes
   available. Start and confirm the model's actual provider is reported.
4. Watch multiple moving vehicles: detected boxes and tracked IDs should
   visibly update, with nonzero processed frames. Confirm tracks are
   absent / stale during buffering and after Stop.
5. Validate the server does not receive new incident/evidence/analysis_run
   records from this preview. Confirm browser memory is released when
   leaving the page.
6. Temporarily remove the model file; the page must show a specific
   model-unavailable warning and never report successful detections.
7. Test a cross-origin HLS manifest lacking `Access-Control-Allow-Origin`;
   playback or frame capture must produce a clear error.
8. Test HLS discontinuity/seeks and a stream connection drop. No infinite
   worker backlog or stale boxes should remain on the new video frame.
9. Switch cameras rapidly; verify old worker results never overlay a new
   camera, and no workers remain after page unmount.
10. On devices without WebGPU, check ONNX WASM fallback and CPU
    performance. Running many concurrent feeds is **not** supported.
11. Review security / source-token access before production use.

## Automated checks

`cameraInferencePolicy.test.ts` validates backpressure, stream-gating,
disabled traffic rules and explicit failure on missing/HTML models.
CI runs TypeScript/Vite build and frontend unit tests; it cannot
validate model weights or HLS network/CORS in a headless unit test.

## Further work

- Authenticated RTSP → HLS/WebRTC gateway with health checks and
  secret management.
- Reference-frame calibration transform for camera scenes.
- Run-specific persistence and reviewable incidents for eligible camera
  detections once rules are validated, with idempotent server-side writes.
- Real-world YOLO accuracy, recall, tracker ID-switch and live FPS tests.
