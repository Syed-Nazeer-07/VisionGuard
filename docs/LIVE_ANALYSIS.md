# VisionGuard live analysis

Live Analysis uses **one browser-side YOLO11s detector** for all supported inputs.
An HLS stream, a remote video, a local file and the browser camera share the
same detection/tracking pipeline. There is no mandatory Python backend.

## Supported sources

| Source | How to open | Notes |
| --- | --- | --- |
| Uploaded video | **Choose video** | An original local file plays immediately. |
| Browser camera | **Use camera** | Requires HTTPS or localhost and permission. Camera tracks stop when you leave/hide the page. |
| Browser tab (including YouTube Live) | **Analyze browser tab** → select the tab playing the live video | Explicit browser permission is required for every capture. Captures visible tab pixels, not extracted stream URLs. |
| HLS stream | **Live sources** → enter a `.m3u8` URL | The source needs a compatible codec and cross-origin access for frame analysis. |
| Remote video | **Live sources** → enter a video URL | Direct HTTP(S) video playback; a finite file is not a continuous live camera. |

### YouTube Live and browser tab analysis

YouTube page URLs are not direct HLS streams and cannot be pasted as if they
were `.m3u8` files. For a live video you are permitted to analyze:

1. Open the YouTube Live page in a separate Edge/Chrome tab and start playback.
2. Return to VisionGuard → **Live analysis** → **Analyze browser tab**.
3. In the browser's sharing picker, **select the tab** playing the YouTube live
   video (not the VisionGuard tab), and explicitly approve sharing.
4. VisionGuard reads the shared tab's visual frames using the existing local
   YOLO11s worker. Stop with **Stop tab capture** or the browser's stop-sharing
   control. Capture also stops when VisionGuard is hidden or the analysis page
   is left.

This is opt-in screen capture: no Puppeteer, network extraction, YouTube
downloading, cloud relaying or automatic recording is performed. The video
remains at its original source. The quality and speed depend on tab playback,
capture frame rate and YOLO hardware performance. Use it only where you have
the necessary rights/permissions. Browser sharing permissions cannot be
persisted or silently bypassed.

Saved source choices are presented as cards and can be switched. Exactly **one**
source is analyzed at a time; there is no multi-camera simultaneous inference.

### Not supported in the browser directly

- **RTSP/RTMP camera URLs:** convert to authenticated, CORS-enabled HLS using a
  server-side gateway before adding the source. Do not expose camera credentials
  or a private video feed publicly.
- **Cross-origin video without CORS:** playback can sometimes work, but the
  browser cannot legally read pixels for vehicle AI. Configure the feed to
  allow access from the VisionGuard web origin.
- **Secret-bearing signed URLs:** do not store credentials inside saved stream
  URLs. Use a secure authenticated relay for private sources.

## How to analyze a live feed

1. Sign in and navigate to **Live Analysis**.
2. Click **Live sources**; provide a descriptive name and the HLS/video URL.
   Saved source configurations persist locally and sync to your account while
   online. Select a source card to switch.
3. The video plays while YOLO11s detects and tracks vehicles. The overlay is
   painted each display frame, but true AI inference may be slower than the
   video on CPU/WASM hardware.
4. A status label indicates **connecting**, **live**, **buffering**,
   **reconnecting** or **offline**. Retry a failed source with **Reconnect stream**.
5. The **Dashboard**, **Analytics**, **History** and **Reports** use the same
   saved per-user tracking summaries. A raw detection is not automatically a
   verified traffic violation.

Camera permission is never requested until **Use camera** is clicked. Tab
sharing is never requested until **Analyze browser tab** is clicked. Neither
feed is saved or uploaded automatically.

## Storage and retention

- Saved stream **names and URLs**: small account-owned database records
  (with local offline copies). The URL's continued availability depends on
  the source provider.
- Tracked vehicle **metadata/history**: local-first, synced to authenticated
  owner-only cloud records when available. Online sync is not instantaneous.
- Original uploaded **video files**: only retained locally when the user
  checks **Keep this video on this device**, or uploaded to **Backblaze B2**
  when the user explicitly clicks **Save video to B2**.
- **Live stream recording:** not implemented. Adding a stream source does not
  make its historical footage permanent. A recording pipeline with explicit
  user consent, retention limits and storage costs would be a separate feature.

Do not treat approximate image-derived km/h values as speed-enforcement
evidence. A calibrated camera/road-plane mapping is required for reliable
physical speed measurements.

## Deployment requirements

- The browser's Supabase Auth URL and public publishable key go in
  `apps/web/.env.local` for authenticated accounts and B2 upload signing.
- B2 secrets remain in the **server-side** signing service and are never
  exposed through `VITE_*` variables.
- The remote stream host must allow browser playback/CORS.
- The YOLO11s ONNX model must exist at `apps/web/public/models/yolo11s.onnx`.
- An unsupported codec, inaccessible HLS playlist or slow WASM inference can
  still limit live analysis; a successful build does not validate a feed.
