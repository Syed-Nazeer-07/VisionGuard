# VisionGuard

### AI Traffic Intelligence & Video Analytics Platform

VisionGuard is an AI-powered traffic intelligence platform designed to transform roadway video into actionable operational data.

It combines browser-based computer vision, vehicle tracking, traffic-rule detection, persistent analysis, evidence management, analytics, and large-scale video storage into a unified traffic operations platform.

<p align="center">
  <a href="https://github.com/Syed-Nazeer-07/VisionGuard">
    <img src="https://img.shields.io/badge/GitHub-VisionGuard-181717?style=for-the-badge&logo=github" alt="GitHub">
  </a>
  <img src="https://img.shields.io/badge/React-18+-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-7+-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/Supabase-Backend-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase">
  <img src="https://img.shields.io/badge/Backblaze%20B2-Large%20Video%20Storage-EF3B2D?style=for-the-badge" alt="Backblaze B2">
  <img src="https://img.shields.io/badge/ONNX%20Runtime-Web-5B5BD6?style=for-the-badge" alt="ONNX Runtime Web">
</p>

---

## Overview

VisionGuard provides a unified environment for analyzing traffic footage from uploaded videos and live camera sources.

The platform is built around a persistent intelligence pipeline:

```text
Video / Camera Source
        │
        ▼
   AI Inference
        │
        ▼
 Object Detection
        │
        ▼
 Vehicle Tracking
        │
        ▼
 Rule Evaluation
        │
        ├───────────────┐
        ▼               ▼
   Incidents        Evidence
        │               │
        └───────┬───────┘
                ▼
        Persistent Analysis
                │
        ┌───────┼────────┐
        ▼       ▼        ▼
     Review  Analytics  Reports
```

VisionGuard is designed so that analysis results are not trapped inside a browser session.

Videos, analysis runs, tracked objects, incidents, evidence, and logs are persisted so they can be revisited later.

---

## Key Capabilities

### 🎥 Video Intelligence

- Upload traffic videos directly from the application
- Large-file video ingestion through Backblaze B2
- Resumable multipart uploads
- Real upload progress, transfer speed, and ETA
- Persistent `video_assets` records
- Persistent video playback
- Historical video analysis and review
- Large-video support for traffic footage

### 🚦 Traffic AI

- YOLO-based vehicle detection
- ONNX Runtime Web inference
- WebGPU acceleration when available
- WASM fallback
- Web Worker inference architecture
- ByteTrack multi-object tracking
- Kalman-based tracking state
- Vehicle track IDs
- Persistent trajectories
- Speed estimation
- Traffic rule evaluation
- Incident generation
- Evidence capture

### 📡 Live Camera Analysis

- Live camera source management
- Camera analysis sessions
- Persistent `analysis_runs`
- Camera-specific tracking
- Persistent incidents and evidence
- Camera/source switching
- Uploaded-video and live-camera analysis modes
- Persistent analysis logs

### 🧠 Persistent Intelligence

VisionGuard persists:

- Analysis runs
- Tracked objects
- Trajectories
- Incidents
- Evidence
- Analysis logs
- Camera metadata
- Video metadata

This enables historical analysis and operational intelligence beyond a single browser session.

### 📊 Analytics & Reporting

- Incident analytics
- Severity breakdowns
- Traffic analysis
- Historical trends
- Operational reports
- Executive intelligence
- CSV/export workflows

### 🔐 Security

- Supabase Authentication
- Role-based authorization
- PostgreSQL Row Level Security
- Viewer / Operator / Supervisor / Admin roles
- Protected routes
- Server-side B2 credentials
- Signed B2 playback URLs
- Controlled storage operations through backend functions

---

# Architecture

## High-Level Architecture

```text
┌──────────────────────────────────────────────┐
│                VisionGuard UI                │
│                                              │
│ Dashboard │ Cameras │ Analyze │ Review       │
│ Analytics │ Reports │ Cases │ Settings       │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│           React / Vite Application            │
│                                              │
│ AuthProvider                                 │
│ Routing / AppLayout                          │
│ Upload Manager                               │
│ Live Analysis Session                        │
│ Analysis Logger                              │
└──────────────────────┬───────────────────────┘
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
      Browser AI Pipeline    Supabase Backend
             │                   │
      ┌──────┼──────┐      ┌─────┼─────────┐
      ▼      ▼      ▼      ▼     ▼         ▼
    ONNX  ByteTrack Rules  Auth  DB        RLS
      │      │      │
      └──────┴──────┘
             │
             ▼
       Persistent Results
```

---

# Video Storage Architecture

VisionGuard separates application data from large binary video storage.

### Supabase

Supabase is responsible for:

- Authentication
- PostgreSQL
- User profiles
- Cameras
- Video metadata
- Analysis runs
- Tracked objects
- Incidents
- Evidence metadata
- Logs
- Analytics
- Reports
- Security policies

### Backblaze B2

Backblaze B2 stores the actual large video objects.

```text
Browser
   │
   ▼
VisionGuard Upload Manager
   │
   ▼
Supabase Edge Function
   │
   ▼
Backblaze B2
   │
   ▼
videos/<video_id>/original.mp4
```

Large files are uploaded using multipart/resumable transfer so the browser does not need to send multi-gigabyte files as one request.

---

# AI Pipeline

VisionGuard performs computer vision inference through ONNX Runtime Web.

```text
Video Frame
    │
    ▼
Preprocessing
    │
    ▼
YOLO Inference
    │
    ▼
Coordinate Restoration
    │
    ▼
Detection Objects
    │
    ▼
ByteTrack
    │
    ▼
Tracked Vehicles
    │
    ├──────────────┐
    ▼              ▼
Speed Estimation  RuleEngine
    │              │
    │              ▼
    │          Incidents
    │              │
    └──────┬───────┘
           ▼
        Evidence
           │
           ▼
      Persistence
```

Inference runs through a Web Worker to keep the main UI responsive.

---

# Application Modules

| Module | Purpose |
|---|---|
| Dashboard | Operational overview and high-level metrics |
| Camera Assets | Manage registered camera sources |
| Live Monitoring | Monitor live camera feeds |
| Live Analysis | Analyze uploaded videos and live cameras |
| Video Library | Manage persistent uploaded video assets |
| Video Review | Replay historical analysis |
| Incidents | Review detected traffic incidents |
| Cases | Manage operational cases |
| Review Queue | Review AI-generated events |
| Analytics | Analyze traffic and incident trends |
| Reports | Generate operational reports |
| Executive Intelligence | High-level organizational insights |
| Users | User and role administration |
| Config | System configuration |
| Audit Logs | Security and operational auditing |
| Settings | User/application preferences |

---

# Live Analysis

Live Analysis supports two source modes:

### Uploaded Video

```text
Upload MP4
   ↓
Create video asset
   ↓
Backblaze B2 multipart upload
   ↓
Persistent video
   ↓
Start inference
```

### Live Camera

```text
Select Camera
   ↓
Camera Source
   ↓
Start Analysis
   ↓
Persistent Analysis Run
```

The active Live Analysis source is intentionally maintained in application memory while navigating through the SPA.

A browser refresh clears the temporary active Live Analysis source, while the underlying video asset remains persisted.

---

# Persistent Analysis Model

VisionGuard persists the relationship between source, analysis session, detections, incidents, evidence, and logs.

```text
video_assets / cameras
          │
          ▼
     analysis_runs
          │
          ▼
    tracked_objects
          │
          ├──────────────┐
          ▼              ▼
       incidents      trajectories
          │
          ▼
       evidence
          │
          ▼
    analysis_logs
```

This allows historical analysis to be reconstructed without unnecessarily rerunning inference.

---

# Video Workflow

A typical uploaded-video workflow looks like:

```text
1. Select MP4
        ↓
2. Create video_assets record
        ↓
3. Generate video_id
        ↓
4. Navigate to /app/analyze?video=<id>
        ↓
5. Start B2 multipart upload
        ↓
6. Save persistent storage_path
        ↓
7. Start AI inference
        ↓
8. Detect vehicles
        ↓
9. Track vehicles
        ↓
10. Evaluate traffic rules
        ↓
11. Persist incidents
        ↓
12. Capture evidence
        ↓
13. Persist logs and metrics
        ↓
14. Review historical results
```

---

# Security Model

VisionGuard uses Supabase Auth and PostgreSQL Row Level Security.

### Roles

- **Viewer**
- **Operator**
- **Supervisor**
- **Admin**

Authorization is enforced through application-level guards and database security policies.

B2 credentials are never exposed to the browser.

The Backblaze integration uses server-side Supabase Edge Functions to:

- manage multipart uploads
- create signed upload URLs
- resolve signed playback URLs
- perform protected storage operations

---

# Tech Stack

## Frontend

- React
- TypeScript
- Vite
- React Router
- Tailwind CSS
- HTML5 Video APIs

## Backend & Database

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Edge Functions
- PostgreSQL Row Level Security

## AI & Computer Vision

- ONNX Runtime Web
- YOLO
- Web Workers
- WebGPU
- WebAssembly
- ByteTrack
- Kalman tracking
- Traffic RuleEngine

## Storage

- Backblaze B2
- Supabase Storage for legacy/smaller assets

---

# Project Structure

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
│
├── supabase/
│   ├── functions/
│   │   └── video-storage/
│   └── migrations/
│
├── assets/
├── package.json
└── README.md
```

---

# Getting Started

## Prerequisites

Install:

- Node.js 20+
- npm
- Git
- Supabase CLI

Clone the repository:

```bash
git clone https://github.com/Syed-Nazeer-07/VisionGuard.git
cd VisionGuard
```

Install dependencies:

```bash
npm install
```

Start the development environment:

```bash
npm run dev
```

The web application normally runs at:

```text
http://localhost:3000
```

---

# Environment Configuration

Configure the required Supabase variables in the appropriate environment file.

For the B2 storage Edge Function:

```env
B2_ENDPOINT=https://s3.<region>.backblazeb2.com
B2_REGION=<region>
B2_BUCKET=visionguard-videos
B2_KEY_ID=<application-key-id>
B2_APPLICATION_KEY=<application-key>
```

### Security

Never expose:

```text
B2_KEY_ID
B2_APPLICATION_KEY
```

through client-side `VITE_*` variables.

These secrets must remain server-side.

---

# Backblaze B2 Setup

Create a private B2 bucket such as:

```text
visionguard-videos
```

Recommended object structure:

```text
videos/
└── <video_id>/
    └── original.mp4
```

For local development, configure bucket CORS for:

```text
http://localhost:3000
```

Production domains should be added separately.

---

# Database Setup

VisionGuard uses Supabase migrations for schema management.

Apply migrations:

```bash
npx supabase db push
```

Configure Edge Function secrets:

```bash
npx supabase secrets set --env-file supabase/functions/.env
```

---

# Development

Start the application:

```bash
npm run dev
```

Build and type-check:

```bash
npm run build
```

Strict TypeScript validation is intentionally retained.

---

# Testing

Run the repository's configured test suite.

Tests cover areas such as:

- Live Analysis source state
- storage behavior
- analysis services
- application logic

Before committing substantial changes:

```bash
npm run build
```

and run the project's configured tests.

---

# Design Principles

### Persistent by Default

Important analysis data should not disappear when a React page unmounts.

### Source-of-Truth Driven

Every video and camera has a canonical identity.

### Real Events Only

Logs and analytics should represent actual system events.

### Secure by Design

Secrets remain server-side and database access is governed by RLS.

### Browser-Native AI

Where practical, inference runs close to the user through WebGPU/WASM.

### Modular Storage

Large-video storage is abstracted from the rest of the application so the storage provider can evolve independently.

---

# Roadmap

## AI & Vision

- Improved multi-object tracking
- Advanced traffic violation models
- License plate recognition workflows
- Improved speed estimation
- Scene-specific detection profiles
- Model management

## Video Intelligence

- Multi-camera correlation
- Long-duration video ingestion
- Automated video summarization
- Event-based video clipping
- Advanced historical video search

## Operations

- Alert escalation
- Case automation
- Multi-site deployments
- Advanced audit workflows
- Scheduled intelligence reports

## Infrastructure

- Distributed video processing
- Background processing workers
- Scalable inference infrastructure
- Advanced streaming integrations
- Camera gateway services

---

# Current Scope

VisionGuard currently focuses on:

- Traffic video intelligence
- Uploaded video analysis
- Live camera analysis
- Vehicle detection
- Vehicle tracking
- Speed estimation
- Traffic incident detection
- Evidence management
- Persistent analysis
- Operational analytics
- Historical review workflows

Additional infrastructure may be required for certain external camera sources such as RTSP or YouTube Live proxying.

---

# Contributing

Contributions should preserve the existing architecture and security model.

Before submitting changes:

1. Keep TypeScript strict.
2. Preserve Supabase RLS.
3. Do not expose storage credentials.
4. Avoid mock persistence in production workflows.
5. Keep storage-provider logic isolated.
6. Preserve analysis lifecycle integrity.
7. Test changes affecting video, tracking, and persistence carefully.

---

# Repository

GitHub:

https://github.com/Syed-Nazeer-07/VisionGuard

---

## VisionGuard

**Turn traffic video into operational intelligence.**

Built for modern traffic monitoring, AI-assisted analysis, incident response, and data-driven transportation operations.
