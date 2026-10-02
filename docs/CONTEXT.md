# Project Identity

VisionGuard AI — browser-based traffic monitoring and violation detection platform.

# Architecture Constraints

- All AI inference runs in-browser using ONNX Runtime Web inside a Web Worker.
- Prefer WebGPU. Fall back to WASM automatically.
- Never introduce a GPU inference server.
- Supabase is the sole backend (Auth, Postgres, Storage, Realtime, Edge Functions, pg_cron).
- Every video source becomes a `<video>` element processed by one shared TypeScript pipeline.

# Backend Rules

Allowed: Supabase Auth, Postgres, Storage, Realtime, Edge Functions, pg_cron.
Forbidden: Custom auth, custom JWT, user management APIs, AI inference APIs, paid services.

# Stream Server Rules

FastAPI server (Python 3.11, Docker, port 7860) exists only for:
- `POST /ocr` — EasyOCR on plate crop.
- `GET /probe` — stream health check.
- `POST /relay/youtube` — proxy YouTube Live HLS manifest.
- `POST /media/youtube` — download ≤720p mp4, serve, auto-delete after 2h.

No other endpoints. No auth logic. No AI inference. No data storage.

# Storage Policy

Store: violations, evidence (snapshots + crops), anonymous traffic statistics.
Never store: non-violating vehicle data, raw footage, uploaded videos.
Evidence retention is time-limited (admin-configurable). pg_cron cleans expired data.

# Security Rules

- RLS enabled on every table. Viewer: read-only. Authority: read/write. Admin: all.
- Users cannot change their own role.
- Evidence bucket is private. Access via signed URLs only.
- `/probe` blocks private/internal IPs (SSRF prevention).
- Supabase JWT verified on every stream-server request.
- CORS restricted to frontend domain.
- Secrets via environment variables only. Never commit secrets.

# Feature Flags

All required flags — disabling any must never break the pipeline:
- `speed_detection`
- `plate_detection`
- `helmet_detection`
- `triple_riding_detection`
- `red_light_detection`
- `lane_detection`
- `alerts`

# Development Standards

- TypeScript everywhere in frontend code.
- Tests required for all math, geometry, and rule engine functions.
- Small files, typed interfaces, clear module boundaries.
- Every violation starts as `pending_review`. Human review required before approval.
- Video time (`mediaTime`) only. Never wall-clock time for analysis.
- Release resources (ImageBitmaps, workers) when done.

# Antigravity Operating Rules

- Read this file before every task.
- Implement directly. Complete requested features fully.
- No architecture reports, audit reports, code review reports, or implementation summaries.
- No unnecessary refactors. No rewriting working systems.
- No code diffs as output. No permission requests before every change.
- Do not change architecture decisions without explicit approval.
- Complete current milestone before starting the next.
- If something breaks, revert to last working commit.
- Keep responses concise: plan briefly, then implement.

# Deployment Constraints

- Frontend: Cloudflare Pages (static site, `_headers` with COOP/COEP).
- Backend: Supabase free tier.
- Stream server: Hugging Face Spaces (Docker).
- CI/CD: GitHub Actions (lint, typecheck, tests).
- All hosting must remain free. No paid APIs.

# Golden Rules

1. AI runs in the browser. No exceptions.
2. Only violations are stored. Everything else is anonymous or discarded.
3. Human review before any violation becomes official.
4. Every AI module behind a feature flag.
5. Build → Test → Commit → Next.
6. Machine: Windows 11 ARM64 (Snapdragon X Elite). No NVIDIA/CUDA.

# Performance Rules

- Detection, tracking, and rule evaluation must run inside Web Workers.
- Main UI thread must remain responsive.
- Process video using adaptive frame sampling when performance drops.

# Data Rules

- Scene setup coordinates must be stored normalized (0–1), never pixel values.
- Analytics tables must contain aggregated data only.

# Dependency Rules

- Prefer stable, actively maintained libraries.
- Do not introduce new infrastructure services without explicit approval.
- Minimize external dependencies when native browser APIs are sufficient.