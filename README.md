# VisionGuard

**Traffic video analysis and vehicle tracking, with account-owned history and review workflows.**

VisionGuard is a React/TypeScript application for processing traffic video, showing vehicle detections, recording tracked activity, and organizing review flags, analytics, and reports. The browser runs YOLO11s via ONNX Runtime Web; a separate local Python service is available for optional offline processing.

> **Release state: v1 core workflow / verification candidate.** The frontend builds and unit tests run in CI. Physical camera behavior, external video capture, model accuracy, B2 credentials, Google OAuth, and deployment must still be checked end-to-end before calling an installation production-ready. Speeds are approximate and not usable as enforcement evidence.

## What the application does

| Area | Current behavior |
| --- | --- |
| Live Analysis | Open an uploaded video, device camera, or a user-approved browser tab; draw YOLO11s vehicle tracks on the video, including composite fullscreen |
| Overview | Session totals, tracked vehicle counts, completed inference frames, and review-flag counts |
| Analytics | Class distribution and saved sessions filtered by time window |
| History | Saved analysis sessions and a list of original videos explicitly uploaded to Backblaze B2 |
| Incidents | Create **pending-review flags** for observed events or a suspected speed estimate; these are not verified offences |
| Reports | Download PDF vehicle/session reports, vehicle CSV, and incident-review CSV |
| Settings | Account profile, user-specific workspace start page, and password updates |
| Authentication | Supabase email/password and optional Google OAuth, with Admin roles controlled by server-owned profiles |

**One analysis source is active at a time.** There is no autonomous YouTube URL downloader or simultaneous multi-camera grid.

### Source playback and capture

- **File upload:** Choose a local video and analyze it without uploading it to any server.
- **Device camera:** Camera permission is requested on demand; the camera is released when the page is hidden.
- **YouTube Live:** Open the video in another browser tab. In Live Analysis, choose **Analyze browser tab**, select that tab in Edge/Chrome, and explicitly approve sharing. Pasting a YouTube URL does **not** give VisionGuard permission to extract the stream. Optionally keep an already-approved tab connected while navigating within the workspace, with a visible Stop button. Sharing permission cannot silently survive a browser restart.
- **Fullscreen:** The composite player enters browser fullscreen with tracking boxes over the video. Press Escape to exit.

See [Live analysis instructions](docs/LIVE_ANALYSIS.md).

## Data and privacy

| Data | Location | Retention |
| --- | --- | --- |
| Vehicle tracks, session counts, review flags | Browser IndexedDB; authenticated Supabase Postgres sync when available | Account scoped; session summaries retained until removed through supported workflows |
| Original uploaded video | Not retained by default | Optional **Keep on this device** stores a local copy (subject to browser quotas) |
| Explicitly cloud-saved original video | Backblaze B2 via authenticated server-side signing | Stored only after user selects **Save video to B2**; storage costs and configured lifecycle policies apply |
| Auth accounts and workspace settings | Supabase Auth and PostgreSQL | Access is restricted by server-side policies |
| Recently opened YouTube links | Browser localStorage, separately per account | Up to six recent URLs; not video bytes and not a persistent screen-sharing grant |

**Supabase Storage is not the destination for original uploaded video files.** Supabase supplies authentication, metadata and upload authorization; Backblaze B2 holds cloud video objects. Secret keys must remain server-side.

**Speed caveat:** An arbitrary camera does not provide sufficient geometry to establish true road speed from pixels alone. VisionGuard's browser speed labels are estimates. A saved speed-review flag is a request for human verification, not a legal speeding violation.

## Run locally (Windows / Surface Laptop / other systems)

Prerequisites: a current supported Node.js LTS release with npm. Browser AI works in modern Chromium browsers; accelerated execution depends on the device, and WebAssembly fallback may be slower.

```powershell
git clone https://github.com/Syed-Nazeer-07/VisionGuard.git
cd VisionGuard
npm install
npm run dev
```

Open `http://localhost:3000`. On existing clones:

```powershell
git status --short
git pull --ff-only origin main
npm run dev
```

**Model setup:** The YOLO ONNX model binary is not tracked in Git. Place a compatible YOLO11s model at `apps/web/public/models/yolo11s.onnx` before using the in-browser detector. Verify the model's input/output contract and licensing; see [model setup](docs/MODEL_SETUP.md).

The optional local Python backend is documented in [backend/README.md](backend/README.md). The current browser-side live-analysis flow does **not** require it.

### Authentication and B2 configuration

Copy `apps/web/.env.example` to `apps/web/.env.local`:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_YOUR_PUBLIC_KEY
VITE_VIDEO_STORAGE_PROVIDER=b2
```

Restart `npm run dev` after changing Vite variables. These are **public browser** settings; never put `service_role`, `sb_secret_*`, Google client secrets, or Backblaze application keys in `VITE_*` variables.

Backblaze credentials and the signing function live on the server side and must be configured separately. Until they are configured, local analysis can work but B2 upload cannot.

Google sign-in requires enabling the provider and redirect allowlist in Supabase and configuring Google Cloud credentials. See [Google sign-in setup](docs/GOOGLE_SIGN_IN.md).

## Architecture

```text
Browser (React / Vite)
  ├─ Video, webcam, or user-shared tab
  ├─ YOLO11s ONNX Runtime Web Worker (WebGPU / WASM)
  ├─ Optical tracking, bounded prediction, fullscreen canvas
  └─ Analysis session ledger
       ├─ IndexedDB per signed-in owner
       ├─ Supabase Auth + Postgres sync (RLS)
       └─ Overview / History / Analytics / Incidents / Reports

Original video: optional local copy OR explicit upload to Backblaze B2.
Python FastAPI analysis service: optional, separate from browser live workflow.
```

The live tracker assigns vehicle IDs **within an analysis session**. Those identifiers are not licence plates and are not globally unique across different videos. Counts, classifications, and speeds may be affected by occlusion, motion blur, missing frames, or model error.

## Testing

```powershell
npm run lint
npm run build
npm run test -w web
```

Optional backend checks:

```powershell
cd backend
python -m pytest
```

GitHub Actions runs frontend lint, TypeScript/build, unit tests, and deterministic backend checks. Successful CI verifies code behavior covered by tests, **not** browser/camera compatibility or traffic recognition quality on real footage.

## Current release limitations

- Motorcycle detection and truck/bus classification remain model-dependent; human validation is necessary.
- No real-world calibration or reliable automatic speeding offence detection is currently established.
- YouTube/Edge tab sharing requires user consent each time; the browser can throttle background video capture.
- Original video persistence depends on user choices, local storage quotas, B2 configuration and connectivity.
- Google sign-in is implemented in the UI but cannot work until OAuth provider credentials/redirects are configured.
- Legacy admin/archive screens and some lint warnings remain; full deployment and cross-device verification are still outstanding.

## Repository

- `apps/web/` — live web application and browser-side analysis pipeline
- `backend/` — optional Python processing service and its tests
- `supabase/migrations/` — database schemas and access policies (retain migration history)
- `supabase/functions/` — authenticated server-side functions
- `docs/LIVE_ANALYSIS.md` — user-approved browser-tab workflow
- `docs/GOOGLE_SIGN_IN.md` — Google OAuth provider setup
- `scripts/` and `Start-VisionGuard.bat` — development helpers

**Next planned capabilities (not part of the current release):** calibrated speed measurements, plate OCR, automated rule verification, multi-camera analysis, and independently validated enforcement evidence.

See [release acceptance checklist](docs/RELEASE_CHECKLIST.md) for the real-device, OAuth, B2 playback and deployment checks required before marking a production installation verified.
