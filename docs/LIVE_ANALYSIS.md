# VisionGuard · Live Analysis

VisionGuard uses its existing browser-side YOLO11s worker to analyze local
video files, permission-granted device cameras, and user-approved browser
tab video. There is **no automated YouTube URL extraction**, Puppeteer
service, public-camera directory, or source-recorder in this version.

## YouTube Live

1. Open **Live analysis**, then **YouTube Live**.
2. Paste a YouTube watch/live/channel-live page link and select
   **Open YouTube**. The page opens in a new tab. Start video playback there.
3. Return to VisionGuard. Select **Analyze browser tab**.
4. In the Edge or Chrome sharing picker, choose **Microsoft Edge Tab**
   or **Chrome Tab**, then choose the tab that plays the video.
   Do **not** choose Entire Screen or Window: when you switch back to
   VisionGuard, those would display VisionGuard instead of the video.
5. Your approved tab capture is analyzed locally by YOLO11s. Stop it with
   **Stop tab capture**, the browser's sharing indicator, or the workspace's
   **Stop** control.
6. An optional **Keep sharing on other VisionGuard pages** checkbox keeps
   the already-approved tab connected while you view the dashboard,
   history or reports. Inference pauses away from Live Analysis and
   resumes when you return. A visible header indicator with a Stop control
   remains present throughout the workspace.

Chrome and Edge may focus the video tab when sharing begins. Returning to
VisionGuard should **not** discard that permission. VisionGuard attempts to
resume its preview if the browser paused it.

## What is and isn't persistent

- **Recent YouTube links:** up to six links are saved *on this device* and
  separated by signed-in account. They survive refreshes and can be opened
  again. A video link is not a downloaded video.
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
  YouTube stream may produce no new detections.
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
