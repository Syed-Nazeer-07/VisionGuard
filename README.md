# VisionGuard

### AI Traffic Intelligence & Video Analytics Platform

VisionGuard is a web application for analysing roadway videos, detecting and tracking road users, and organising the resulting information into review, incident, analytics, and reporting workflows.

The project combines a React-based interface, browser-side computer vision, an optional local Python analysis service, Supabase for authentication and structured data, and Backblaze B2 for video-object storage.

> **Project status:** VisionGuard is under active development. Detection quality, object tracking, fullscreen playback, and real-world speed estimation depend on the model, video conditions, calibration, and the current implementation. A successful build or unit test run does not by itself verify accuracy on real traffic footage.

<p align="center">
  <a href="https://github.com/Syed-Nazeer-07/VisionGuard">
    <img src="https://img.shields.io/badge/GitHub-VisionGuard-181717?style=for-the-badge&logo=github" alt="GitHub repository">
  </a>
  <img src="https://img.shields.io/badge/React-18+-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-7+-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Supabase-Postgres%20%7C%20Auth-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase">
  <img src="https://img.shields.io/badge/Backblaze-B2-EF3B2D?style=for-the-badge" alt="Backblaze B2">
  <img src="https://img.shields.io/badge/ONNX%20Runtime-Web-5B5BD6?style=for-the-badge" alt="ONNX Runtime">
</p>

---

## Contents

- [Overview](#overview)
- [Key capabilities](#key-capabilities)
- [Application navigation](#application-navigation)
- [Architecture](#architecture)
- [Video-analysis pipeline](#video-analysis-pipeline)
- [Detection and tracking contract](#detection-and-tracking-contract)
- [Speed estimation](#speed-estimation)
- [Backend processing](#backend-processing)
- [Data storage](#data-storage)
- [Security](#security)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Environment configuration](#environment-configuration)
- [Database and Edge Functions](#database-and-edge-functions)
- [Run the local analysis backend](#run-the-local-analysis-backend)
- [Development and testing](#development-and-testing)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Overview

VisionGuard is designed to help users turn traffic footage into structured information that can be reviewed later.

At a high level, the system follows this workflow:

```text
Traffic video or configured camera
              |
              v
       Video/frame handling
              |
              v
        Object detection
              |
              v
       Vehicle/object tracking
              |
              v
  Movement and rule evaluation
              |
      +-------+-------+
      |               |
      v               v
 Incidents         Evidence
      |               |
      +-------+-------+
              |
              v
     Persistent records
              |
              v
 History / Cases / Analytics / Reports
```

The application separates the user interface, AI processing, structured database records, and large video files. This makes it possible to change parts of the analysis infrastructure without replacing the entire website.

## Key capabilities

### Video management

- Select and preview traffic video in the web application.
- Upload video files and store them through the configured storage workflow.
- Track video metadata using persistent database records.
- Revisit available video assets through History and supported review actions.
- Maintain source identity while analysis is active in the single-page application.

### Traffic analysis

- YOLO-based object detection using a compatible model.
- Browser inference through ONNX Runtime Web.
- WebGPU acceleration when supported by the browser, device, and model.
- WebAssembly execution fallback when configured and supported.
- Web Worker execution to move selected inference work off the main UI thread.
- Multi-object tracking using ByteTrack-style association and Kalman-based motion estimation.
- Vehicle classes including cars, trucks, buses, bicycles, and motorcycles when supported by the configured model.
- Detection overlays and tracked-object labels.
- Traffic-rule evaluation, incident workflows, and evidence handling where configured.

### Hybrid execution

VisionGuard supports two analysis paths:

- **Browser WebGPU:** runs compatible inference in the browser when the required model and runtime are available.
- **Local Backend:** sends processing work to a locally running Python service.

The two paths should produce compatible result records for the UI. They do not guarantee identical inference speed or identical predictions on all hardware.

### Review and reporting

- Dashboard for an operational overview.
- History for available video records and review actions.
- Cases for investigation and incident-related workflows.
- Analytics for summaries and trends from available persisted data.
- Reports for supported reporting and export workflows.

### Data persistence

The application can persist structured records for users, cameras, video assets, analysis runs, tracked objects, incidents, evidence references, and reporting workflows, depending on the enabled feature and schema.

---

## Application navigation

The primary user workflow is organised around the following pages:

| Page | Purpose |
|---|---|
| **Dashboard** | High-level overview of available application and analysis information. |
| **Live Analysis** | Select a video or configured source and view analysis overlays. |
| **History** | Browse available video records and access supported playback/review actions. |
| **Cases** | Manage investigations and related incident/review workflows available to the user's role. |
| **Analytics** | Explore summaries and trends derived from available stored data. |
| **Reports** | Access supported reporting and export features. |

Some installations may also expose camera management, user administration, audit, or configuration routes according to their permissions and setup.

---

## Architecture

### High-level architecture

```text
                     VisionGuard web UI
                 React + TypeScript + Vite
                            |
              +-------------+-------------+
              |                           |
              v                           v
     Browser analysis path       Supabase services
              |                   Auth / PostgreSQL
              v                           |
       ONNX Runtime Web                   |
       WebGPU / WASM                      |
              |                           |
              v                           |
       Shared result contract <-----------+
              ^
              |
       Python local backend
        FastAPI + ONNX Runtime
              |
              v
       Timestamped job artifact

Video objects: Backblaze B2
```

### Main responsibilities

- **Frontend:** page navigation, video selection and playback, overlays, progress indicators, and access to saved information.
- **Browser analysis:** runs compatible object-detection inference inside the browser.
- **Python backend:** provides an alternative local processing path for jobs that should run outside the browser.
- **Supabase:** handles authentication and structured application data.
- **Backblaze B2:** stores large uploaded video objects.
- **Shared rendering:** displays detections and tracks using a consistent source-coordinate and timestamp contract.

---

## Video-analysis pipeline

The intended processing flow is:

1. **Select a source.** The user selects an uploaded video or a configured camera source.
2. **Read frames.** The application obtains video frames and associates them with media timestamps and source dimensions.
3. **Preprocess.** The frame is resized and padded to match the loaded model's input requirements.
4. **Run inference.** The selected engine runs the compatible YOLO model.
5. **Decode detections.** Model output is decoded into class IDs, confidence values, and bounding boxes.
6. **Restore coordinates.** Boxes are converted to the original source-video coordinate system.
7. **Track objects.** Detections are associated across frames to maintain track IDs.
8. **Estimate movement.** Speed is calculated only when the required measurements and calibration are valid.
9. **Render results.** The overlay draws valid, time-aligned tracks over the video.
10. **Persist relevant records.** The application saves supported analysis, incident, and evidence records through its existing data services.

### Playback and rendering principles

- Video playback should remain independent of inference scheduling.
- Each result should retain a source identifier, frame identifier, timestamp, and source dimensions.
- Detection boxes should use source-video pixel coordinates as the shared contract.
- The conversion from source coordinates to displayed canvas coordinates should be applied exactly once.
- Results from older sources or inappropriate timestamps must not overwrite the current source state.
- Tracks should survive brief inference gaps only within a bounded validity window; expired tracks should not remain frozen over empty road.

These principles describe the intended contract. Real-video validation is still required to establish accuracy and smoothness for a particular model, clip, browser, and device.

---

## Detection and tracking contract

### Detection record

A normalized detection should contain the following information:

| Field | Meaning |
|---|---|
| `cx`, `cy` | Bounding-box centre in source-video pixels. |
| `w`, `h` | Bounding-box width and height in source-video pixels. |
| `prob` | Model confidence, represented between `0` and `1`. |
| `classId` | Class identifier from the configured model. |
| `className` | Canonical class name associated with that identifier. |

The actual model's class list must be checked. For the standard COCO class mapping, relevant IDs are:

| Class | COCO ID |
|---|---:|
| Person | 0 |
| Bicycle | 1 |
| Car | 2 |
| Motorcycle | 3 |
| Bus | 5 |
| Truck | 7 |

Do not assume these IDs are valid for a custom or differently exported model without checking its metadata and output decoder.

### Track record

A tracked-object record should preserve at least:

- Stable track ID while the object is continuously trackable.
- Canonical class and class identifier.
- Bounding box in source-video coordinates.
- Detection confidence when available.
- Track state and age since the last true observation.
- Media timestamp and source-generation identity.
- Optional speed only when valid.

### Detection is not tracking

**Detection** predicts objects in an individual frame. **Tracking** associates detections across multiple frames. A tracker cannot reliably follow a vehicle when its input detections are consistently incorrect, and rendering adjustments cannot repair a false model prediction by themselves.

---

## Speed estimation

VisionGuard includes speed-estimation logic, but reliable real-world speed requires valid calibration and reliable tracked positions.

The physical relationship is:

```text
speed = distance travelled / elapsed time
```

To display speed in kilometres per hour, image positions must be mapped to real-world distance. Depending on the camera, this may require a ground-plane homography based on known road geometry or another valid calibration method.

The implementation should:

- Use actual media timestamps rather than assume every processed frame has the same interval.
- Use a suitable road-contact point, commonly the bottom-centre of a vehicle box.
- Ignore invalid coordinates, non-finite values, and discontinuous track histories.
- Handle seeking and source changes without creating artificial speed spikes.
- Reduce small motion estimates caused by bounding-box jitter.
- Never replace unavailable measurements with random, simulated, or fabricated speeds.
- Omit numeric speed when valid calibration or sufficient measurements are unavailable.
- Avoid saving fabricated values into incident records, analytics, or reports.

**A speed value should not be treated as a verified real-world measurement merely because it is displayed in km/h.** Accuracy needs to be validated against a calibrated scene and known motion.

---

## Backend processing

The local Python backend provides an alternative to browser-side analysis. It is intended for controlled video jobs and can use ONNX Runtime with the available execution provider, such as DirectML or CPU, when configured.

A typical backend job is expected to:

1. Accept a processing request for a supported video source.
2. Validate the request and initialise/reuse the model session.
3. Decode frames incrementally rather than loading the entire video into memory.
4. Run inference and tracking while preserving actual media timestamps.
5. Report job state and meaningful progress.
6. Write a complete result artifact.
7. Return the artifact for frontend review and/or persistence.

### Backend reliability requirements

- Reuse model sessions where supported instead of reloading the model for every frame.
- Keep frame queues and memory consumption bounded.
- Release video and inference resources after completion or failure.
- Provide explicit completed, failed, and cancelled states where supported.
- Ensure a job is not reported as completed before its artifact is written and validated.
- Avoid downloading or serializing the same artifact unnecessarily.
- Report failures honestly rather than substituting empty successful results.

The local backend is not automatically a public cloud service. Other users cannot access a service running on a developer's `localhost` unless it is separately and securely deployed or exposed through appropriate infrastructure.

---

## Data storage

VisionGuard separates structured application data from large video files.

### Supabase

Supabase is used for authentication and PostgreSQL-backed application data. Depending on the configured schema and enabled workflows, records can include:

- User profiles and roles.
- Camera metadata and source configuration.
- Video asset metadata and storage references.
- Analysis runs and job information.
- Tracked-object records and trajectories.
- Incident and case records.
- Evidence metadata and references.
- Audit, reporting, or scheduled-report records.

Actual table names and feature availability are defined by the migrations and application code in the repository.

### Backblaze B2

Backblaze B2 stores the actual uploaded video objects. Supabase generally stores metadata and references rather than the entire video binary.

The storage flow is designed around a server-side Edge Function:

```text
Browser
   |
   v
VisionGuard upload service
   |
   v
Supabase Edge Function
   |
   v
Backblaze B2
   |
   v
Video object + database metadata/reference
```

Large uploads may use multipart/resumable transfer according to the implemented upload workflow. Exact limits depend on the configured storage service and application settings.

### Suggested object layout

```text
videos/
└── <video_id>/
    └── original.mp4
```

The actual key format is determined by the storage service implementation and should not be changed independently of its metadata references.

---

## Security

VisionGuard uses Supabase Auth and database access policies to protect user data.

Security principles include:

- Authenticate users through the configured authentication provider.
- Apply role-based access checks in the application and enforce database permissions through Row Level Security where configured.
- Keep Backblaze B2 application credentials on the server side.
- Do not expose storage secrets through client-side `VITE_*` environment variables.
- Use protected server-side functions for privileged storage operations.
- Keep sensitive configuration out of source control.
- Apply database schema changes through versioned migrations.

Never commit `.env` files, service-role keys, B2 application keys, access tokens, or other credentials.

---

## Technology stack

### Frontend

- React
- TypeScript
- Vite
- React Router
- Tailwind CSS
- HTML5 Video APIs
- Canvas-based overlay rendering

### Browser AI and tracking

- YOLO-based object-detection model compatible with the configured export
- ONNX Runtime Web
- WebGPU when available
- WebAssembly where configured and supported
- Web Workers
- ByteTrack-style multi-object association
- Kalman-filter-based motion estimation

### Local backend

- Python
- FastAPI
- ONNX Runtime
- OpenCV or the configured video-decoding implementation
- DirectML or CPU execution when supported by the environment

### Backend services and storage

- Supabase Auth
- PostgreSQL
- Supabase Edge Functions
- PostgreSQL Row Level Security
- Backblaze B2 object storage

### Development tools

- Git and GitHub
- npm workspaces
- Vitest for frontend tests
- pytest for backend tests

The effective model, Python execution provider, dependency versions, and available test commands are determined by the checked-out repository and environment.

---

## Repository structure

The project is organised as a web workspace with Supabase resources and local backend processing components. The following is a representative structure; use the files present in your checkout as the source of truth.

```text
VisionGuard/
├── apps/
│   └── web/
│       ├── src/
│       │   ├── components/
│       │   ├── context/
│       │   ├── lib/
│       │   ├── pages/
│       │   ├── pipeline/
│       │   ├── services/
│       │   ├── store/
│       │   └── types/
│       ├── public/
│       └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── pipeline/
│   │   └── storage/
│   └── tests/
├── scripts/
│   ├── Start-VisionGuard.ps1
│   └── Stop-VisionGuard.ps1
├── supabase/
│   ├── functions/
│   │   └── video-storage/
│   └── migrations/
├── assets/                  # Local assets; do not commit private videos
├── package.json
└── README.md
```

Some directories or script names may vary between revisions. Do not create empty directories simply to match this diagram.

---

## Getting started

### Prerequisites

Install the tools needed for the parts you intend to run:

- Git
- Node.js and npm (use the version supported by the repository's package configuration; Node.js 20+ is a reasonable baseline if no stricter version is specified)
- Python for the local backend
- Supabase project credentials for database/auth-backed functionality
- Supabase CLI for applying migrations or managing Edge Functions
- A compatible browser for browser-based inference

Browser WebGPU support depends on the operating system, GPU, browser version, and model/runtime combination. The WASM path may be used when configured and supported.

### Clone the repository

```bash
git clone https://github.com/Syed-Nazeer-07/VisionGuard.git
cd VisionGuard
```

### Install frontend dependencies

From the repository root:

```bash
npm install
```

### Configure environment variables

Review the example environment files in the repository. Create the appropriate local environment files and fill in the credentials for your own Supabase project and other enabled services.

Do not commit secrets. Do not copy production credentials into a public repository.

### Start the frontend

From the repository root, use the configured development command:

```bash
npm run dev
```

The Vite development server may print its actual local URL in the terminal. Open that URL in your browser; do not assume the port if Vite reports a different one.

### Start the Python backend

The local backend is a separate service. Use the repository's startup script if it is present and configured for your environment:

```powershell
.\scripts\Start-VisionGuard.ps1
```

If you prefer to start services separately, inspect the backend README, dependency file, and FastAPI entry point in your checkout for the authoritative commands. The backend has previously been configured to listen locally on port `8000`, but its host and port must match the frontend's backend URL configuration.

If the frontend reports that it cannot connect to `localhost` or `127.0.0.1`, ensure the backend is running, the configured URL uses the correct host and port, and CORS allows the frontend's development origin.

---

## Environment configuration

### Frontend

Use the variable names documented in the repository's frontend environment example. Supabase-based frontends commonly use values such as:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-public-anon-key>
```

Confirm the actual variable names in the checked-out source before configuring them. Only values intended for browser use should use the `VITE_` prefix.

### Backblaze B2 Edge Function

The storage integration may use server-side values similar to:

```env
B2_ENDPOINT=https://s3.<region>.backblazeb2.com
B2_REGION=<region>
B2_BUCKET=<private-bucket-name>
B2_KEY_ID=<application-key-id>
B2_APPLICATION_KEY=<application-key>
```

Set secrets using the Edge Function's documented deployment process. These values must not be bundled into the frontend.

### Backend URL

Configure the frontend with the URL expected by the current backend client. For local development, this may be a loopback address such as `http://127.0.0.1:8000`, but the actual variable name and path must match the current source.

**Important:** A public website cannot use the developer's `127.0.0.1` address as its shared processing backend. Each visitor's loopback address points to their own device. Public backend processing requires a reachable deployed service with appropriate access controls, CORS, and resource limits.

---

## Database and Edge Functions

VisionGuard uses Supabase migrations to manage database schema changes.

Before applying migrations:

1. Review the migration files and understand the changes.
2. Confirm the Supabase project is the intended development or production project.
3. Back up important data before applying risky schema changes.
4. Do not delete migration history or edit previously applied migrations casually.

Where the Supabase CLI is configured and linked to the correct project, the repository may use:

```bash
npx supabase db push
```

Deploy or configure Edge Functions using the instructions and scripts present in the repository. Configure the required secrets on the server side.

Do not run database changes against production without reviewing the migration and confirming the target project.

---

## Run the local analysis backend

The Python service provides local video-processing capability. Its exact install and start commands depend on the backend dependency file and FastAPI entry point in the checked-out revision.

A typical local setup is:

1. Install the Python version required by the backend.
2. Create and activate a virtual environment.
3. Install packages from the backend's checked-in requirements or project configuration.
4. Configure model paths, execution provider, backend URL, and other required environment variables.
5. Start the service using the project's startup script or documented FastAPI command.
6. Confirm the health endpoint, if configured, reports that the service is ready.
7. Select **Local Backend** in VisionGuard and process a short sample video before trying longer footage.

On Windows, DirectML may be available depending on hardware and installed dependencies. CPU execution may be slower. The application should report unavailable providers honestly rather than claiming GPU acceleration when it is not active.

The local service must remain running while it is processing. Local processing is suitable for development and testing, but it is not a substitute for a deployed, always-available cloud service.

---

## Development and testing

### Build the frontend

From the repository root:

```bash
npm run build
```

If working specifically in the web workspace, use the scripts defined by that workspace's `package.json`. A common command for this repository is:

```bash
npm run build -w web
```

### Run frontend tests

```bash
npm exec -w web -- vitest run
```

### Run backend tests

From the backend directory, if pytest and the backend test suite are configured there:

```bash
python -m pytest
```

Use the commands documented in the current package configuration if they differ. Test counts change as the project evolves; consult the actual output rather than relying on historical numbers in this README.

### Test video analysis with real footage

Unit tests are necessary but do not prove detection quality on real videos. Before considering a change to detection, tracking, rendering, or speed complete, check a short real traffic clip for:

- Boxes aligned to the corresponding vehicles.
- No boxes stuck over empty road after the object has left.
- Stable IDs while an object remains trackable.
- No multi-second overlay disappearance during continuous playback.
- Correct alignment after pause, seek, fullscreen, resize, and source changes.
- No fabricated speed values.
- No numeric speed without valid calibration and measurements.
- No unverified detections presented as confirmed traffic incidents.

Record which checks were actually executed and which remain unverified.

---

## Known limitations

- **Detection quality:** model predictions can produce false positives or miss distant, partially occluded, or small vehicles. Model configuration and real-video evaluation matter.
- **Tracking quality:** IDs may fragment during occlusion or poor detections. A tracker cannot fully correct an incorrect detector output.
- **Speed estimation:** physically meaningful km/h requires valid camera/road calibration and reliable timestamps and tracking. Speed should be omitted when these requirements are not satisfied.
- **Browser performance:** inference speed depends on device capability, browser support, model size, and execution provider.
- **Local backend availability:** the Python service must be running and reachable. A localhost service is not publicly available by default.
- **External camera feeds:** some stream types may require additional ingestion, proxy, or gateway infrastructure.
- **Production scaling:** large numbers of concurrent long-running jobs may require a deployed worker service, queueing, monitoring, and additional compute resources.

These limitations should be re-evaluated as the implementation changes. Do not describe a feature as production-ready solely because its page or API exists.

---

## Design principles

### Truthful results

Only real detector outputs and valid derived measurements should enter the analysis workflow. Missing or invalid data must not be replaced with fabricated results.

### One source of truth

Video identity, source generation, frame timestamps, coordinate conventions, and analysis-job states must be explicit and consistent.

### Separate playback from inference

The video player should remain responsive even when inference is slower than playback. Rendering must use valid timestamp-aligned results rather than blocking the video on every inference request.

### Persistent by design

Save important records through the existing application services so users can revisit them after navigation or a page refresh where persistence is supported.

### Secure by default

Keep service secrets server-side, use database access controls, and avoid destructive changes to stored user data.

### Modular storage

Keep large video-object storage separate from structured database records and avoid coupling application pages directly to provider-specific credentials.

---

## Roadmap

Potential future improvements include:

### AI and tracking

- Improve real-video detection precision and recall.
- Improve stable multi-object tracking under occlusion.
- Validate bicycle and motorcycle detection against representative clips.
- Reduce false positives on road markings and roadside infrastructure.
- Add repeatable model evaluation against annotated frames.

### Video playback

- Improve stable overlays during continuous playback.
- Keep playback controls available in fullscreen.
- Improve source switching and seeking behaviour.
- Ensure both processing engines use the same detection/track schema.

### Speed and traffic analysis

- Validate calibration workflows and calibrated speed against measured road distances.
- Improve stationary-vehicle handling and timestamp discontinuity detection.
- Distinguish measured values from unavailable values throughout persistence and reporting.
- Improve incident validation and evidence review.

### Infrastructure

- Improve local backend throughput and job cancellation.
- Add scalable background workers for larger deployments.
- Improve monitoring and error reporting for long-running jobs.
- Add robust streaming gateways for additional camera protocols where needed.

---

## Contributing

Contributions should preserve existing application behaviour and the security model.

Before submitting changes:

1. Keep TypeScript and Python code consistent with repository conventions.
2. Preserve Supabase Row Level Security and authentication safeguards.
3. Never expose storage credentials in browser code.
4. Keep fabricated data out of production analysis paths.
5. Preserve the shared source-coordinate and timestamp contract.
6. Test changes affecting video, tracking, and persistence against real footage when possible.
7. Avoid destructive cleanup of user assets, database migrations, and untracked work.
8. Report what was actually changed and verified.

---

## Repository

GitHub: <https://github.com/Syed-Nazeer-07/VisionGuard>

---

<p align="center">
  <strong>VisionGuard</strong><br>
  Turn traffic video into operational intelligence.
</p>
