# VisionGuard — Local AI Backend (FastAPI + ONNX Runtime)

A lightweight local computer-vision service for VisionGuard that performs offline, frame-accurate traffic analysis on uploaded videos. It decodes frames sequentially using OpenCV, executes YOLO11n object detection via ONNX Runtime, performs ByteTrack vehicle association with 1D Kalman filtering, and produces compressed timestamped analysis artifacts.

---

## 1. Architecture & Design Principles

- **Framework**: FastAPI with asynchronous request handling.
- **Model Inference**: ONNX Runtime (CPU execution provider with DirectML support). Reuses the application's existing `apps/web/public/models/yolo11n.onnx` model (`[1, 3, 640, 640]` RGB tensor input, `[1, 84, 8400]` predictions).
- **Video Decoding**: OpenCV (`cv2.VideoCapture`) with accurate presentation timestamp tracking.
- **Tracking**: Python implementation of ByteTrack with 1D Kalman filtering matching the frontend tracking contract. Directly preserves detected bounding boxes on fresh detections to eliminate Kalman drift.
- **Speed Estimation**: Strictly uncalibrated by default (`speed: None`). Requires a calibrated ground-plane homography matrix ($3 \times 3$) to compute non-negative physical velocity in km/h. Never invents realistic-looking guesses from raw pixel displacement.
- **Persistence & Artifacts**: Writes versioned, gzip-compressed JSON artifacts (`results.json.gz`) to `backend/artifacts/{job_id}/` for chunked retrieval and playback synchronization. When "Save video to History" is disabled, local temporary videos are cleaned up immediately following analysis.

---

## 2. Prerequisites & Windows Setup

### Prerequisites
- Python 3.11 (64-bit recommended) or Astral `uv`.
- Windows 10/11 (x86_64 or ARM64 via Windows on ARM emulation).

### Step-by-Step Installation (PowerShell)

**Terminal 1 — Local Backend:**
```powershell
# 1. Navigate to the backend directory
cd backend

# 2. Create the virtual environment
python -m venv .venv

# Note: On Windows on ARM machines, use uv or 64-bit Python to ensure precompiled OpenCV wheels:
# uv venv .venv --python 3.11

# 3. Activate the virtual environment
.\.venv\Scripts\Activate.ps1

# 4. Install pinned dependencies
pip install -r requirements.txt
# (or: uv pip install -r requirements.txt)

# 5. Start the backend service
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Terminal 2 — Frontend Application:**
```powershell
npm run dev -w web
```

---

## 3. Configuration & Environment Variables

Copy `.env.example` to `.env` in the `backend/` directory to customize defaults:

| Variable | Default | Description |
|---|---|---|
| `VISIONGUARD_HOST` | `127.0.0.1` | Host to bind HTTP API (strictly localhost) |
| `VISIONGUARD_PORT` | `8000` | Port for the backend service |
| `VISIONGUARD_MODEL_PATH` | `../apps/web/public/models/yolo11n.onnx` | Path to YOLO11n ONNX model |
| `VISIONGUARD_EXECUTION_PROVIDER` | `None` | Preferred execution provider (e.g. `DmlExecutionProvider`, `CPUExecutionProvider`) |
| `VISIONGUARD_MAX_UPLOAD_BYTES` | `1073741824` | Maximum upload size (1 GB) |
| `VISIONGUARD_MAX_CONCURRENT_JOBS` | `1` | Max concurrent worker jobs (1 avoids overloading PC) |
| `VISIONGUARD_CONF_THRESHOLD` | `0.20` | Detection confidence cutoff |
| `VISIONGUARD_IOU_THRESHOLD` | `0.45` | NMS IoU threshold |
| `VISIONGUARD_RETENTION_HOURS` | `24` | Local temporary artifact retention |

---

## 4. API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Health check, service status, ONNX model readiness, and active execution provider |
| `POST` | `/api/v1/analysis/jobs` | Upload video (`multipart/form-data`) and enqueue asynchronous analysis job |
| `GET` | `/api/v1/analysis/jobs/{job_id}` | Real-time job status, progress percentage, frame count, processing FPS, and summary |
| `GET` | `/api/v1/analysis/jobs/{job_id}/results` | Paginated and timestamp-bounded frame results (`limit`, `offset`, `start_time`, `end_time`) |
| `DELETE` | `/api/v1/analysis/jobs/{job_id}` | Request graceful job cancellation and cleanup temporary files |
| `GET` | `/api/v1/analysis/jobs/{job_id}/artifact` | Download raw compressed result artifact (`.json.gz`) |

---

## 5. Local Data Directories

- `backend/uploads/`: Temporary directory for uploaded video files during analysis. Cleaned up automatically when local-only mode is used.
- `backend/artifacts/`: Stores gzip-compressed analysis results (`{job_id}/results.json.gz`).
Both directories are ignored in `.gitignore`.

---

## 6. Running Tests

To run the full backend test suite:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
pytest -v
```

The test suite covers:
- Service health and model readiness reporting (`test_health.py`).
- Input validation (unsupported formats, corrupted videos) (`test_jobs.py`).
- End-to-end asynchronous job creation, progress tracking, summary generation, and pagination (`test_jobs.py`).
- Safe job cancellation and temporary file cleanup (`test_jobs.py`).
- Tracker stability, IoU greedy matching, and 1D Kalman dimensions velocity (`test_tracker.py`).
- Physical speed estimation, non-negative velocities, discontinuity handling, and uncalibrated `None` safety (`test_speed.py`).

---

## 7. Known Limitations & Considerations

1. **CPU Inference Speed**: When running on CPU without hardware acceleration, YOLO11n inference typically operates between 10–25 FPS depending on resolution and system load. This is why offline analysis queues the video first rather than dropping frames in real time.
2. **Physical Speed Calibration**: Physical speed in km/h is reported **only** when a valid homography matrix ($3 \times 3$) is configured for the camera view. Without calibration, vehicle speeds are explicitly returned as `null` to avoid displaying invented numbers.
3. **Model License**: YOLO11 is provided under the AGPL-3.0 license. Reusing the local pre-exported ONNX model weights avoids vendor runtime lock-in.
