# VisionGuard · Live Analysis

VisionGuard uses its existing browser-side YOLO11s worker to analyze local
video files, permission-granted device cameras, and user-approved browser
tab video. There is **no automated YouTube URL extraction**, Puppeteer
service, public-camera directory, or source-recorder in this version.

## YouTube and browser tab analysis

**No YouTube URL or copy/paste is needed.** VisionGuard does not download,
scrape, embed, or analyze a video directly from its YouTube page link.
The former YouTube URL form was only a bookmark launcher, so it has been
removed from the interface.

1. Open and play a permitted YouTube video/live stream in a separate
   Microsoft Edge or Chrome tab. You can use VisionGuard's small
   **Open YouTube** shortcut or navigate to YouTube normally.
2. Return to VisionGuard → **Live analysis** → **Analyze tab**.
3. In the browser's Share picker, choose the **Edge Tab / Chrome Tab**
   category, select the already-playing YouTube tab and click **Share**.
   Never choose Entire Screen or Window: those can show VisionGuard
   itself when you switch back.
4. VisionGuard analyzes the browser-approved tab video locally with YOLO11s.
   **Stop tab capture** (or the browser's sharing control) ends capture.
   **Keep sharing on other VisionGuard pages** can retain the existing
   user-approved connection while you navigate within the app.

**Why the tab picker is still needed:** browsers require a user gesture
and explicit consent before another site can read tab pixels. VisionGuard
cannot read the YouTube video from a URL or silently select/capture a tab.
A pasted YouTube URL cannot grant that permission.

Chrome/Edge may focus the shared YouTube tab when sharing begins. Returning
to VisionGuard should not revoke sharing; the app attempts to resume the
preview if the browser paused it.

**Stall handling:** VisionGuard only draws live vehicle boxes when the
captured tab/camera has delivered a recent decoded frame. A muted, buffering
or frozen video no longer displays stale detections as if they were live.
After a prolonged frame gap or media-clock restart, optical tracks,
approximate speed estimates and unfinished incident streaks are reset;
the signed-in analysis session and already-used vehicle IDs remain.
It may take another YOLO inference to reacquire vehicles once playback
resumes. The browser can still throttle hidden tabs, and a capture cannot
continue after its sharing permission is revoked.

## What is and isn't persistent

- **Keep sharing on other pages:** this preference is saved locally per
  account. The current capture stays active only after explicit user consent
  and while that same VisionGuard browser tab remains open. The header
  displays an active-capture indicator and a Stop button.
- **Tab/screen sharing permission:** cannot be silently re-granted after
  a browser refresh, app close, browser permission revocation, or switching
  devices. Selecting a tab again is required.
- **Vehicle tracking summaries:** local-first session records synchronize
  to the signed-in user's cloud metadata when available. Continuing a
  currently connected tab across VisionGuard pages keeps the same analysis
  session; stopping and sharing again starts a new session.
- **Original video bytes:** no YouTube footage is recorded/uploaded by
  this workflow. Local files can optionally be retained on the device
  and explicitly uploaded to **Backblaze B2**, never Supabase Storage.
- **Webcam capture:** stops when the app is hidden or its route is left.
  Only a manually approved browser-tab capture has the optional
  cross-page persistence setting.

## Limitations

- One camera/video source at a time; no multi-camera recording or grid.
- Screen-capture availability, frame rate, video decoding, and background
  throttling depend on browser and device. A paused or unavailable
  YouTube stream may produce no new detections. Live inference results
  need actual decoded frames; VisionGuard cannot bypass hidden-tab
  throttling, DRM or browser media-capture permissions.
- The inference worker explicitly releases ONNX output tensors after each
  decoded frame to reduce GPU memory accumulation in long sessions.
  This does not replace real-device stability and memory testing.
- YOLO11s can misidentify vehicles, particularly small motorcycles and
  similar-looking trucks/buses. Browser frame capture doesn't improve
  trained model accuracy by itself.
- Speed shown is an *uncalibrated estimate* and is not suitable for
  traffic enforcement.
- Use only video you have permission to analyze; protected content
  might not allow capture.
- No B2 upload or download occurs without explicit file-upload action.

## Troubleshooting

If the video goes black after the share prompt, check that the selected
surface was an Edge/Chrome **tab** (not a window or entire screen).
Return to VisionGuard, select Play if necessary, or click Stop and choose
the YouTube tab again. Browser security prevents apps from selecting an
existing tab or continuing sharing after a full browser restart without
another permission prompt.

For local development, run the Vite server at
`http://localhost:3000` with the existing YOLO model under
`apps/web/public/models/yolo11s.onnx`.
