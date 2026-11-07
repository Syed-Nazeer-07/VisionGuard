<div align="center">
  <img src="apps/web/public/favicon.svg" alt="VisionGuard logo" width="68" />
  <h1>VisionGuard</h1>
  <p><strong>Traffic footage → vehicle tracking → reviewable insight.</strong></p>
  <p>Browser-based traffic video analysis with persistent tracking, session history, analytics and incident-review workflows.</p>
  <p>
    <a href="https://github.com/Syed-Nazeer-07/VisionGuard/actions/workflows/ci.yml"><img src="https://github.com/Syed-Nazeer-07/VisionGuard/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
    <img src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6" />
    <img src="https://img.shields.io/badge/YOLO11s-ONNX-263e61" alt="YOLO11s ONNX" />
  </p>
  <p>
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
| **Speed estimates** | See approximate speed labels on tracked vehicles, plus the highest valid visible estimate; unavailable readings display **—** |
| **Fullscreen** | Expand the composite video **with the detection canvas**, not the video alone |
| **Overview & analytics** | Inspect saved sessions, unique vehicle tracks, frame counts and vehicle-class distribution |
| **History** | Revisit account-scoped analysis summaries and see locally retained or explicitly cloud-saved video assets |
| **Incidents** | Automatic high-speed-estimate and stationary-vehicle review candidates plus manual flags; none are confirmed offences |
| **Reports** | Export session/vehicle data as PDF or CSV, and incident-review records as CSV |
| **Accounts & settings** | Email/password access, configurable Google sign-in, user-specific start pages and account settings |

**A single video source is analyzed at a time.** There is no automatic YouTube downloader, unattended stream scraping or multi-camera inference grid.

### How it works

1. **Choose footage:** select a local recording, open a permitted device camera or approve browser-tab sharing.
2. **Track vehicles:** YOLO11s identifies candidates; optical tracking smooths boxes and associates IDs over time.
3. **Review observations:** examine counts and **approximate** speeds. The detector automatically flags sustained high speed estimates and unusually stationary vehicles for review; other events can be flagged manually.
4. **Revisit the session:** use **Overview**, **History**, **Analytics**, **Incidents** and **Reports**. Session metadata is stored locally and synchronized when cloud metadata is configured and available.
5. **Keep video only if you choose:** optionally retain the local original or explicitly upload it to Backblaze B2. Analyzing a file does not automatically upload the video.

### Browser tabs and YouTube Live

Play an authorized YouTube video/live stream in another Edge or Chrome tab, then select **Analyze tab** in VisionGuard and share the playing **browser tab** (not Entire Screen or Window). **No YouTube URL needs to be copied or pasted into VisionGuard.** The optional **Open YouTube** shortcut just opens youtube.com; it does not download or analyze a video. Browser permission remains mandatory.

You can optionally keep an already-approved tab capture connected while visiting other VisionGuard pages; a visible **Stop** control remains available. Browser-tab capture may pause or be throttled by the browser and must be reauthorized after a new browser session. Device cameras are released when hidden.

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
| Vehicle tracks, session totals, review flags | Per-account browser IndexedDB; optional Supabase PostgreSQL sync | Local-first. Cloud history depends on working authentication, network access and database permissions |
| Original selected file | In memory during analysis | Not kept across reloads by default |
| Opted-in local video | Browser-local storage | **Keep this video on this device** depends on browser storage quotas and permissions |
| Explicit cloud video | Backblaze B2 | Uploaded only via **Save video to B2**; requires server-side configuration and may incur storage costs |
| Account credentials and preferences | Supabase Auth / PostgreSQL when configured | Protected by server-side access policies |

The active video/capture component resets when the signed-in account changes, keeping in-memory capture and tracker state from crossing between users.

### Understanding the speed numbers

Image movement alone cannot reliably determine a vehicle's real road speed without appropriate camera geometry and calibration. The live card displays the **highest valid speed estimate for a currently visible tracked vehicle**, not the speed limit, a measured maximum for the entire video or a verified speeding event. Prediction-only boxes do not generate new speed measurements.

**Never use VisionGuard's current speed estimates or review flags as legal enforcement evidence.** Misclassification, occlusion, camera movement, lighting and dropped frames can also affect counts and tracking.

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

Track IDs refer to individual **analysis sessions**, not licence plates. They are not persistent identifiers across unrelated videos.

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
