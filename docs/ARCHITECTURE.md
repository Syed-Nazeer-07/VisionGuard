# VisionGuard architecture

VisionGuard is a **browser-first vehicle-analysis application**. It has one
active inference engine, running in a dedicated web worker. A continuously
running Python/FastAPI server is not part of the application or deployment.

## Repository ownership

| Directory | Responsibility |
| --- | --- |
| `apps/web/src/pages/` | App screens and authentication flows |
| `apps/web/src/components/` | Reusable presentation, layouts and permissions |
| `apps/web/src/pipeline/` | ONNX inference, tracking, frame synchronization, rendering and evidence evaluation |
| `apps/web/src/workers/` | Browser workers for local analysis |
| `apps/web/src/services/` | Persistence, video upload/recovery, session and artifact adapters |
| `apps/web/src/store/` | Account/session UI state |
| `apps/web/public/` | Static branding, sample media and optional local model assets |
| `supabase/migrations/` | Schema changes and database access controls |
| `supabase/functions/` | Authenticated edge functions for protected storage operations |
| `worker/` | Cloudflare Workers routing, model proxy and static assets |
| `scripts/` | Build/verification, evaluation and optional model export tooling |
| `docs/` | Architecture, setup, deployment, verification and release guidance |

The root `package.json` is a small npm workspace. The web app lives under
`apps/web/`. Runtime credentials **never** belong in tracked source files.

## Active video-analysis path

1. A signed-in user selects an authorized video, camera or browser-tab source.
2. `RealtimeAnalyze.tsx` manages playback, media-frame timing and the UI.
3. The browser worker loads a compatible YOLO11s ONNX model through ONNX
   Runtime Web (WebGPU when available, WASM fallback when supported).
4. The browser tracking pipeline associates detections, computes **uncalibrated
   visual motion estimates**, and paints overlays aligned to source frames.
5. Local, account-scoped activity records supply the app's overview, history,
   analytics, incident review and reports.
6. Explicit user choice controls retaining the original on the device and
   uploading originals to Backblaze B2.

The app does not automatically submit local footage to a remote model.
Cross-origin model serving needs an explicitly configured public model URL.
Speed proxies are not law-enforcement-grade measurements.

## Serverless boundaries

- **Cloudflare Worker:** serves the web app and permitted model proxy routes.
- **Supabase Auth:** signs in users, issues credentials and supports account
  recovery; PostgreSQL holds account-scoped synced metadata under RLS.
- **Supabase Edge Functions:** authorize and sign access to protected Backblaze
  B2 objects. Backblaze application keys stay server-side.
- **Backblaze B2:** optional original-video storage; the cloud copy is not
  created unless upload is explicitly requested and succeeds.

These services are not the discarded Python inference backend. Do not expose
B2 secrets or Supabase service-role keys through `VITE_*` variables.

## Archived-data compatibility

`/app/archive-videos` and its embedded review component can still inspect
**historical** frame artifacts saved by older releases. The read-only
`services/legacyAnalysisArtifacts.ts` adapter understands the original JSON
frame schema and compressed objects from the historical Supabase Storage
bucket. It neither creates Python jobs nor calls `localhost:8000`.

This compatibility code is intentionally separate from current analysis.
Historical metadata cannot reconstruct missing footage; a valid original is
required for playback and reanalysis.

The former `backend/` processing service, unused Python-only evaluation
harness, previous `Analyze.tsx`/local analysis screens and obsolete stream
relay were removed after the active route graph was audited. Their last source
remains recoverable from Git history and
`backup/pre-browser-only-architecture-2026-11-12`.

## Build and quality gates

```bash
npm ci
npm run lint
npm run build
npm run test -w web
npm run test:architecture
npm run test:deploy
npm run test:tracking-eval
```

GitHub CI also executes browser-level navigation smoke tests in Chrome.
The architecture test disallows reintroducing the retired local Python API.

**Green CI does not prove real-world detection accuracy, cloud storage
availability, successful OAuth configuration, or frame-level performance.**
Run the [release checklist](RELEASE_CHECKLIST.md) on deployed HTTPS and real
representative footage before presenting any such claim as verified.
