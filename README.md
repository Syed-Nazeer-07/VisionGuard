<div align="center">
  <img src="apps/web/public/favicon.svg" alt="VisionGuard logo" width="68" />
  <h1>VisionGuard</h1>
  <p><strong>Traffic footage → vehicle tracking → reviewable insight.</strong></p>
  <p>Browser-based traffic video analysis with persistent tracking, session history, analytics and incident-review workflows.</p>
  <p>
    <a href="https://visionguard.syednazeerofficial2007.workers.dev/"><img src="https://img.shields.io/badge/Live%20App-Open%20VisionGuard-2563EB?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Open the live VisionGuard application" /></a>
  </p>
  <p><a href="https://visionguard.syednazeerofficial2007.workers.dev/"><strong>🌐 Try VisionGuard live</strong></a></p>
  <p>
    <a href="https://github.com/Syed-Nazeer-07/VisionGuard/actions/workflows/ci.yml"><img src="https://github.com/Syed-Nazeer-07/VisionGuard/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
    <img src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6" />
    <img src="https://img.shields.io/badge/YOLO11s-ONNX-263e61" alt="YOLO11s ONNX" />
  </p>
  <p>
    <a href="https://visionguard.syednazeerofficial2007.workers.dev/">Live application</a> ·
    <a href="#features">Features</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#data-and-privacy">Privacy</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#release-status">Release status</a> ·
    <a href="docs/CLOUDFLARE_PAGES.md">Deployment</a>
  </p>
</div>

---

VisionGuard runs **YOLO11s object detection in your browser** using ONNX Runtime Web, then combines detections with optical tracking to maintain vehicle boxes and IDs across video frames. The same saved analysis records feed the overview, history, analytics, review flags and reports. A separate **Python/FastAPI backend is optional**, not a requirement for browser live analysis.

> **v1 core workflow · release candidate.** The code passes automated checks, but real-world detector accuracy, browser-tab capture, OAuth, Backblaze B2, device performance and hosted deployment require end-to-end acceptance testing. **Estimated speed is not a calibrated or legally verified measurement.**

## Features

| Workspace area | What you can do |
| --- | --- |
| **Live analysis** | Analyze a local video, authorized browser tab or device camera using the browser-side YOLO11s worker |
| **Detection & tracking** | View vehicle classes, stable session-level IDs and tracked boxes that expire when vehicles leave the frame |
| **Speed estimates** | See clearly marked **uncalibrated optical speed proxies** (km/h*), not measured road speeds; unavailable readings display **—** |
| **Fullscreen** | Expand the composite video **with the detection canvas**, not the video alone |
| **Overview & analytics** | Inspect saved sessions, **repeatedly observed track IDs** (excluding brief/noisy candidates), frame counts and class distribution |
| **History** | Revisit saved analysis; incomplete B2 uploads open a local-recovery screen. A matching opted-in retained original (filename + byte length) can reopen automatically; otherwise **Choose original video** |
| **Incidents** | Automatic high-speed-estimate and stationary-vehicle candidates, compact manual entry, and **Mark reviewed / Dismiss / Reopen** actions with status filters; none are confirmed offences |
| **Reports** | Export session/vehicle data as PDF or CSV, and incident-review records as CSV; **pending, reviewed and dismissed** flags retain their status |
| **Accounts & settings** | Email/password access, configurable Google sign-in, user-specific start pages and account settings |

**A single video source is analyzed at a time.** There is no automatic YouTube downloader, unattended stream scraping or multi-camera inference grid.

### How it works

1. **Choose footage:** select a local recording, open a permitted device camera or approve browser-tab sharing.
2. **Track vehicles:** YOLO11s identifies candidates; optical tracking smooths boxes and associates IDs over time.
3. **Review observations:** examine counts and **approximate** speeds. Sustained high-speed estimates and unusually stationary vehicles create **automatic review candidates**. Use Incidents to review, dismiss or reopen them; optional manual flags remain available.
4. **Revisit the session:** use **Overview**, **History**, **Analytics**, **Incidents** and **Reports**. Session metadata and reviewer decisions are stored locally and synchronized when cloud metadata is configured and available. Returning to a visible page can refresh newer account-scoped cloud records.
5. **Keep video only if you choose:** optionally retain the local original or explicitly upload it to Backblaze B2. Analyzing a file does not automatically upload the video.

### Browser tabs and YouTube Live

Play an authorized YouTube video/live stream in another Edge or Chrome tab, then select **Analyze tab** in VisionGuard and share the playing **browser tab** (not Entire Screen or Window). **No YouTube URL needs to be copied or pasted into VisionGuard.** The optional **Open YouTube** shortcut just opens youtube.com; it does not download or analyze a video. Browser permission remains mandatory.

You can optionally keep an already-approved tab capture connected while visiting other VisionGuard pages; a visible **Stop** control remains available. Browser-tab capture may pause or be throttled by the browser and must be reauthorized after a new browser session. Device cameras are released when hidden. During muted or frozen live capture, stale tracking boxes are hidden rather than presented as current detections; after a lengthy interruption, tracking restarts from new visual evidence.

See the [live analysis guide](docs/LIVE_ANALYSIS.md) for the complete workflow and troubleshooting.

## Quick start

### 1. Install and run

Prerequisites: Git, a current supported **Node.js LTS** release with npm, and a modern Chromium-based browser (Edge or Chrome recommended).

~~~powershell
git clone https://github.com/Syed-Nazeer-07/VisionGuard.git
cd VisionGuard
npm ci
npm run dev
~~~

Open **http://localhost:3000**.

### 2. Provide the browser AI model

The ONNX model binary is **not included in Git**. The browser detector expects:

~~~text
apps/web/public/models/yolo11s.onnx
~~~

Place a compatible, appropriately licensed **YOLO11s** ONNX export there. The frontend expects the relevant COCO classes and a compatible input/output tensor contract; an arbitrary ONNX model—or a different YOLO variant—is not guaranteed to work. See [model setup and validation](docs/MODEL_SETUP.md).

> Without the model, the UI may load and the video may play, but **AI detection will not start**. The separate export workflow for **YOLO11n** is not a substitute for a compatible **YOLO11s** browser model.

### 3. Connect an account (optional for local demo)

To enable Supabase authentication and account metadata synchronization, copy:

~~~powershell
Copy-Item apps/web/.env.example apps/web/.env.local
~~~

Update **apps/web/.env.local** with your own project values:

~~~env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
VITE_VIDEO_STORAGE_PROVIDER=b2
~~~

Restart Vite after changing environment variables. These are **browser-public** configuration values, not secret credentials. Never put Supabase service-role or secret keys, Google client secrets or Backblaze application keys in any `VITE_*` variable.

**Without valid Supabase configuration**, VisionGuard uses a **local demo adapter**. Some legacy screens may show **sample records**, which are not real camera feeds, genuine detections or verified incidents. A configured account and correct database policies are necessary for authenticated cloud metadata synchronization.

**Backblaze B2** is the optional destination for original cloud-saved video files. B2 requires a separately configured, authenticated server-side signing function and credentials. **Supabase Storage is not used for the original video files** in this workflow. For Google OAuth, follow the [Google sign-in guide](docs/GOOGLE_SIGN_IN.md).

### Live deployment

**[Open VisionGuard — live Cloudflare application](https://visionguard.syednazeerofficial2007.workers.dev/)**

The application is deployed to Cloudflare Workers. Sign in to access the
analysis workspace. The hosted URL is public; some workflows require
browser capture permission, an available YOLO11s model and correctly
configured authentication. **Deployment does not itself verify real-world
vehicle-detection accuracy or every optional integration.**

### Deploy the browser app on Cloudflare

VisionGuard includes a production build guard and support for hosting its
YOLO11s model at a public HTTPS URL when ONNX weights exceed Cloudflare's
25 MiB static-file limit. This lets the browser workflow run on Cloudflare Workers static assets
or Pages without a sleeping Python backend.

**[Cloudflare deployment guide](docs/CLOUDFLARE_PAGES.md)** covers
the exact build settings, Hugging Face model hosting, the matching ONNX
Runtime CDN, Supabase login/OAuth redirects and real-site acceptance tests. A passing CI badge does not mean a site has
been published or that the model, authentication and uploads are verified.

### Returning to an existing clone

~~~powershell
git status --short
git pull --ff-only origin main
npm ci
npm run dev
~~~

Review or commit any local modifications before pulling if Git reports a conflict. The Python processing backend, when needed, is documented separately in [backend/README.md](backend/README.md).

## Data and privacy

| Data | Stored where | Important behavior |
| --- | --- | --- |
| Vehicle tracks, session totals, review flags | Per-account browser IndexedDB; optional Supabase PostgreSQL sync | Local-first. Cloud writes verify server acknowledgments, retry bounded conflicting revisions and preserve merged local history if sync remains unavailable |
| Original selected file | In memory during analysis | Not kept across reloads by default |
| Opted-in local video | Browser-local storage | **Keep this video on this device** retains the most recently saved local file, subject to browser quotas/permissions; it does not upload it |
| Explicit cloud video | Backblaze B2 | Uploaded only via **Save video to B2**. Metadata without the actual uploaded original cannot replay on another device |
| Account credentials and preferences | Supabase Auth / PostgreSQL when configured | Protected by server-side access policies |

The active video/capture component resets when the signed-in account changes, keeping in-memory capture and tracker state from crossing between users.

### Recover an archived video without an uploaded original

If you select a video in the cloud archive but its B2 upload is missing,
**Live Analysis will no longer stop at a raw storage error**. It checks
the opted-in retained copy on the **same device and signed-in account**.
If the stored filename **and exact file size** match, it opens that local
video as a new analysis. This is a conservative recovery heuristic, **not
cryptographic identity verification**. The original remains local; the
recovery does not automatically upload it to B2.

Otherwise, VisionGuard shows **Choose original video**. Select your own
footage from the device to analyze it afresh. Previously saved detection
summaries remain available in History. A filename alone is not enough to
assume an unrelated retained video belongs to an archived session.

**Important:** analysis metadata cannot recreate the original footage.
If its cloud copy was never uploaded and the local original is gone, it
cannot be recovered from VisionGuard. For cross-device playback, explicitly
use **Save video to B2** and confirm the upload finishes.

### Understanding the speed numbers

Image movement alone cannot reliably determine a vehicle's real road speed without appropriate camera geometry and calibration. VisionGuard's `km/h*` label is a **relative optical speed proxy** based on assumed vehicle widths and image movement, **not a calibrated road-speed measurement**; it can materially under- or over-estimate actual driving speed. The live card shows the highest available proxy among currently visible tracks, not a road speed limit or verified speeding event. Prediction-only boxes do not create new measurements.

**Never use VisionGuard's current speed estimates or review flags as legal enforcement evidence.** A flag marked **Reviewed** only records a user workflow decision; it does not establish a violation. Misclassification, occlusion, camera movement, lighting and dropped frames can also affect counts and tracking.

## Architecture

~~~text
React / TypeScript / Vite (browser)
  ├── Local video · permission-granted camera · approved browser tab
  ├── YOLO11s ONNX Runtime Web Worker (WebGPU when available; WASM fallback)
  ├── Optical tracking + bounded prediction + synchronized video overlay
  └── Local-first analysis activity ledger (per account)
       ├── IndexedDB
       ├── Supabase Auth + PostgreSQL metadata sync (RLS)
       └── Overview · History · Analytics · Incidents · Reports

Original video: optional local retention or explicit Backblaze B2 upload
Optional Python service: FastAPI analysis backend (separate workflow)
~~~

Track IDs refer to individual **analysis sessions**, not licence plates. Dashboard and analytics totals now count only IDs observed repeatedly (at least two observations spanning 0.18 seconds at adequate detection confidence). Short-lived candidates remain available in raw exports. **ID switches after occlusion can still count one physical vehicle more than once**; no cross-session re-identification is claimed.

## Browser tracking evaluation

For reproducible measurements, open
[Live Analysis in quality mode](https://visionguard.syednazeerofficial2007.workers.dev/app/analyze?quality=1)
and download an **opt-in, local-only QA trace**. After independently labelling
the source-video frames, run the
[tracking quality scorecard](docs/BROWSER_TRACKING_EVALUATION.md) to measure
precision, recall, identity switches and lingering boxes after scene exits.

The trace includes **no video bytes**, and synthetic tests do not establish
real-world detector performance. The historical Python YOLO11n benchmark
does **not** measure the browser YOLO11s system.


### Cross-device incident history

Review decisions retain their original incident evidence and include an
optional decision timestamp. VisionGuard now checks the **actual returned
Supabase revision** after each analysis-record upsert. If another signed-in
browser has newer history, the app merges distinct incident flags and vehicle
observations, keeps the newer explicitly timestamped review decision, and
retries synchronization up to three times. Failed sync remains **local and
visible as a warning** rather than being marked as a successful backup.

Continuous inference updates arriving while a previous cloud write is in
flight are now queued for the next upload rather than misreported as a
three-attempt conflict. A scheduled upload also covers the final revision
when a video stops during the cloud throttle interval.

This is *best-effort owner-scoped metadata synchronization*, **not**
transactional multi-user collaboration. Simultaneous decisions from
devices with incorrect clocks, separate offline edits to the same tracking
fields, and network failures can still require manual verification. Testing
on two signed-in devices is part of the release checklist. RLS and the
database's existing anti-stale-update trigger remain unchanged.

## Testing

From the repository root:

~~~powershell
npm run lint
npm run build
npm run test -w web
~~~

Optional Python backend tests (with backend dependencies installed):

~~~powershell
cd backend
python -m pytest
~~~

[GitHub Actions CI](.github/workflows/ci.yml) runs frontend lint, TypeScript/build checks, unit tests and deterministic backend checks. **A successful build does not verify that model weights exist or that detections are accurate on real footage.** WebGPU/WASM performance is hardware-dependent, particularly on Windows on ARM.

## Release status

**Current scope:** v1 core workflow / verification candidate, not a certified traffic-enforcement platform.

Before a production deployment is presented as verified, the following still need real-world acceptance testing:

- Detection, speed-overlay behavior, fullscreen and frame-edge tracking on representative videos and target hardware.
- Automatic candidate rules reviewed against real labeled footage to assess false positives and missed events.
- Authorized YouTube-tab capture, focus changes, browser permissions and camera lifecycle.
- Account sign-up, confirmation and recovery, Google OAuth, and account isolation.
- Backblaze B2 upload, authorized playback, re-analysis, retention and permissions.
- HTTPS deployment, backups, rate limits and outstanding staging security/performance review findings.

See the [release acceptance checklist](docs/RELEASE_CHECKLIST.md), including the latest connected staging-database review.

**Future capabilities, not current claims:** calibrated road-speed measurements, licence-plate OCR, validated automatic violation classification and simultaneous multi-camera inference.

## Repository guide

| Location | Purpose |
| --- | --- |
| [`apps/web/`](apps/web/) | React UI, tracking pipeline, browser worker and application tests |
| [`backend/`](backend/) | Optional FastAPI analysis service and evaluation utilities |
| [`supabase/migrations/`](supabase/migrations/) | Versioned database schema and access-control policies |
| [`supabase/functions/`](supabase/functions/) | Authenticated server-side operations and video signing |
| [`docs/`](docs/) | Model setup, [Cloudflare deployment](docs/CLOUDFLARE_PAGES.md), live analysis, authentication and release validation |
| [`scripts/`](scripts/) | Development, model-validation and optional backend helpers |

---

<div align="center">
  <strong>VisionGuard</strong><br />
  <sub>Observe traffic. Track responsibly. Review before enforcement.</sub>
</div>
