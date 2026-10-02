# VisionGuard AI — Master Specification

> **Single source of truth.** All architecture decisions, milestones, and development rules for the VisionGuard AI project live in this document. No other planning document is authoritative.

---

## 1. Project Overview

VisionGuard AI is a browser-based traffic monitoring and violation detection platform. It analyzes video from uploads, webcams, HLS streams, and YouTube; detects vehicles and riders; tracks movement; estimates speed; identifies traffic violations; generates evidence; and provides analytics through a centralized dashboard.

Design principles:

- Zero hosting cost — free-tier infrastructure only.
- Zero GPU servers — all AI inference runs in the browser.
- Privacy by default — uploaded videos never leave the device; only violation data is stored.
- Modular — every AI module can be independently enabled or disabled via feature flags.
- Incremental — every milestone can be built, tested, and committed independently.

---

## 2. Core Decisions (DO NOT CHANGE)

### 2.1 AI Execution

- All AI inference runs **in the browser** using ONNX Runtime Web.
- Prefer **WebGPU**. Automatically fall back to **WASM**.
- Never introduce a GPU inference server.
- Every video source (upload, webcam, HLS, YouTube) becomes a `<video>` element processed by the same TypeScript pipeline.

### 2.2 Backend

- **Supabase** is the sole backend: Auth, PostgreSQL, Storage, Realtime, Edge Functions, Row Level Security, pg_cron.
- No custom authentication backend.
- No custom JWT services.
- No user management API.
- No AI inference API.

### 2.3 Stream Server

A small Python FastAPI server exists **only** for:

| Endpoint | Purpose |
|---|---|
| `POST /ocr` | EasyOCR on plate crop image |
| `GET /probe` | Stream health check (blocks private IPs to prevent SSRF) |
| `POST /relay/youtube` | Proxy YouTube Live HLS manifest with CORS headers |
| `POST /media/youtube` | Download ≤720p mp4, serve with range requests, delete after 2 h |

Nothing else runs on this server.

### 2.4 Storage Policy

**Store permanently:**

- Violations (with evidence snapshots and crops).
- Anonymous traffic statistics (per-minute counts, avg speed, density, heat grid).

**Do NOT store:**

- Non-violating vehicle data.
- Raw traffic footage.
- Uploaded videos.

### 2.5 Human Review

Every detected violation begins as `pending_review`. An authority user must **approve** or **reject** before it becomes an official record.

### 2.6 Feature Flags

Every AI module must be independently enabled or disabled. Disabling a module must never break the pipeline.

Required flags:

```text
speed_detection
plate_detection
helmet_detection
triple_riding_detection
red_light_detection
lane_detection
alerts
```

### 2.7 Scene Setup Per Camera

Speed estimation and violation detection depend on physical calibration. The user draws calibration points, stop line, traffic light box, lane lines, and detection zone on a captured frame. Without scene setup, only raw detection and tracking are available.

---

## 3. Architecture

```text
Upload / Webcam / HLS Stream / YouTube (via relay)
                │
                ▼
     <video> → Frame Sampler → Web Worker:
        YOLO11n detect → ByteTrack → Speed (homography)
        → Helmet model / Rider count / Signal color
        → Rule engine → Plate detector (violators only)
                │
     ┌──────────┴───────────────┐
     ▼                          ▼
Stream Server (HF Space)     Supabase
 /ocr  /relay  /media         Postgres, Auth, Storage,
 /probe                       Realtime, Edge Functions, pg_cron
```

---

## 4. Technology Stack

### 4.1 Frontend

| Category | Technology |
|---|---|
| Framework | React + Vite + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Routing | React Router |
| State | Zustand |
| Data fetching | TanStack Query |
| Charts | Chart.js |
| AI runtime | onnxruntime-web |
| Streaming | hls.js |
| Forms | react-hook-form + zod |
| PDF export | jsPDF |
| Testing | Vitest |

### 4.2 Backend (Supabase)

- PostgreSQL
- Auth
- Storage (private bucket)
- Realtime
- Edge Functions
- pg_cron

### 4.3 Stream Server

- Python 3.11
- FastAPI
- EasyOCR
- yt-dlp
- ffmpeg
- slowapi (rate limiting)
- Docker (port 7860 for Hugging Face Spaces)

### 4.4 Machine Learning

- YOLO11n (general detection, COCO classes)
- Custom helmet detection model (YOLO11n fine-tuned)
- Custom license plate detection model (YOLO11n fine-tuned)
- ByteTrack (tracking, TypeScript implementation)
- EasyOCR (server-side OCR)
- Training on free Colab/Kaggle GPUs
- Export to ONNX (opset 12, simplified)

### 4.5 Hosting

| Service | Platform |
|---|---|
| Frontend | Cloudflare Pages |
| Backend | Supabase (free tier) |
| Stream server | Hugging Face Spaces (Docker) |
| CI/CD | GitHub Actions |

All hosting must remain on free tiers. No paid APIs.

---

## 5. Project Structure

```text
visionguard-ai/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── pipeline/          # AI engine (worker, models, tracker, rules)
│   │   │   ├── components/        # Reusable UI components
│   │   │   ├── pages/             # Route pages
│   │   │   ├── hooks/             # Custom React hooks
│   │   │   ├── services/          # Supabase client, API helpers
│   │   │   ├── lib/               # Geometry, math, utilities
│   │   │   └── tests/             # Vitest test files
│   │   └── public/
│   │       └── models/            # .onnx model files + models.json
│   │
│   └── stream-server/
│       ├── app/
│       │   ├── main.py            # FastAPI app, CORS, rate limits
│       │   ├── ocr.py             # POST /ocr
│       │   ├── relay.py           # POST /relay/youtube
│       │   ├── media.py           # POST /media/youtube
│       │   ├── probe.py           # GET /probe
│       │   └── auth.py            # Supabase JWT verification
│       ├── Dockerfile
│       ├── requirements.txt
│       └── README.md              # HF Space metadata
│
├── supabase/
│   └── migrations/                # SQL schema, RLS, views, cron jobs
│
├── ml/
│   └── notebooks/
│       ├── train_helmet.ipynb
│       └── train_plate.ipynb
│
└── docs/
    ├── CONTEXT.md                 # Rules for AI agent sessions
    ├── PLAN.md                    # This file
    └── evaluation.md              # Model evaluation results template
```

---

## 6. Database Design

### 6.1 Tables

| Table | Columns / Purpose |
|---|---|
| `profiles` | `id` (FK to auth.users), `name`, `role` (admin / authority / viewer), `settings` JSONB |
| `cameras` | `id`, `name`, `location`, `source_type` (upload / webcam / hls / youtube), `source_url`, `status` (online / offline / maintenance), `scene_profile_id` (FK) |
| `scene_profiles` | `id`, `name`, `calibration_points` (4 points + real width/length in meters), `speed_limit`, `tolerance`, `stop_line` (2 points + approach side), `signal_box` (4 points), `lane_lines` (array of polylines, each marked solid or dashed), `detection_zone` (polygon), `enabled_rules` (JSONB array of feature flag names) |
| `analysis_runs` | `id`, `camera_id`, `source_type`, `source_ref`, `started_at`, `ended_at`, `status` (running / completed / paused / failed), `progress` (0–100), `fps`, `total_vehicles`, `total_violations`, `last_processed_offset` |
| `violations` | `id`, `analysis_run_id`, `camera_id`, `type` (overspeed / red_light / lane_change / aggressive_lane_change / no_helmet / triple_riding), `vehicle_type`, `plate_text`, `plate_confidence`, `detection_confidence`, `speed`, `speed_limit`, `signal_state`, `timestamp`, `video_offset`, `snapshot_path`, `crop_paths` (text[]), `review_status` (pending_review / approved / rejected), `reviewed_by`, `review_note`, `ocr_status` (success / pending_ocr / failed), `created_at` |
| `traffic_stats` | `id`, `analysis_run_id`, `camera_id`, `minute_bucket` (timestamptz), `vehicle_counts` (JSONB: {car, motorcycle, bus, truck, person}), `avg_speed`, `density`, `heat_grid` (JSONB) |
| `alerts` | `id`, `violation_id`, `user_id`, `read`, `created_at` |
| `saved_reports` | `id`, `user_id`, `name`, `filters` (JSONB), `created_at` |
| `activity_logs` | `id`, `user_id`, `action`, `target_type`, `target_id`, `metadata` (JSONB), `created_at` |

### 6.2 Security

- **Row Level Security** enabled on every table.
- Viewer: read-only access.
- Authority: read + write on violations (review), cameras, scene profiles.
- Admin: full access to all tables.
- Users cannot change their own role.
- `current_role()` SQL helper function for RLS policies.
- Trigger on `auth.users` insert → creates `profiles` row with role `viewer`.

### 6.3 Storage

- Private bucket: `evidence`.
- Path convention: `evidence/violations/{violation_id}/{filename}`.
- Access via signed URLs only.
- pg_cron job + Edge Function deletes evidence older than configured retention days.
- Plate masking for viewer role (applied at query/display level).

### 6.4 Views

- Daily violation counts.
- Peak hours.
- Vehicle type distribution.
- Camera utilization.

### 6.5 RPC

- `search_violations(filters, pagination)` — server-side filtered + paginated violation search.

---

## 7. AI Pipeline

### 7.1 Frame Sampling

- Use `requestVideoFrameCallback` for frame capture.
- Always use **video time** (`mediaTime`), never wall-clock time.
- Target ~8 FPS for analysis.
- Use `createImageBitmap` and transfer to Web Worker (zero-copy).
- Backpressure: skip frames if the worker is still busy.

### 7.2 Detection (YOLO11n)

- Input: 640×640 letterboxed.
- Output: `[1, 84, 8400]` tensor → decode → class-wise NMS.
- Confidence threshold: 0.35.
- NMS IoU threshold: 0.5.
- Kept classes: person, car, motorcycle, bus, truck, traffic_light.
- "Van" is a size/aspect-ratio heuristic (COCO has no van class).
- Map boxes back to original frame coordinates after letterbox inversion.

### 7.3 Tracking (ByteTrack)

- Kalman filter for motion prediction.
- Two-stage IoU association with Hungarian matching.
- Anchor point: bottom-center of bounding box.
- Track states: tentative → confirmed → lost → removed.
- Class majority vote across track lifetime.
- History per track: `{mediaTime, box, anchor}[]`.
- Interpolate boxes between analysis frames for smooth overlay.
- Draw track IDs and short trail lines on overlay.

### 7.4 Speed Estimation

- 4-point homography (Direct Linear Transform) maps anchor pixel coordinates to real-world meters.
- Speed = distance / time over ~1 second of video time.
- Median smoothing over the speed window.
- Only computed inside the calibration area.
- Unit: km/h.

### 7.5 Violation Rules

Each vehicle triggers each violation type **at most once**.

| Rule | Condition |
|---|---|
| **Overspeed** | Speed > speed_limit + tolerance for 3 consecutive samples |
| **Red light** | Signal box reads red (HSV pixel color count, smoothed over 3 samples) AND anchor crosses stop line from approach side. 0.5 s grace period. |
| **Lane change** | Anchor crosses a solid lane line |
| **Aggressive lane change** | 2+ solid-line crossings within 5 seconds |
| **No helmet** | Custom helmet model flags no helmet in ≥60% of last 5 checks (motorcycle tracks only) |
| **Triple riding** | ≥3 person boxes overlap one motorcycle (intersection/person_area ≥ 0.5) in ≥60% of last 5 checks |

Signal detection modes:

- **Auto**: HSV color counting in the signal box region.
- **Manual timer**: user sets red/green durations.
- **Manual toggle**: user manually switches signal state.

### 7.6 Evidence Engine

- Keep the **5 best crops** per tracked vehicle, ranked by `size × confidence × sharpness`.
- On violation: capture a **snapshot JPEG** with the highlighted bounding box and violation caption.
- Upload evidence to Supabase Storage: `evidence/violations/{violation_id}/`.
- Insert `violations` row with `review_status = pending_review`.
- If the vehicle never violates, **delete** its crops from memory (never upload).

### 7.7 ANPR (Automatic Number Plate Recognition)

- Run `plate.onnx` on the violator's crop (browser-side).
- Send the best plate crop to `POST /ocr` on the stream server.
- EasyOCR returns raw text + confidence.
- Normalize to Indian plate formats:
  - Standard: `XX 00 XX 0000`
  - BH series: `00 BH 0000 XX`
  - Fix common OCR errors by character position: O↔0, I↔1, B↔8, S↔5.
- If OCR fails or confidence is below threshold, save with `ocr_status = pending_ocr`.
- UI allows manual retry of OCR.

### 7.8 Traffic Statistics

- Flush anonymous counts to `traffic_stats` every 60 seconds of video time.
- Per-minute bucket: vehicle counts by type, average speed, density, heat grid.
- Non-violating vehicle data is discarded after statistics are flushed.

---

## 8. Video Sources

| Source | Implementation |
|---|---|
| **Upload** | Local object URL (file never leaves device). Two modes: **Watch** (normal playback) and **Batch** (fast processing with progress bar, ETA, speed multiplier, pause/resume/cancel, Fast mode at 4 FPS / 480px). Process in 5-minute chunks; save `lastProcessedOffset`; resume after refresh. |
| **Webcam** | `getUserMedia` with rear camera preference on mobile. Requires HTTPS. |
| **HLS stream** | Played via hls.js. If CORS-blocked, automatically routes through `/relay`. Auto-reconnect with exponential backoff. |
| **YouTube Live** | Stream server uses yt-dlp to extract HLS manifest; proxies manifest + segments with CORS headers. No re-encoding. |
| **YouTube Video** | Stream server downloads ≤720p mp4, serves with range requests, deletes after 2 h. |
| **Fallback** | If YouTube is blocked on the cloud server, user points Stream Server URL setting at their laptop via Cloudflare Tunnel. |

### 8.1 Multi-Camera

- Grid layouts: 1, 2, or 4 tiles.
- Each tile has its own Web Worker.
- Analysis FPS auto-reduces as tiles increase.
- Status badges per tile: Live, Offline, Processing, Maintenance, Camera Unavailable.
- Live violation feed sidebar.

---

## 9. Pages

| Page | Access | Description |
|---|---|---|
| Landing | Public | Features overview, demo section |
| Login / Register / Reset | Public | Supabase Auth with zod + react-hook-form |
| Dashboard | All roles | KPI cards, charts summary, recent violations |
| Live Monitor | All roles | Multi-camera grid, live detection, violation feed |
| Analyze Video | All roles | Upload + batch/watch mode processing |
| Scene Setup | Authority, Admin | Draw calibration, stop line, signal box, lanes, zone |
| Cameras | Authority, Admin | CRUD, location, status badges, link scene profiles |
| Violations | Authority, Admin | Tabs: Today / 7 days / 30 days / Custom. Filters, table/card views, pagination |
| Violation Detail | Authority, Admin | Snapshot, crops (signed URLs), all metadata, approve/reject with note, edit plate, retry OCR, download evidence PDF |
| Analytics | All roles | Charts: vehicle count, peak hours, types, density, utilization, violations over time, heatmap. Date range + camera filter. |
| Reports | All roles | Save filter sets, generate daily/monthly reports, export CSV + PDF |
| Alerts | All roles | Inbox with unread count, toast, sound, browser Notification |
| Admin: Users | Admin | User list, role change (via Edge Function with service role key) |
| Admin: Activity Logs | Admin | Searchable log viewer |
| System Settings | Admin | Stream server URL, retention days, default thresholds, feature flags |
| Account Settings | All roles | Profile, password change |

Dark "control room" theme. Sidebar navigation. Fully responsive (desktop + mobile).

---

## 10. Stream Server Architecture

### 10.1 Endpoints

```text
POST /ocr
  - Accepts: plate crop image (max 500 KB)
  - Returns: { text, confidence }
  - Rate limited via slowapi

GET /probe?url={stream_url}
  - Returns: stream health info
  - Blocks private/internal IPs (SSRF prevention)

POST /relay/youtube
  - Input: YouTube live URL
  - Action: yt-dlp extracts HLS manifest; proxy manifest + segments with CORS headers
  - No re-encoding

POST /media/youtube
  - Input: YouTube video URL
  - Action: Download ≤720p mp4, serve with range requests
  - Auto-delete after 2 hours
```

### 10.2 Security

- Verify Supabase JWT on every request.
- CORS restricted to frontend domain.
- Rate limiting via slowapi.
- SSRF protection on `/probe`.

### 10.3 Deployment

- Docker container on Hugging Face Spaces (port 7860).
- README.md includes HF Space metadata.
- Can also run locally via Cloudflare Tunnel as fallback.
- "Waking up server" UI message for cold starts.

---

## 11. Scene Setup Requirements

### 11.1 User Workflow

1. Capture a frame from any video source.
2. Draw on canvas overlay:
   - **Calibration rectangle**: 4 points + enter real width and length in meters.
   - **Stop line**: 2 points + approach side indicator.
   - **Traffic light box**: 4 points bounding the signal.
   - **Lane lines**: polylines, each marked as solid or dashed.
   - **Detection zone**: polygon defining the active analysis area.
3. Set parameters: speed limit (km/h), tolerance (km/h), enabled rules (feature flags).
4. Edit/drag points, undo, reset.
5. Save to `scene_profiles` table (all coordinates normalized 0–1).
6. Preview with "test overlay" on live feed.
7. Link scene profiles to cameras on the Cameras page.

---

## 12. Analytics Requirements

### 12.1 Dashboard KPIs

- Total vehicles today.
- Total violations today.
- Active cameras.
- Detection accuracy (approved / total reviewed).

### 12.2 Charts (Chart.js)

- Vehicle count over time.
- Peak hours distribution.
- Vehicle type breakdown (car, motorcycle, bus, truck).
- Traffic density trends.
- Camera utilization.
- Violations by type over time.
- Heatmap from `traffic_stats.heat_grid`.

### 12.3 Filters

- Date range picker.
- Camera selector.
- Violation type.

### 12.4 Reports

- Save filter presets to `saved_reports`.
- Generate daily and monthly reports.
- Export: CSV and PDF (jsPDF).

---

## 13. Violation Review Workflow

```text
AI detects violation
        ↓
Insert into violations table (review_status = pending_review)
        ↓
Upload evidence to Supabase Storage
        ↓
Realtime alert → toast + sound + browser notification + alerts inbox
        ↓
Authority opens Violation Detail page
        ↓
Reviews: snapshot, crops (signed URLs), metadata, confidence scores
        ↓
Action: Approve / Reject (with note)
        ↓
Optional: Edit plate text, retry OCR
        ↓
Approved violations become official records
        ↓
Download evidence PDF
```

---

## 14. Storage and Privacy Policies

### 14.1 Data Retention

- Violation evidence: retained for configurable number of days (admin setting).
- pg_cron job + Edge Function runs daily to delete expired evidence from Storage and null out paths in the violations table.
- Traffic statistics: retained indefinitely (anonymous, small footprint).

### 14.2 Privacy

- Uploaded videos are processed client-side only. Files never leave the browser.
- Non-violating vehicles contribute only to anonymous aggregate counts.
- License plate images are stored only for violations.
- Viewer role sees masked plates (masking applied at display level).
- Evidence bucket is private; access requires signed URLs.

### 14.3 Security Headers

Cloudflare Pages `_headers` file:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cache-Control: public, max-age=31536000, immutable   (for /models/*.onnx)
```

SPA redirect: `/* → /index.html` (200).

---

## 15. Model Training

### 15.1 Datasets

- Helmet detection: Roboflow Universe or Kaggle dataset (YOLO format).
- License plate detection: Indian license plate dataset from Roboflow Universe or Kaggle (YOLO format).

### 15.2 Training Process (Google Colab / Kaggle)

1. Install Ultralytics.
2. Download dataset (user pastes Roboflow download code).
3. Train: `yolo detect train model=yolo11n.pt data=data.yaml imgsz=640 epochs=80 patience=20`
4. Validate and show sample predictions.
5. Export: `yolo export model=best.pt format=onnx imgsz=320 opset=12 simplify=True`
6. Download the `.onnx` file.

### 15.3 Model Registry

`apps/web/public/models/models.json`:

```json
[
  {
    "name": "yolo11n",
    "file": "yolo11n.onnx",
    "inputSize": 640,
    "classes": ["person", "bicycle", "car", "motorcycle", "bus", "truck", "traffic_light"]
  },
  {
    "name": "helmet",
    "file": "helmet.onnx",
    "inputSize": 320,
    "classes": ["helmet", "no_helmet"]
  },
  {
    "name": "plate",
    "file": "plate.onnx",
    "inputSize": 320,
    "classes": ["plate"]
  }
]
```

---

## 16. Development Environment (Surface, ARM64)

- **OS**: Windows 11 on ARM64 (Snapdragon X Elite). No NVIDIA/CUDA.
- **Node.js**: ARM64 build.
- **Git**: standard install.
- **WSL2**: Ubuntu ARM64 — Python 3.11, ffmpeg.
- **Docker Desktop**: ARM64 build (for stream-server local testing).
- **Supabase**: Use cloud project for development (no local Supabase needed).
- **WebGPU**: Verify in Edge or Chrome via `chrome://gpu`.

---

## 17. Testing Requirements

### 17.1 Unit Tests (Vitest)

Required coverage for:

- All geometry/math functions (homography, line crossing, IoU, distance).
- All violation rule engines (overspeed, red light, lane change, helmet, triple riding).
- ByteTrack tracker with synthetic moving boxes.
- NMS and detection postprocessing.
- Plate text normalization.
- Feature flag toggling (disabled module doesn't break pipeline).

### 17.2 Integration Testing

- End-to-end: upload a short clip → detection → tracking → violation → Supabase insert.
- Stream server: OCR endpoint with sample plate image.

### 17.3 Manual Testing Protocol

- Test with short clips first, then long videos.
- Test batch mode resume after page refresh.
- Test multi-camera FPS adaptation.
- Test WebGPU and WASM fallback paths.
- Test on mobile (responsive layout + rear camera).

---

## 18. Deployment Plan

### 18.1 Frontend (Cloudflare Pages)

1. Connect GitHub repo → `apps/web` build directory.
2. Build command: `npm run build`.
3. Output directory: `dist`.
4. Set environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STREAM_SERVER_URL`.
5. Add `_headers` file (COOP/COEP, model caching).
6. SPA redirect rule.
7. Configure Supabase Auth redirect URLs to Cloudflare Pages domain.

### 18.2 Backend (Supabase)

1. Run all migrations from `supabase/migrations/`.
2. Configure Auth providers.
3. Set redirect URLs.
4. Verify RLS policies.
5. Create storage bucket `evidence` (private).
6. Deploy Edge Functions.
7. Enable pg_cron for evidence cleanup.

### 18.3 Stream Server (Hugging Face Spaces)

1. Create a Docker Space.
2. Push `apps/stream-server/` with Dockerfile and README (HF metadata).
3. Set secrets: `SUPABASE_JWT_SECRET`, `ALLOWED_ORIGINS`.
4. Verify health endpoint.

### 18.4 CI/CD (GitHub Actions)

- On push/PR: lint, typecheck, Vitest tests.
- Weekly keep-alive ping workflow to prevent HF Space from sleeping.

### 18.5 Environment Variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Supabase anonymous key |
| `VITE_STREAM_SERVER_URL` | Frontend | Stream server base URL |
| `SUPABASE_JWT_SECRET` | Stream server | JWT verification |
| `ALLOWED_ORIGINS` | Stream server | CORS whitelist |

---

## 19. Development Rules for Antigravity

### 19.1 Mandatory

- Read `docs/CONTEXT.md` before every task.
- Implement directly. Finish requested features completely.
- Keep code modular — small files, typed interfaces, clear boundaries.
- Use TypeScript everywhere in frontend code.
- Write tests for all math and rule engines.
- One milestone at a time. Test it, commit, then move on.
- If something breaks, `git checkout` to the last working commit rather than piling on fixes.
- Favor working software over theoretical perfection.
- Keep `docs/CONTEXT.md` updated as decisions change.

### 19.2 Forbidden

- Architecture reports.
- Audit reports.
- Code review reports.
- Large implementation summaries.
- Unnecessary refactors.
- Rewriting working systems.
- Showing code diffs instead of implementing.
- Requesting permission before every change.
- Changing architecture decisions without explicit approval.
- Introducing additional backend services, inference servers, paid APIs, or authentication systems.

### 19.3 Output Style

```text
Plan:
1. ...
2. ...

Implementing now.
```

No essays. No summaries. No reports.

### 19.4 Debug Protocol

```text
This is broken: [what you did] → [what happened] → [what you expected].
Error/console output: [paste].
Find the root cause first and explain it, then make the smallest fix.
Don't rewrite unrelated code.
```

---

## 20. docs/CONTEXT.md Content

Save this as `docs/CONTEXT.md`. Start every AI agent session with "Read docs/CONTEXT.md first."

```text
Project: VisionGuard AI – traffic monitoring web app.

Rules you must follow:

- My machine: Windows 11 on ARM64 (Snapdragon X Elite), NO NVIDIA/CUDA.
  Python runs in WSL2 Ubuntu ARM64.
- All AI inference runs IN THE BROWSER with onnxruntime-web
  (WebGPU first, WASM fallback) inside a Web Worker.
  Never add a GPU server.
- Backend = Supabase (Postgres, Auth, Storage, Realtime, Edge Functions).
  No custom auth. No custom JWT.
- Small FastAPI "stream-server" only for /ocr, /relay, /media, /probe.
  Deploys to Hugging Face Spaces (Docker, port 7860).
- Frontend: React + Vite + TypeScript + Tailwind + shadcn/ui,
  monorepo at apps/web.
- Everything must be free to host. No paid APIs.
- Only violations are stored; non-violating vehicles only as anonymous counts.
- Every AI module must support feature flags. Disabling a module must not
  break the pipeline.
- Write typed, modular code, small files, unit tests for all math and rules.
- Before big changes, explain your plan briefly. Never delete working features.
- Complete the current milestone fully before beginning the next milestone.
  Never start the next milestone if the current one is failing.
- Do not generate audits, reports, architecture reviews, or
  implementation summaries.
```

---

## 21. Milestones

### Milestone 0 — AI Proof of Concept

**Objective:** Verify browser-side inference works before building the application.

**Deliverables:**

- Minimal HTML page with video upload.
- Load `yolo11n.onnx` in a Web Worker using onnxruntime-web.
- WebGPU execution provider; automatic WASM fallback.
- Letterbox preprocessing to 640×640.
- Decode `[1, 84, 8400]` output tensor.
- NMS and class filtering.
- Draw bounding boxes on overlay canvas.
- Display FPS and inference time.

**Success criteria:**

- Model loads successfully.
- WebGPU backend activates (or WASM fallback works).
- Bounding boxes render correctly on uploaded video.
- Stable 8–15 FPS.

**DO NOT proceed to Milestone 1 until this passes.**

---

### Milestone 1 — Scaffold

**Deliverables:**

- Monorepo: `apps/web`, `apps/stream-server` (empty FastAPI with `/health`), `supabase/migrations`, `ml/`, `docs/`.
- Frontend: React + Vite + TypeScript + Tailwind + shadcn/ui + React Router + TanStack Query + Zustand + Vitest.
- ESLint, Prettier, `.gitignore`, `.env.example`.
- Dark "control room" app layout with sidebar.
- Placeholder pages: Landing, Dashboard, Live Monitor, Analyze Video, Scene Setup, Cameras, Violations, Analytics, Reports, Alerts, Admin, Settings.
- Responsive for desktop and mobile.

---

### Milestone 2 — Authentication

**Deliverables:**

- Supabase Auth integration: register, login, logout, forgot password, reset password, session persistence.
- `RequireAuth` and `RequireRole` guard components.
- Read role from `profiles` table.
- Redirect logged-in users to `/app`.
- Forms with zod + react-hook-form, good error messages.

---

### Milestone 3 — Database

**Deliverables:**

- Supabase SQL migration for all tables (Section 6).
- Trigger: create profile on signup with role `viewer`.
- Helper function: `current_role()`.
- RLS policies: viewer read-only, authority read/write, admin all, no self-role-change.
- Private storage bucket `evidence`.
- Views: daily violation counts, peak hours, vehicle type distribution, camera utilization.
- RPC: `search_violations` with filters + pagination.

---

### Milestone 4 — Detection Engine

**Deliverables:**

- `apps/web/src/pipeline/` — Web Worker that loads YOLO11n ONNX.
- Letterbox preprocessing to 640.
- Output decoding `[1, 84, 8400]`, class-wise NMS.
- Keep: person, car, motorcycle, bus, truck, traffic_light.
- Map boxes back to frame coordinates.
- Frame sampler using `requestVideoFrameCallback` + `createImageBitmap` (transferred).
- Configurable analysis FPS with backpressure.
- Overlay canvas drawing boxes with labels.
- Metrics panel: backend type, inference ms, FPS.
- Test page: upload a video and see boxes.
- Provide exact command to export `yolo11n.onnx` in WSL.

**No tracking. No OCR. No violations.**

---

### Milestone 5 — Tracking

**Deliverables:**

- ByteTrack in TypeScript: Kalman filter, two-stage IoU association with Hungarian matching.
- Track states: tentative → confirmed → lost → removed.
- Class majority vote.
- Track history: `{mediaTime, box, anchor}[]`.
- Draw track IDs and short trail lines.
- Interpolate boxes between analysis frames for smooth display.
- Vitest tests with synthetic moving boxes.

---

### Milestone 6 — Scene Setup

**Deliverables:**

- Scene Setup page: capture frame from any source.
- Canvas drawing tools: calibration rectangle (4 points + real meters), stop line (2 points + approach side), traffic light box, lane lines (polylines, solid/dashed), detection zone polygon.
- Inputs: speed limit, tolerance, enabled rules.
- Edit/drag points, undo, reset.
- Save to `scene_profiles` (coordinates normalized 0–1).
- "Test overlay" preview.
- Cameras page: CRUD, location, status badges, link scene profiles.

---

### Milestone 7 — Speed + Overspeed + Violations Storage

**Deliverables:**

- `lib/geometry/homography.ts` — DLT from 4 points, with Vitest tests.
- Speed computation per track from anchor world positions using video `mediaTime`, ~1 s window, median smoothing, only inside calibration area.
- `rules/overspeed.ts` — violation rule per Section 7.5.
- Evidence buffer: 5 best crops per track (size × confidence × sharpness).
- On violation: snapshot JPEG with highlighted box + caption, upload to Supabase Storage, insert `violations` row with `pending_review`.
- Create `analysis_runs` rows; flush `traffic_stats` every 60 s of video time.
- Discard data of non-violating tracks.

---

### Milestone 8 — Analyze Video (Long Videos)

**Deliverables:**

- Analyze Video page: drag-and-drop upload.
- Watch mode: normal playback with live detection.
- Batch mode: process as fast as possible.
  - Progress bar, ETA, speed (× real-time).
  - Pause / resume / cancel.
  - Fast mode toggle (4 FPS, 480px).
  - Process in 5-minute chunks.
  - Save `lastProcessedOffset`; allow resume after refresh.
  - Release memory properly (close ImageBitmaps).
  - Warn if tab is hidden (background throttling).
- Results summary at the end.

---

### Milestone 9 — Live Monitor + Multi-Camera

**Deliverables:**

- Live Monitor page with tiles grid (1 / 2 / 4).
- Each tile: source selector (webcam device picker with rear camera on mobile, HLS URL via hls.js, YouTube URL — placeholder until Milestone 13).
- Each tile: assign a scene profile.
- Each tile: own Web Worker; auto-reduce analysis FPS as tiles increase.
- Status badges: Live, Offline, Processing, Maintenance, Camera Unavailable.
- Auto-reconnect with exponential backoff.
- Live violation feed sidebar.

---

### Milestone 10 — Red Light + Lane Rules

**Deliverables:**

- `signal.ts`: classify traffic light box with HSV pixel counts (red / yellow / green / unknown), smoothed over 3 samples. Manual timer mode. Manual toggle mode.
- `rules/redLight.ts`: anchor crosses stop line from approach side while red, 0.5 s grace. Unit tests.
- `rules/laneChange.ts`: crossing solid line = violation; 2+ crossings in 5 s = aggressive. Unit tests.

---

### Milestone 11 — Model Training (Colab)

**Deliverables:**

- `ml/notebooks/train_helmet.ipynb`: install Ultralytics, download dataset, train YOLO11n (imgsz 640, epochs 80, patience 20), validate, show sample predictions, export ONNX (imgsz 320, opset 12, simplify), download file.
- `ml/notebooks/train_plate.ipynb`: same structure for plate detection.
- `apps/web/public/models/models.json` describing each model's classes and input size.

**Do not start until the detection pipeline (Milestones 4–5) is stable.**

---

### Milestone 12 — Helmet + Triple Riding

**Deliverables:**

- Load `helmet.onnx` in the Web Worker.
- For motorcycle tracks: every ~1 s, crop the motorcycle + riders area, run helmet model, store results. No helmet in ≥60% of last 5 checks → violation.
- Triple riding: count person boxes overlapping each motorcycle (intersection/person_area ≥ 0.5). ≥3 in ≥60% of last 5 checks → violation.
- Both rules respect their feature flags.
- Unit tests.

---

### Milestone 13 — Stream Server + ANPR

**Deliverables:**

- `apps/stream-server`: FastAPI with Supabase JWT verification, CORS, slowapi rate limits.
- Endpoints: `/ocr`, `/probe`, `/relay/youtube`, `/media/youtube` (per Section 10).
- Dockerfile for HF Spaces (port 7860). README with HF Space metadata.
- Frontend integration:
  - Run `plate.onnx` on violator crops.
  - Send best plate crop to `/ocr`.
  - Normalize Indian plates (including BH series, fix O/0 I/1 B/8 S/5 by position).
  - Retry OCR button.
  - "Waking up server" message on cold start.
  - Connect YouTube option in Analyze Video and Live Monitor.

---

### Milestone 14 — Violations + Review + Alerts

**Deliverables:**

- Violations page: tabs Today / Last 7 days / Last 30 days / Custom. Filters: plate, dates, type, location, status. Table and card views. Pagination via `search_violations` RPC.
- Violation Detail page: snapshot, crops (signed URLs), all data + confidences, approve/reject with note, edit plate, retry OCR, download evidence PDF.
- Real-time alerts: Supabase Realtime on `violations` insert → toast, sound, browser Notification, alerts inbox with unread count.

---

### Milestone 15 — Analytics + Reports

**Deliverables:**

- Analytics page with Chart.js: total vehicles, peak hours, vehicle type distribution, density trends, camera utilization, violations by type over time, heatmap from `traffic_stats.heat_grid`.
- Date range picker and camera filter.
- Dashboard KPI cards.
- Reports page: save filter sets, generate daily/monthly reports, export CSV and PDF (jsPDF).

---

### Milestone 16 — Admin + Security

**Deliverables:**

- Admin: Users page with role change (via Supabase Edge Function using service role key).
- Admin: Activity logs viewer.
- System Settings: stream server URL, retention days, default thresholds, feature flags.
- Log key actions to `activity_logs`.
- pg_cron job + Edge Function to delete expired evidence.
- Plate masking for viewer role.
- Review all RLS policies and fix any gaps.

---

### Milestone 17 — Deployment

**Deliverables:**

- Cloudflare Pages: build settings, `_headers` (COOP/COEP, model caching), SPA redirects.
- Environment variables configured.
- Supabase Auth redirect URLs.
- Hugging Face Space deployed for stream-server.
- GitHub Actions: lint, typecheck, tests on push/PR.
- Weekly keep-alive ping workflow for HF Space.
- Step-by-step deployment checklist.

---

### Milestone 18 — Polish + Documentation

**Deliverables:**

- Landing page with features overview and demo section.
- Loading, empty, and error states on all pages.
- Keyboard navigation and mobile usability checks.
- README.md: architecture, screenshots placeholders, setup instructions, deployment guide, limitations, evaluation results template (`docs/evaluation.md`).

---

## 22. Timeline

| Week | Milestones | Focus |
|---|---|---|
| 1 | 0–3 | AI proof of concept, scaffold, auth, database |
| 2 | 4–5 | Detection engine, tracking |
| 3 | 6–7 | Scene setup, speed + overspeed + evidence |
| 4 | 8–9 | Analyze video (long videos), live monitor |
| 5 | 10–11 | Red light + lane rules, model training |
| 6 | 12–13 | Helmet + triple riding, stream server + ANPR |
| 7 | 14–15 | Violations review + alerts, analytics + reports |
| 8 | 16–17 | Admin + security, deployment |
| 9 | 18 | Polish + documentation |

---

## 23. Golden Rule

```text
Build → Test → Commit → Next Milestone
```

Never proceed to the next milestone until the current milestone is:

1. Built
2. Tested
3. Working
4. Committed

Never stack multiple broken milestones together.

---

## 24. Honest Limitations

- Accuracy for night footage, blurry plates, and helmets will be imperfect — this is why human review exists.
- YouTube relay can get blocked by Google. Laptop mode (Cloudflare Tunnel) is the fallback.
- Free-tier servers sleep. First OCR or YouTube request after a cold start will be slow.
- WebGPU availability varies by browser and GPU driver. WASM fallback ensures the app always works, but slower.
- Speed estimation accuracy depends entirely on the quality of the 4-point calibration.
- Use stock or your own footage for development and demos. Real enforcement requires official authorization.
