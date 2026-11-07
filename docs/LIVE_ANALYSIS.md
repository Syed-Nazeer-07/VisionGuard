# VisionGuard — Live Analysis

The app's built-in YOLO11s detector can analyze three kinds of inputs:

| Source | How to start |
| --- | --- |
| Local file | **Choose video** (runs locally, no upload required) |
| Browser camera | **Use camera** (explicit permission on HTTPS or localhost) |
| YouTube Live or public traffic-camera webpage | Open its page in another tab, click **Analyze browser tab** in VisionGuard and choose the video tab |

There is no longer an HLS/RTSP URL picker in Live Analysis. A webpage URL
(such as YouTube's `/live/` URL) is not a direct video media endpoint. The
old saved-stream-source editor was removed from the user interface because
it could not analyze ordinary YouTube links.

## Analyzing YouTube Live or public traffic-camera pages

1. Open VisionGuard → **Live analysis**.
2. Click **Traffic camera sites** to open one of the public camera websites,
   or paste any public YouTube Live page URL and choose **Open video page**.
   The webpage opens in its own browser tab.
3. Start playing a traffic video on that tab.
4. Return to VisionGuard and click **Analyze browser tab**.
5. In Edge/Chrome's picker, choose **Chrome Tab**/**Microsoft Edge Tab**
   (the wording varies) and select the actual video-playing tab. Authorize
   sharing. If Edge switches to that tab automatically, simply return to
   VisionGuard: the share is deliberately **not stopped** when VisionGuard
   loses focus.
6. The existing YOLO11s worker samples the captured pixels, while the app
   displays vehicle tracks. Use **Stop tab capture** or your browser's
   stop-sharing control to end capture.

**Important:** Prefer sharing the video tab, **not Entire Screen**.
If you share the entire screen and then return to VisionGuard, the shared
pixels will contain VisionGuard instead of the YouTube footage, possibly
creating a hall-of-mirrors preview. A short explanation appears if the
browser reports screen capture instead of tab capture.

## Public camera websites

VisionGuard's **Traffic camera sites** section links to third-party
resources. Their content is not hosted, scraped or republished by VisionGuard.
Check each camera's availability and terms before analysis.

- [Virginia 511](https://www.511virginia.org/) — traffic cameras; many
  provide live video
- [Tennessee SmartWay](https://smartway.tn.gov/) — official highway camera
  map and travel information
- [Caltrans QuickMap](https://quickmap.dot.ca.gov/) — camera map; some entries
  offer video while others provide periodically updated still images

A still-image feed is not appropriate for continuous tracking. If a
camera stream stops or the website limits playback duration, the analysis
will likewise stop receiving new useful frames.

## Capture, privacy and limitations

- **Tab selection is explicit.** The browser may automatically switch tabs
  when you begin sharing; VisionGuard keeps that capture active. Capture
  automatically stops if you leave Live Analysis, close the app, stop sharing,
  or the browser revokes access. You can also stop it manually.
- **Webcam selection is separate.** The device camera releases on tab hide,
  unlike the browser-tab share. This avoids unexpected camera access.
- **No silent recording.** Sharing a tab or opening a public website does not
  automatically save footage to a file, Backblaze B2, or Supabase Storage.
- **No background-performance guarantee.** Browsers may throttle video
  processing in background tabs. Keep VisionGuard visible to inspect detection
  results; when you return, it should resume using the still-active share.
- **Exactly one source** is analyzed at once. No simultaneous camera grid or
  autonomous Puppeteer browser exists in this implementation.
- Some websites may prohibit capture/analysis, restrict access, or display
  DRM-protected content. Use feeds you are authorized to analyze.
- Motion-based speed estimates are **uncalibrated** and are not suitable for
  enforcement or official traffic-violation findings.

## Storage architecture

- An uploaded video can play without cloud storage.
- **Keep this video on this device** is an optional local-only copy.
- **Save video to B2** explicitly uploads an original file to **Backblaze B2**.
- Account login, user roles and small tracking-history metadata use Supabase
  Auth/Postgres. Original video bytes are not stored in Supabase Storage.
- Tracked-vehicle session summaries are stored locally and synchronized to
  authenticated owner-only cloud records when available.
- Live tab or camera recordings are **not** implemented. Selecting a source
  website and saving tracked metadata does not make its video footage
  permanently available.

## Diagnostics

If the preview disappears when selecting a new tab, confirm you pulled the
latest `main` changes and restarted Vite. Use **Stop tab capture** and
share the video tab again. If an entire-screen share shows VisionGuard
instead of traffic, use the browser's **Tab** option instead.

The YOLO model is expected at `apps/web/public/models/yolo11s.onnx`;
recognition and frame rates depend on hardware, codecs, and the original
camera's image quality. Passing CI tests does not establish real-time
accuracy on every live feed.
