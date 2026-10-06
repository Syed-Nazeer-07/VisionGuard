import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Upload, Cpu, CheckCircle2, Loader2, Activity, ShieldAlert,
  AlertTriangle, Film, Play, Camera as CameraIcon, Radio, Pause, Square, RotateCcw, X
} from 'lucide-react';
import Hls from 'hls.js';
import { drawBoundingBoxes } from '../pipeline/rendering/overlay';
import type { ResultMessage, WorkerOutputMessage } from '../pipeline/types';
import type { ViolationCandidate, ViolationMetadata } from '../pipeline/violations/types';
import { db, type VideoAsset } from '../services/db';
import { requestOcr } from '../pipeline/plate/service';
import { evidenceQueue } from '../pipeline/evidence/queue';
import { supabase } from '../lib/supabase';
import { uploadManager, type ActiveUpload } from '../services/uploadManager';
import { liveAnalysisSession, sourceKeyOf } from '../services/liveAnalysisSession';
import { analysisLogger } from '../services/analysisLogger';
import { AnalysisLogPanel } from '../components/analysis/AnalysisLogPanel';
import { availabilityMessage, fetchStorageInfo, getAssetAvailability, resolveVideoUrl, storageProviderLabel, videoDisplayName } from '../lib/videoAssets';
import type { Json } from '../types/supabase';

// ---------------------------------------------------------------------------------------------
// State model
//   Source:  IDLE → SOURCE_LOADING → SOURCE_READY | SOURCE_ERROR
//   Run:     NONE → STARTING → ANALYZING ⇄ PAUSED → STOPPED | COMPLETED
// The displayed state is the source state until the source is ready, then the run state.
// One analysis_runs row per Start Inference click; pause/resume continue the same run.
// ---------------------------------------------------------------------------------------------
type SourceState = 'IDLE' | 'SOURCE_LOADING' | 'SOURCE_READY' | 'SOURCE_ERROR';
type RunState = 'NONE' | 'STARTING' | 'ANALYZING' | 'PAUSED' | 'STOPPED' | 'COMPLETED';
type ModelStatus = 'loading' | 'ready' | 'error';
type TerminalStatus = 'completed' | 'stopped' | 'failed';

interface SourceContext {
  kind: 'video' | 'camera';
  id: string;
  name: string;
  location: string | null;
}

interface CameraRow {
  id: string;
  name: string;
  location: string | null;
  stream_url: string | null;
  source_url?: string | null;
  source_type?: string | null;
}

interface TrajectoryPoint {
  time: number;
  bbox: [number, number, number, number]; // top-left x, y, width, height in source pixels
  speed?: number;
}

interface TrackedRecord {
  track_id: number; // persisted id (worker id + session offset)
  object_type: string;
  confidence: number;
  first_seen_timestamp: number;
  last_seen_timestamp: number;
  frame_count: number;
  trajectory: TrajectoryPoint[];
}

interface IncidentRow {
  incident_type: string;
  violation_type: string;
  severity: string;
  status: string;
  confidence: number;
  track_id: number | null;
  camera_id: string | null;
  video_id: string | null;
  analysis_run_id: string;
  location: string;
  description: string;
  created_at: string;
  metadata: Record<string, Json | undefined>;
}

interface QueuedIncident {
  row: IncidentRow;
  evidence: Array<{ type: 'snapshot' | 'plate_crop'; base64: string }>;
}

interface SessionMetrics {
  framesProcessed: number;
  detectionsGenerated: number;
  incidentsCreated: number;
  incidentsSuppressed: number;
  incidentsSaved: number;
  fps: number;
  latency: number;
}

interface AnalysisSession {
  source: SourceContext;
  runId: string;
  trackIdOffset: number;
  tracked: Map<number, TrackedRecord>; // keyed by worker track id
  incidentQueue: QueuedIncident[];
  dedupe: Map<string, number>;
  metrics: SessionMetrics;
  fpsWindowStart: number;
  fpsWindowFrames: number;
  lastMetricsPersist: number;
  lastTrackFlush: number;
  metricsErrorLogged: boolean;
  closed: boolean;
}

interface LiveMetrics {
  fps: number;
  latency: number;
  frames: number;
  detections: number;
  created: number;
  suppressed: number;
  saved: number;
  tracked: number;
  queue: number;
}

interface SavedSummary {
  incidents: number;
  tracks: number;
  runs: number;
}

const EMPTY_METRICS: LiveMetrics = { fps: 0, latency: 0, frames: 0, detections: 0, created: 0, suppressed: 0, saved: 0, tracked: 0, queue: 0 };
const MODEL_PATH = '/models/yolo11n.onnx';
const MODEL_NAME = 'YOLO11n';

function describeError(e: unknown): string {
  if (e && typeof e === 'object') {
    const err = e as { message?: unknown; code?: unknown; details?: unknown };
    const parts = [typeof err.message === 'string' ? err.message : String(e)];
    if (typeof err.code === 'string') parts.push(`[${err.code}]`);
    if (typeof err.details === 'string' && err.details) parts.push(`— ${err.details}`);
    return parts.join(' ');
  }
  return String(e);
}

function mediaErrorText(err: MediaError | null): string {
  switch (err?.code) {
    case 1: return 'Playback aborted';
    case 2: return 'Network error while loading the media';
    case 3: return 'The media could not be decoded';
    case 4: return 'Media format or source URL is not supported / not reachable';
    default: return err?.message || 'Unknown media error';
  }
}

function resolveCameraPlayback(cam: CameraRow): { url: string; hls: boolean } | { error: string } {
  const url = cam.stream_url || cam.source_url;
  if (!url) return { error: `Camera "${cam.name}" has no stream URL configured.` };
  if (/^rtsps?:\/\//i.test(url)) {
    return { error: `Camera "${cam.name}" is an RTSP source. Browsers cannot play RTSP directly — configure an HLS stream_url through the stream proxy.` };
  }
  if (/(youtube\.com|youtu\.be)\//i.test(url)) {
    return { error: `Camera "${cam.name}" is a YouTube source. It must be relayed to HLS by the stream proxy before it can be analyzed.` };
  }
  return { url, hls: cam.source_type === 'hls' || /\.m3u8(\?|$)/i.test(url) };
}

export default function Analyze() {
  const [searchParams, setSearchParams] = useSearchParams();
  const videoParam = searchParams.get('video');
  const cameraParam = searchParams.get('camera');
  // The active source lives in the in-memory Live Analysis session: it survives SPA navigation and is
  // reset by a browser refresh. ?video= / ?camera= are explicit entry points (e.g. Video Library →
  // Analyze): they take precedence, are copied into the session and then removed from the URL.
  const session = useSyncExternalStore(liveAnalysisSession.subscribe, liveAnalysisSession.get);
  const selectionKey = videoParam ? `video:${videoParam}` : cameraParam ? `camera:${cameraParam}` : sourceKeyOf(session);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [modelError, setModelError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>('');
  const [sourceState, setSourceStateValue] = useState<SourceState>('IDLE');
  const [runState, setRunStateValue] = useState<RunState>('NONE');
  const [sourceInfo, setSourceInfo] = useState<SourceContext | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveMetrics>(EMPTY_METRICS);
  const [saved, setSaved] = useState<SavedSummary | null>(null);
  // File chosen but its video_assets row not created yet (shown immediately on selection)
  const [pendingFile, setPendingFile] = useState<{ name: string; size: number; error: string | null } | null>(null);
  // Upload state of the currently selected video, if this tab is/was uploading it
  const [currentUpload, setCurrentUpload] = useState<ActiveUpload | null>(null);
  const [contentNote, setContentNote] = useState<string | null>(null);

  // Refs read by worker/frame callbacks (never stale)
  const sourceStateRef = useRef<SourceState>('IDLE');
  const runStateRef = useRef<RunState>('NONE');
  const activeSourceRef = useRef<SourceContext | null>(null);
  const sessionRef = useRef<AnalysisSession | null>(null);
  const inflightSessionRef = useRef<AnalysisSession | null>(null);
  const loadSeqRef = useRef(0);
  const startingRef = useRef(false);
  const loopActiveRef = useRef(false);
  const modelReadyRef = useRef(false);
  const providerRef = useRef<{ provider: string; fallbackReason: string | null }>({ provider: '', fallbackReason: null });
  const isWorkerBusyRef = useRef(false);
  const busySinceRef = useRef(0);
  const settingsRef = useRef<Record<string, unknown>>({});
  const uploadUnsubRef = useRef<(() => void) | null>(null);

  const setSourceState = (s: SourceState, err: string | null = null) => {
    sourceStateRef.current = s;
    setSourceStateValue(s);
    setSourceError(err);
  };
  const setRunState = (s: RunState) => {
    runStateRef.current = s;
    setRunStateValue(s);
  };
  const isCurrent = (session: AnalysisSession) => activeSourceRef.current === session.source;
  const logFor = (session: AnalysisSession) => ({
    video_id: session.source.kind === 'video' ? session.source.id : null,
    camera_id: session.source.kind === 'camera' ? session.source.id : null,
    analysis_run_id: session.runId
  });
  const logForSource = (source: SourceContext) => ({
    video_id: source.kind === 'video' ? source.id : null,
    camera_id: source.kind === 'camera' ? source.id : null
  });

  // -------------------------------------------------------------------------------------------
  // Persistence (every function takes the session explicitly so stale work never leaks into a
  // newly selected source)
  // -------------------------------------------------------------------------------------------
  const persistRunMetrics = async (session: AnalysisSession, patch: { status?: string; ended_at?: string } = {}) => {
    const m = session.metrics;
    await db.analysisRuns.update(session.runId, {
      fps: m.fps,
      latency: Math.round(m.latency),
      queue_depth: session.incidentQueue.length,
      frames_processed: m.framesProcessed,
      detections_generated: m.detectionsGenerated,
      incidents_created: m.incidentsCreated,
      incidents_suppressed: m.incidentsSuppressed,
      metrics: { incidents_saved: m.incidentsSaved, tracked_objects: session.tracked.size },
      ...patch
    });
  };

  const flushIncidents = async (session: AnalysisSession) => {
    if (session.incidentQueue.length === 0) return;
    const batch = session.incidentQueue.splice(0);
    const { data, error: insErr } = await supabase.from('incidents').insert(batch.map(b => b.row)).select();
    if (insErr) {
      const msg = describeError(insErr);
      console.error('Incident insert failed:', insErr);
      if (isCurrent(session)) setSaveError(`Incidents not saved: ${msg}`);
      analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `Incident persistence failed (${batch.length} incident(s)): ${msg}` });
      return;
    }
    if (isCurrent(session)) setSaveError(null);
    const created = (data || []) as Array<{ id: string }>;
    session.metrics.incidentsSaved += created.length;
    analysisLogger.log({ ...logFor(session), category: 'PERSISTENCE', message: `Persisted ${created.length} incident record(s)` });

    created.forEach((inc, index) => {
      const src = batch[index];
      if (!src) return;
      for (const ev of src.evidence) {
        evidenceQueue.add({
          incident_id: inc.id,
          camera_id: src.row.camera_id,
          video_id: src.row.video_id,
          analysis_run_id: session.runId,
          base64Data: ev.base64,
          type: ev.type,
          capture_timestamp: src.row.created_at
        });
        analysisLogger.log({ ...logFor(session), category: 'EVIDENCE', message: `Evidence queued for incident #${inc.id.slice(0, 8)} (${ev.type})` });
      }
      // Legacy violations table still feeds the Review Queue.
      supabase.from('violations').insert({
        camera_id: src.row.camera_id,
        video_id: src.row.video_id,
        analysis_run_id: session.runId,
        type: src.row.violation_type,
        severity: src.row.severity,
        status: 'pending_review',
        timestamp: src.row.created_at,
        metadata: { ...src.row.metadata, track_id: src.row.track_id, confidence: src.row.confidence, incident_id: inc.id }
      }).then(({ error: vErr }: { error: unknown }) => {
        if (vErr) console.warn('Violation (review queue) insert failed:', vErr);
      });
    });
  };

  const flushTracks = async (session: AnalysisSession, final: boolean) => {
    if (session.tracked.size === 0) return;
    const isVideo = session.source.kind === 'video';
    const rows = Array.from(session.tracked.values()).map(r => ({
      video_id: isVideo ? session.source.id : null,
      camera_id: isVideo ? null : session.source.id,
      analysis_run_id: session.runId,
      track_id: r.track_id,
      object_type: r.object_type,
      confidence: r.confidence,
      first_seen_timestamp: r.first_seen_timestamp,
      last_seen_timestamp: r.last_seen_timestamp,
      frame_count: r.frame_count,
      metadata: { trajectory: r.trajectory }
    }));
    const { error: upsertErr } = await supabase
      .from('tracked_objects')
      .upsert(rows, { onConflict: isVideo ? 'video_id,track_id' : 'camera_id,track_id' });
    if (upsertErr) {
      console.error('Tracked objects upsert failed:', upsertErr);
      analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `Tracking persistence failed: ${describeError(upsertErr)}` });
    } else if (final) {
      analysisLogger.log({ ...logFor(session), category: 'PERSISTENCE', message: `Tracking persisted (${rows.length} tracks with trajectories)` });
    }
  };

  const closeSession = async (session: AnalysisSession, status: TerminalStatus, reason?: string) => {
    if (session.closed) return;
    session.closed = true;
    if (sessionRef.current === session) {
      sessionRef.current = null;
      loopActiveRef.current = false;
    }
    if (isCurrent(session)) setActiveRunId(null);

    await flushIncidents(session);
    await flushTracks(session, true);
    try {
      await persistRunMetrics(session, { status, ended_at: new Date().toISOString() });
    } catch (e) {
      analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `Could not finalize analysis run: ${describeError(e)}` });
    }

    if (session.source.kind === 'video') {
      const processing_status = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'paused';
      const patch: { processing_status: string; duration?: number } = { processing_status };
      const video = videoRef.current;
      if (status === 'completed' && video && isCurrent(session) && Number.isFinite(video.duration)) patch.duration = video.duration;
      const { error: vaErr } = await supabase.from('video_assets').update(patch).eq('id', session.source.id);
      if (vaErr) analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `video_assets status update failed: ${describeError(vaErr)}` });
    }

    const m = session.metrics;
    analysisLogger.log({
      ...logFor(session),
      category: status === 'failed' ? 'ERROR' : 'PROCESSING',
      message: `Analysis ${status}${reason ? ` (${reason})` : ''}: ${m.framesProcessed} frames, ${m.detectionsGenerated} detections, ${m.incidentsCreated} incidents (${m.incidentsSaved} saved), ${session.tracked.size} tracks`
    });
  };

  const pauseSession = async (session: AnalysisSession) => {
    setRunState('PAUSED');
    analysisLogger.log({ ...logFor(session), category: 'PROCESSING', message: `Analysis paused at ${videoRef.current?.currentTime.toFixed(1) ?? '?'}s` });
    await flushIncidents(session);
    await flushTracks(session, true);
    try {
      await persistRunMetrics(session, { status: 'paused' });
    } catch (e) {
      analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `Could not update run status: ${describeError(e)}` });
    }
  };

  const resumeSession = (session: AnalysisSession) => {
    setRunState('ANALYZING');
    analysisLogger.log({ ...logFor(session), category: 'PROCESSING', message: `Analysis resumed at ${videoRef.current?.currentTime.toFixed(1) ?? '?'}s` });
    persistRunMetrics(session, { status: 'running' }).catch(e => {
      analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `Could not update run status: ${describeError(e)}` });
    });
    startLoop();
  };

  // -------------------------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------------------------
  const scheduleNext = (video: HTMLVideoElement) => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => processFrame());
    } else {
      requestAnimationFrame(() => processFrame());
    }
  };

  const processFrame = () => {
    const video = videoRef.current;
    const session = sessionRef.current;
    if (!video || !session || session.closed || runStateRef.current !== 'ANALYZING' || video.paused || video.ended) {
      loopActiveRef.current = false;
      return;
    }

    if (isWorkerBusyRef.current && performance.now() - busySinceRef.current > 5000) {
      isWorkerBusyRef.current = false; // watchdog: a lost frame must not stall the loop
    }

    const worker = workerRef.current;
    if (worker && !isWorkerBusyRef.current && modelReadyRef.current && video.readyState >= 2) {
      isWorkerBusyRef.current = true;
      busySinceRef.current = performance.now();
      const mediaTime = video.currentTime;
      createImageBitmap(video).then(bitmap => {
        if (session.closed || sessionRef.current !== session) {
          bitmap.close();
          isWorkerBusyRef.current = false;
          return;
        }
        inflightSessionRef.current = session;
        const s = settingsRef.current;
        worker.postMessage({
          type: 'inference',
          bitmap,
          mediaTime,
          calibration: {
            referenceWidth: 2,
            referenceHeight: 2,
            speedLimit: s.speed_limit_default ? Number(s.speed_limit_default) : 60,
            tolerance: s.speed_tolerance_default ? Number(s.speed_tolerance_default) : 10,
            calibrationArea: [
              { x: 0.3, y: 0.5 },
              { x: 0.7, y: 0.5 },
              { x: 0.9, y: 0.9 },
              { x: 0.1, y: 0.9 }
            ]
          },
          featureFlags: {
            speed_detection: s.feature_speed_detection !== false,
            red_light_detection: s.feature_red_light_detection === true,
            lane_detection: s.feature_lane_detection === true,
            helmet_detection: s.feature_helmet_detection === true,
            triple_riding_detection: s.feature_triple_riding_detection === true,
            plate_detection: s.feature_plate_detection !== false
          }
        }, [bitmap]);
      }).catch(err => {
        isWorkerBusyRef.current = false;
        // Typically a CORS-tainted source: no frame can ever be read, so fail the run truthfully.
        const msg = `Cannot read video frames from this source: ${describeError(err)}`;
        setError(msg);
        void closeSession(session, 'failed', msg);
        setRunState('STOPPED');
        videoRef.current?.pause();
      });
    }

    scheduleNext(video);
  };

  const startLoop = () => {
    if (loopActiveRef.current) return;
    loopActiveRef.current = true;
    processFrame();
  };

  // -------------------------------------------------------------------------------------------
  // Worker results
  // -------------------------------------------------------------------------------------------
  const handleViolations = (session: AnalysisSession, violations: ViolationCandidate[], mediaTime: number) => {
    const now = Date.now();
    const source = session.source;
    const locationStr = source.kind === 'camera'
      ? (source.location || source.name)
      : `Uploaded Video: ${source.name}`;

    for (const v of violations) {
      const meta = v.metadata as ViolationMetadata & { confidence?: number };
      const conf = typeof meta.confidence === 'number' ? meta.confidence : 1.0;
      if (conf < 0.6) continue;

      const persistedTrackId = typeof meta.track_id === 'number' ? session.trackIdOffset + meta.track_id : null;
      const dedupeKey = `${v.type}_${meta.track_id}`;
      const lastSeen = session.dedupe.get(dedupeKey);
      if (lastSeen && now - lastSeen < 10000) {
        session.metrics.incidentsSuppressed++;
        continue;
      }
      session.dedupe.set(dedupeKey, now);
      session.metrics.incidentsCreated++;

      const label = String(v.type).replace(/_/g, ' ');
      analysisLogger.log({
        ...logFor(session),
        category: 'INCIDENT',
        message: `Incident detected: ${label} (track #${persistedTrackId ?? '?'}, ${(conf * 100).toFixed(0)}% conf, t=${mediaTime.toFixed(1)}s)`
      });

      const snapshot = v.snapshot_url && v.snapshot_url.startsWith('data:image') ? v.snapshot_url : null;
      const plateCrop = meta.plate_crop_path && meta.plate_crop_path.startsWith('data:image') ? meta.plate_crop_path : null;
      const createdAt = v.timestamp || new Date().toISOString();

      const queueIncident = (ocr: { plate_text?: string; plate_confidence?: number; ocr_status: string }) => {
        if (session.closed) return;
        session.incidentQueue.push({
          row: {
            incident_type: v.type,
            violation_type: v.type,
            severity: v.severity || 'medium',
            status: 'Active',
            confidence: conf,
            track_id: persistedTrackId,
            camera_id: source.kind === 'camera' ? source.id : null,
            video_id: source.kind === 'video' ? source.id : null,
            analysis_run_id: session.runId,
            location: locationStr,
            description: `${label} detected (track #${persistedTrackId ?? '?'}, confidence ${(conf * 100).toFixed(0)}%) at ${locationStr}`,
            created_at: createdAt,
            metadata: {
              media_time: Math.round(mediaTime * 100) / 100,
              speed: meta.speed,
              speed_limit: meta.speed_limit,
              evidence_score: meta.evidence_metadata?.score,
              ...ocr
            }
          },
          evidence: [
            ...(snapshot ? [{ type: 'snapshot' as const, base64: snapshot }] : []),
            ...(plateCrop ? [{ type: 'plate_crop' as const, base64: plateCrop }] : [])
          ]
        });
      };

      if (plateCrop && import.meta.env.VITE_OCR_ENDPOINT) {
        requestOcr(plateCrop)
          .then(res => queueIncident({ plate_text: res.text, plate_confidence: res.confidence, ocr_status: 'completed' }))
          .catch(() => queueIncident({ ocr_status: 'failed' }));
      } else {
        queueIncident({ ocr_status: plateCrop ? 'not_configured' : 'no_plate' });
      }
    }
  };

  const tick = (session: AnalysisSession) => {
    const now = performance.now();
    session.fpsWindowFrames++;
    const elapsed = now - session.fpsWindowStart;
    if (elapsed >= 1000) {
      session.metrics.fps = Math.round((session.fpsWindowFrames * 1000) / elapsed);
      session.fpsWindowFrames = 0;
      session.fpsWindowStart = now;
      const m = session.metrics;
      if (isCurrent(session)) {
        setLive({
          fps: m.fps,
          latency: m.latency,
          frames: m.framesProcessed,
          detections: m.detectionsGenerated,
          created: m.incidentsCreated,
          suppressed: m.incidentsSuppressed,
          saved: m.incidentsSaved,
          tracked: session.tracked.size,
          queue: session.incidentQueue.length
        });
      }
      void flushIncidents(session);
    }
    if (now - session.lastTrackFlush >= 3000) {
      session.lastTrackFlush = now;
      void flushTracks(session, false);
    }
    if (now - session.lastMetricsPersist >= 5000) {
      session.lastMetricsPersist = now;
      persistRunMetrics(session).catch(e => {
        if (session.metricsErrorLogged) return;
        session.metricsErrorLogged = true;
        analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `Run metrics not persisted: ${describeError(e)}` });
      });
    }
  };

  const handleResult = (msg: ResultMessage) => {
    isWorkerBusyRef.current = false;
    const frameSession = inflightSessionRef.current;
    inflightSessionRef.current = null;
    const session = sessionRef.current;
    if (!session || session.closed || frameSession !== session) return; // result for a previous source/run

    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (canvas && video) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
          canvas.width = video.clientWidth;
          canvas.height = video.clientHeight;
        }
        drawBoundingBoxes(ctx, msg.tracks, canvas.width, canvas.height, video.videoWidth, video.videoHeight);
      }
    }

    session.metrics.latency = msg.inferenceTime;
    session.metrics.framesProcessed++;
    session.metrics.detectionsGenerated += msg.tracks.length;

    const t = msg.mediaTime;
    for (const tr of msg.tracks) {
      let rec = session.tracked.get(tr.trackId);
      if (!rec) {
        rec = {
          track_id: session.trackIdOffset + tr.trackId,
          object_type: tr.className,
          confidence: tr.prob,
          first_seen_timestamp: t,
          last_seen_timestamp: t,
          frame_count: 0,
          trajectory: []
        };
        session.tracked.set(tr.trackId, rec);
      }
      rec.last_seen_timestamp = t;
      rec.frame_count++;
      rec.confidence = Math.max(rec.confidence, tr.prob);
      const last = rec.trajectory[rec.trajectory.length - 1];
      if ((!last || Math.abs(t - last.time) >= 0.25) && rec.trajectory.length < 400) {
        rec.trajectory.push({
          time: Math.round(t * 100) / 100,
          bbox: [Math.round(tr.x - tr.w / 2), Math.round(tr.y - tr.h / 2), Math.round(tr.w), Math.round(tr.h)],
          speed: typeof tr.speed === 'number' ? Math.round(tr.speed) : undefined
        });
      }
    }

    if (msg.tracks.length > 0) {
      analysisLogger.logDetection(
        logFor(session).video_id,
        logFor(session).camera_id,
        session.runId,
        `Detected ${msg.tracks.length} object(s): ${msg.tracks.slice(0, 3).map(x => `${x.className} #${session.trackIdOffset + x.trackId}`).join(', ')}${msg.tracks.length > 3 ? ` +${msg.tracks.length - 3} more` : ''}`
      );
    }

    if (msg.violations && msg.violations.length > 0) handleViolations(session, msg.violations, t);
    tick(session);
  };

  const workerMessageRef = useRef<(msg: WorkerOutputMessage) => void>(() => {});
  workerMessageRef.current = (msg: WorkerOutputMessage) => {
    if (msg.type === 'ready') {
      modelReadyRef.current = true;
      providerRef.current = { provider: msg.provider, fallbackReason: msg.fallbackReason };
      setModelStatus('ready');
      setModelError(null);
      setProvider(msg.provider);
      const source = activeSourceRef.current;
      if (source) {
        analysisLogger.log({
          ...logForSource(source),
          category: 'MODEL',
          message: `${MODEL_NAME} model ready (${msg.provider.toUpperCase()})${msg.fallbackReason ? ` — ${msg.fallbackReason}` : ''}`
        });
      }
    } else if (msg.type === 'result') {
      handleResult(msg);
    } else if (msg.type === 'error') {
      isWorkerBusyRef.current = false;
      inflightSessionRef.current = null;
      if (msg.phase === 'init') {
        modelReadyRef.current = false;
        setModelStatus('error');
        setModelError(msg.error);
        const source = activeSourceRef.current;
        if (source) analysisLogger.log({ ...logForSource(source), category: 'ERROR', message: `Model failed to load: ${msg.error}` });
      }
      const session = sessionRef.current;
      if (session) {
        setError(`Inference failed: ${msg.error}`);
        void closeSession(session, 'failed', msg.error);
        setRunState('STOPPED');
        videoRef.current?.pause();
      }
    }
  };

  // Detection worker: one per mounted page, model loaded once.
  useEffect(() => {
    modelReadyRef.current = false;
    setModelStatus('loading');
    let worker: Worker;
    try {
      worker = new Worker(new URL('../pipeline/worker/index.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      setModelStatus('error');
      setModelError(`Failed to start detection worker: ${describeError(e)}`);
      return;
    }
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<WorkerOutputMessage>) => workerMessageRef.current(e.data);
    worker.onerror = (ev) => {
      const msg = ev.message || 'unknown worker error';
      workerMessageRef.current({ type: 'error', phase: modelReadyRef.current ? 'inference' : 'init', error: `Detection worker error: ${msg}` });
    };
    worker.postMessage({ type: 'init', modelPath: MODEL_PATH });

    return () => {
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      modelReadyRef.current = false;
      isWorkerBusyRef.current = false;
    };
  }, []);

  // Cameras + settings (dropdown and calibration)
  useEffect(() => {
    db.settings.list().then(s => { settingsRef.current = s || {}; }).catch(e => console.warn('Settings load failed:', e));
    db.cameras.list().then((c: CameraRow[] | null) => setCameras(c || [])).catch(e => console.warn('Camera list load failed:', e));

    const channel = supabase.channel('analyze-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => {
        db.settings.list().then(s => { settingsRef.current = s || {}; }).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras' }, () => {
        db.cameras.list().then((c: CameraRow[] | null) => setCameras(c || [])).catch(() => {});
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Best effort on tab close; normal navigation is handled by the selection effect cleanup.
  useEffect(() => {
    const onBeforeUnload = () => {
      const session = sessionRef.current;
      if (session) void closeSession(session, 'stopped', 'page closed');
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // -------------------------------------------------------------------------------------------
  // Media source lifecycle
  // -------------------------------------------------------------------------------------------
  const detachMedia = () => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      if (video.getAttribute('src')) {
        video.removeAttribute('src');
        video.load(); // aborts the previous resource; its pending events are dropped
      }
    }
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const attachMedia = (url: string, useHls: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    detachMedia();
    setSourceState('SOURCE_LOADING');
    if (useHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && hlsRef.current === hls) handleSourceFailure(`HLS stream error: ${data.details}`);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url; // assigned exactly once per selected source
      video.load();
    }
  };

  const handleSourceFailure = (message: string) => {
    setSourceState('SOURCE_ERROR', message);
    const source = activeSourceRef.current;
    if (source) analysisLogger.log({ ...logForSource(source), category: 'ERROR', message: `Source unavailable: ${message}` });
    const session = sessionRef.current;
    if (session) {
      void closeSession(session, 'failed', message);
      setRunState('STOPPED');
    }
  };

  const teardownSource = () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    loopActiveRef.current = false;
    inflightSessionRef.current = null;
    if (session && !session.closed) void closeSession(session, 'stopped', 'source changed');
    uploadUnsubRef.current?.();
    uploadUnsubRef.current = null;
    activeSourceRef.current = null;
    detachMedia();
  };

  const loadSavedSummary = async (source: SourceContext, seq: number) => {
    const col = source.kind === 'video' ? 'video_id' : 'camera_id';
    const count = async (table: string) => {
      const { count: c, error: cErr } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq(col, source.id);
      if (cErr) throw cErr;
      return (c as number | null) ?? 0;
    };
    try {
      const [incidents, tracks, runs] = await Promise.all([count('incidents'), count('tracked_objects'), count('analysis_runs')]);
      if (seq === loadSeqRef.current) setSaved({ incidents, tracks, runs });
    } catch (e) {
      console.warn('Saved analysis summary unavailable:', e);
    }
  };

  const loadVideo = async (videoId: string, seq: number) => {
    const { data, error: fetchErr } = await supabase.from('video_assets').select('*').eq('id', videoId).maybeSingle();
    if (seq !== loadSeqRef.current) return;
    if (fetchErr) return setSourceState('SOURCE_ERROR', `Could not load video asset: ${describeError(fetchErr)}`);
    if (!data) return setSourceState('SOURCE_ERROR', `Video asset ${videoId} was not found.`);

    const asset = data as VideoAsset;
    const source: SourceContext = { kind: 'video', id: asset.id, name: videoDisplayName(asset), location: null };
    activeSourceRef.current = source;
    setSourceInfo(source);
    liveAnalysisSession.setVideoLabel(asset.id, source.name);
    void loadSavedSummary(source, seq);

    // Upload started from this tab (survives navigation): show its real state.
    const upload = uploadManager.getUpload(asset.id);
    if (upload) {
      uploadUnsubRef.current = uploadManager.subscribe(asset.id, up => {
        if (activeSourceRef.current !== source) return;
        setCurrentUpload(up);
      });
    }

    // State of THIS asset's own Storage object (existence + identical-content check).
    let info: Awaited<ReturnType<typeof fetchStorageInfo>> | null = null;
    try {
      info = await fetchStorageInfo();
    } catch (e) {
      console.warn('Storage info unavailable:', e);
    }
    if (seq !== loadSeqRef.current) return;
    const assetInfo = info?.get(asset.id);

    if (assetInfo?.identicalToVideoId) {
      const { data: twin } = await supabase.from('video_assets').select('id, display_number, filename').eq('id', assetInfo.identicalToVideoId).maybeSingle();
      if (seq !== loadSeqRef.current) return;
      setContentNote(`This asset's stored file is byte-identical to ${twin ? videoDisplayName(twin as VideoAsset) : 'another video'} (same size and checksum) — the same source file was uploaded more than once.`);
    }

    if (upload?.status === 'failed') {
      setSourceState('SOURCE_ERROR', `The upload of this video failed: ${upload.error ?? 'unknown error'}. Upload the file again.`);
      return;
    }
    const availability = getAssetAvailability(asset, assetInfo, upload?.status === 'uploading');
    if (availability.kind === 'available') {
      // This asset's canonical persistent copy, resolved by its storage provider (B2: presigned URL).
      try {
        const url = await resolveVideoUrl(asset);
        if (seq !== loadSeqRef.current) return;
        attachMedia(url, false);
      } catch (e) {
        if (seq !== loadSeqRef.current) return;
        const msg = `Could not open this video's stored file (${storageProviderLabel(asset)}): ${describeError(e)}`;
        setSourceState('SOURCE_ERROR', msg);
        analysisLogger.log({ ...logForSource(source), category: 'ERROR', message: msg });
      }
    } else if (upload?.localPreviewUrl) {
      attachMedia(upload.localPreviewUrl, false); // this tab's local copy of the file being uploaded
    } else {
      setSourceState('SOURCE_ERROR', availabilityMessage(availability) ?? 'This video has no playable stored file.');
    }
  };

  const loadCamera = async (cameraId: string, seq: number) => {
    let cam: CameraRow;
    try {
      cam = await db.cameras.get(cameraId);
    } catch (e) {
      if (seq === loadSeqRef.current) setSourceState('SOURCE_ERROR', `Could not load camera: ${describeError(e)}`);
      return;
    }
    if (seq !== loadSeqRef.current) return;
    const source: SourceContext = { kind: 'camera', id: cam.id, name: cam.name, location: cam.location };
    activeSourceRef.current = source;
    setSourceInfo(source);
    void loadSavedSummary(source, seq);

    const playback = resolveCameraPlayback(cam);
    if ('error' in playback) {
      setSourceState('SOURCE_ERROR', playback.error);
      return;
    }
    attachMedia(playback.url, playback.hls);
  };

  // Explicit ?video= / ?camera= → session, then drop the params (a refresh must not restore the selection).
  useEffect(() => {
    if (!videoParam && !cameraParam) return;
    if (videoParam) liveAnalysisSession.selectVideo(videoParam);
    else if (cameraParam) liveAnalysisSession.selectCamera(cameraParam);
    setSearchParams({}, { replace: true });
  }, [videoParam, cameraParam, setSearchParams]);

  // Selected asset follows the active source. Changing ?video= / ?camera= tears down the previous source
  // (closing its run) before the new one loads; sequence ids discard stale async results.
  useEffect(() => {
    setError(null);
    setSaveError(null);
    setSaved(null);
    setCurrentUpload(null);
    setContentNote(null);
    setActiveRunId(null);
    setLive(EMPTY_METRICS);
    setRunState('NONE');
    setSourceInfo(null);
    if (!selectionKey) {
      setSourceState('IDLE');
      return;
    }
    const seq = ++loadSeqRef.current;
    setSourceState('SOURCE_LOADING');
    const [kind, id] = [selectionKey.slice(0, selectionKey.indexOf(':')), selectionKey.slice(selectionKey.indexOf(':') + 1)];
    void (kind === 'video' ? loadVideo(id, seq) : loadCamera(id, seq));

    return () => {
      loadSeqRef.current++;
      teardownSource();
    };
  }, [selectionKey]);

  // -------------------------------------------------------------------------------------------
  // User actions
  // -------------------------------------------------------------------------------------------
  const startInference = async () => {
    const video = videoRef.current;
    const source = activeSourceRef.current;
    if (!video || !source || startingRef.current || sessionRef.current) return;
    if (sourceStateRef.current !== 'SOURCE_READY' || !modelReadyRef.current) return;

    startingRef.current = true;
    setRunState('STARTING');
    setError(null);
    setSaveError(null);

    try {
      // 1. Playback from the explicit click (no passive autoplay).
      try {
        if (video.ended) video.currentTime = 0;
        await video.play();
      } catch (e) {
        setError(`Playback could not start: ${describeError(e)}`);
        setRunState('NONE');
        return;
      }

      if (activeSourceRef.current !== source) {
        setRunState('NONE');
        return;
      }

      // 2. Exactly one analysis run for this session.
      let runId: string;
      let trackIdOffset: number;
      try {
        const col = source.kind === 'video' ? 'video_id' : 'camera_id';
        const { data: maxRow, error: maxErr } = await supabase
          .from('tracked_objects').select('track_id').eq(col, source.id)
          .order('track_id', { ascending: false }).limit(1);
        if (maxErr) throw maxErr;
        trackIdOffset = Number((maxRow as Array<{ track_id: number }> | null)?.[0]?.track_id ?? 0);

        const run = await db.analysisRuns.create({
          camera_id: source.kind === 'camera' ? source.id : null,
          video_id: source.kind === 'video' ? source.id : null,
          status: 'running',
          started_at: new Date().toISOString()
        });
        runId = run.id;
      } catch (e) {
        video.pause();
        const msg = `Could not create analysis run: ${describeError(e)}`;
        setError(msg);
        analysisLogger.log({ ...logForSource(source), category: 'ERROR', message: msg });
        setRunState('NONE');
        return;
      }

      if (activeSourceRef.current !== source) {
        // Source changed while the run was being created: close it immediately.
        await db.analysisRuns.update(runId, { status: 'stopped', ended_at: new Date().toISOString() }).catch(() => {});
        return;
      }

      const now = performance.now();
      const session: AnalysisSession = {
        source,
        runId,
        trackIdOffset,
        tracked: new Map(),
        incidentQueue: [],
        dedupe: new Map(),
        metrics: { framesProcessed: 0, detectionsGenerated: 0, incidentsCreated: 0, incidentsSuppressed: 0, incidentsSaved: 0, fps: 0, latency: 0 },
        fpsWindowStart: now,
        fpsWindowFrames: 0,
        lastMetricsPersist: now,
        lastTrackFlush: now,
        metricsErrorLogged: false,
        closed: false
      };
      sessionRef.current = session;
      workerRef.current?.postMessage({ type: 'reset_tracker' });
      setActiveRunId(runId);
      setLive(EMPTY_METRICS);

      const { provider: p, fallbackReason } = providerRef.current;
      analysisLogger.log({ ...logFor(session), category: 'PROCESSING', message: `Analysis run #${runId.slice(0, 8)} started on ${source.name}` });
      analysisLogger.log({ ...logFor(session), category: 'MODEL', message: `Inference backend: ${p.toUpperCase()}${fallbackReason ? ` (${fallbackReason})` : ''}` });
      analysisLogger.log({ ...logFor(session), category: 'TRACKING', message: `Tracker initialized (track ids from #${trackIdOffset + 1})` });

      if (source.kind === 'video') {
        const { error: vaErr } = await supabase.from('video_assets').update({ processing_status: 'processing' }).eq('id', source.id);
        if (vaErr) analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `video_assets status update failed: ${describeError(vaErr)}` });
      }

      if (session.closed) return;
      if (video.paused) {
        // The user paused during startup: keep the run open in PAUSED.
        void pauseSession(session);
        return;
      }
      setRunState('ANALYZING');
      startLoop();
    } finally {
      startingRef.current = false;
    }
  };

  const pauseInference = () => videoRef.current?.pause(); // onPause transitions the session
  const resumeInference = () => {
    videoRef.current?.play().catch(e => setError(`Playback could not resume: ${describeError(e)}`)); // onPlay resumes
  };
  const stopInference = async () => {
    const session = sessionRef.current;
    if (!session) return;
    setRunState('STOPPED');
    videoRef.current?.pause();
    await closeSession(session, 'stopped', 'stopped by user');
  };

  // Media element events
  const onLoadedMetadata = () => {
    const video = videoRef.current;
    const source = activeSourceRef.current;
    if (!video || !source || sourceStateRef.current !== 'SOURCE_LOADING') return;
    setSourceState('SOURCE_READY');
    const dims = video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : 'unknown size';
    const dur = Number.isFinite(video.duration) ? `, ${video.duration.toFixed(1)}s` : ' (live)';
    analysisLogger.log({ ...logForSource(source), category: 'SYSTEM', message: `Media ready: ${dims}${dur}` });
  };

  const onMediaError = () => {
    const video = videoRef.current;
    if (!video || !activeSourceRef.current) return;
    if (!video.getAttribute('src') && !hlsRef.current) return; // detached element
    handleSourceFailure(mediaErrorText(video.error));
  };

  const onPlay = () => {
    const session = sessionRef.current;
    if (session && runStateRef.current === 'PAUSED') resumeSession(session);
  };

  const onPause = () => {
    const video = videoRef.current;
    const session = sessionRef.current;
    if (!video || video.ended || !session) return; // 'ended' is handled separately
    if (runStateRef.current === 'ANALYZING') void pauseSession(session);
  };

  const onEnded = () => {
    const session = sessionRef.current;
    if (!session) return;
    setRunState('COMPLETED');
    void closeSession(session, 'completed', 'end of video');
  };

  // Upload: show the selection immediately, create the asset row, then select it via the URL
  // (the selection effect plays the local copy while uploadManager uploads in the background).
  const handleFile = async (file: File) => {
    const selectedAt = new Date().toISOString();
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      const msg = `"${file.name}" is not a supported video file (type: ${file.type || 'unknown'}). Select an MP4, WebM or MOV file.`;
      console.warn('Upload validation failed:', msg);
      setPendingFile({ name: file.name, size: file.size, error: msg });
      setError(msg);
      return;
    }
    setPendingFile({ name: file.name, size: file.size, error: null });
    setError(null);
    try {
      const { videoId } = await uploadManager.startUpload(file, selectedAt);
      setPendingFile(null);
      liveAnalysisSession.selectVideo(videoId); // the new upload becomes the active Live Analysis source
    } catch (err) {
      const msg = describeError(err);
      console.error('Upload could not start:', err);
      setPendingFile({ name: file.name, size: file.size, error: msg });
      setError(`Upload could not start: ${msg}`);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const openFilePicker = () => fileInputRef.current?.click();
  const cameraName = (id: string | null) => (id ? cameras.find(c => c.id === id)?.name ?? null : null);

  const selectCamera = (id: string) => {
    const prev = liveAnalysisSession.get();
    if (prev.mode === 'camera' && prev.cameraId === id) return;
    if (prev.mode === 'uploaded-video' && prev.videoId) {
      analysisLogger.log({ camera_id: id, category: 'SYSTEM', message: `Switched from uploaded video (${prev.videoLabel ?? prev.videoId.slice(0, 8)}) to camera ${cameraName(id) ?? ''}`.trim() });
    }
    liveAnalysisSession.selectCamera(id);
  };

  // Camera mode keeps the uploaded video retained; it re-opens the camera chosen earlier this session, if any.
  const enterCameraMode = () => {
    const prev = liveAnalysisSession.get();
    if (prev.mode === 'camera') return;
    if (prev.cameraId && prev.videoId) {
      analysisLogger.log({ camera_id: prev.cameraId, category: 'SYSTEM', message: `Switched from uploaded video (${prev.videoLabel ?? prev.videoId.slice(0, 8)}) to camera ${cameraName(prev.cameraId) ?? ''}`.trim() });
    }
    liveAnalysisSession.selectCamera(prev.cameraId);
  };

  const returnToUploadedVideo = () => {
    const prev = liveAnalysisSession.get();
    if (prev.mode === 'uploaded-video') return;
    if (prev.videoId) {
      const from = cameraName(prev.cameraId);
      analysisLogger.log({ video_id: prev.videoId, category: 'SYSTEM', message: `Returned to uploaded video${from ? ` from camera ${from}` : ''}` });
    }
    liveAnalysisSession.showUploadedVideo();
  };

  // Clears only the Live Analysis selection; the video_assets row and stored file are untouched.
  const clearActiveVideo = () => {
    const prev = liveAnalysisSession.get();
    if (!prev.videoId) return;
    analysisLogger.log({ video_id: prev.videoId, category: 'SYSTEM', message: 'Active video cleared from Live Analysis (the asset remains in Video Library)' });
    liveAnalysisSession.clearVideo(); // selection effect cleanup stops any active run and resets the player
    uploadManager.releasePreview(prev.videoId);
    setPendingFile(null);
  };

  // -------------------------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------------------------
  const displayState: string = sourceState !== 'SOURCE_READY' ? sourceState : runState === 'NONE' ? 'SOURCE_READY' : runState;
  const sourceMode: 'video' | 'camera' = videoParam ? 'video' : cameraParam ? 'camera' : session.mode === 'camera' ? 'camera' : 'video';
  const segmentClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
      active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
    }`;
  const showVideo = sourceState === 'SOURCE_READY' || (sourceState === 'SOURCE_LOADING' && !!sourceInfo);
  const canStart = sourceState === 'SOURCE_READY' && modelStatus === 'ready' && (runState === 'NONE' || runState === 'STOPPED' || runState === 'COMPLETED');

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto">
      <header className="mb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
              sourceMode === 'camera' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
            }`}>
              {sourceMode === 'camera' ? <Radio className="w-3 h-3 text-emerald-600" /> : <Film className="w-3 h-3 text-indigo-600" />}
              {sourceMode === 'camera' ? 'Live Camera Source' : 'Uploaded Video Asset'}
            </span>
            {activeRunId && (
              <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                Run #{activeRunId.split('-')[0]}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">AI Traffic Analysis</h1>
          <p className="text-slate-500 text-sm">
            {sourceMode === 'camera'
              ? 'Analyzing live roadway camera stream with persistent run metrics and vehicle tracking.'
              : 'Analyzing uploaded video asset with persistent incident and trajectory logging.'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div role="group" aria-label="Analysis source" className="inline-flex items-center gap-0.5 rounded-xl border border-slate-300 bg-white p-0.5 shadow-sm">
            <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Source</span>
            <button
              id="analyze-source-uploaded"
              type="button"
              aria-pressed={sourceMode === 'video'}
              onClick={returnToUploadedVideo}
              className={segmentClass(sourceMode === 'video')}
              title={session.videoId ? `Uploaded video: ${session.videoLabel ?? session.videoId}` : 'No active uploaded video'}
            >
              <Film className="w-3.5 h-3.5" />
              Uploaded Video{sourceMode === 'camera' && session.videoLabel ? ` · ${session.videoLabel}` : ''}
            </button>
            <button
              id="analyze-source-camera"
              type="button"
              aria-pressed={sourceMode === 'camera'}
              onClick={enterCameraMode}
              disabled={cameras.length === 0}
              className={segmentClass(sourceMode === 'camera')}
              title={cameras.length === 0 ? 'No cameras configured' : 'Analyze a live camera'}
            >
              <CameraIcon className="w-3.5 h-3.5" />
              Camera
            </button>
          </div>

          {sourceMode === 'camera' && cameras.length > 0 && (
            <select
              id="analyze-camera-select"
              aria-label="Select live camera for analysis"
              className="bg-white border border-slate-300 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
              value={sourceInfo?.kind === 'camera' ? sourceInfo.id : (session.cameraId ?? '')}
              onChange={(e) => {
                if (e.target.value === '__uploaded_video__') returnToUploadedVideo();
                else if (e.target.value) selectCamera(e.target.value);
              }}
            >
              <option value="" disabled>-- Select a camera --</option>
              <option value="__uploaded_video__">← Back to Uploaded Video{session.videoLabel ? ` (${session.videoLabel})` : ''}</option>
              {cameras.map(cam => (
                <option key={cam.id} value={cam.id} disabled={!cam.source_url && !cam.stream_url}>
                  📹 {cam.name} {(!cam.source_url && !cam.stream_url) ? '(No URL)' : ''}
                </option>
              ))}
            </select>
          )}

          <button
            id="analyze-upload-video-btn"
            type="button"
            onClick={openFilePicker}
            disabled={!!pendingFile && !pendingFile.error}
            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 active:scale-[0.98] text-white px-5 py-2.5 rounded-xl font-semibold shadow-md shadow-indigo-500/20 transition-all cursor-pointer text-xs"
          >
            {pendingFile && !pendingFile.error ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {pendingFile && !pendingFile.error ? 'Creating video record…' : 'Upload MP4'}
          </button>
        </div>

        <input
          id="analyze-file-input"
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/*"
          className="hidden"
          onChange={handleFileInput}
        />
      </header>

      {pendingFile && (
        <UploadCard
          fileName={pendingFile.name}
          fileSize={pendingFile.size}
          status={pendingFile.error ? 'FAILED' : 'CREATING RECORD'}
          detail={pendingFile.error ?? 'Creating the video_assets record…'}
          progress={null}
          onDismiss={pendingFile.error ? () => setPendingFile(null) : undefined}
        />
      )}
      {!pendingFile && currentUpload && (
        <UploadCard
          fileName={currentUpload.fileName}
          fileSize={currentUpload.fileSize}
          status={currentUpload.status === 'uploading' ? 'UPLOADING' : currentUpload.status === 'uploaded' ? 'UPLOADED' : 'FAILED'}
          detail={
            currentUpload.status === 'uploading'
              ? `${formatMb(currentUpload.bytesUploaded)} of ${formatMb(currentUpload.fileSize)} sent to ${currentUpload.providerLabel}${currentUpload.bytesPerSecond ? ` · ${formatMb(currentUpload.bytesPerSecond)}/s` : ''}${currentUpload.etaSeconds !== null ? ` · about ${formatDuration(currentUpload.etaSeconds)} left` : ''} — playing the local copy meanwhile. You can switch pages; keep this tab open until it finishes.`
              : currentUpload.status === 'uploaded'
                ? `Stored in ${currentUpload.providerLabel}: ${currentUpload.storagePath ?? ''}`
                : `Upload failed: ${currentUpload.error ?? 'unknown error'}`
          }
          progress={currentUpload.status === 'uploading' ? currentUpload.progress : null}
        />
      )}

      <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3" id="analyze-status-bar">
        <StatusPill
          id="status-analysis-state"
          active={true}
          tone={
            displayState === 'SOURCE_ERROR' ? 'red' :
            displayState === 'ANALYZING' || displayState === 'COMPLETED' ? 'green' :
            displayState === 'SOURCE_LOADING' || displayState === 'STARTING' ? 'indigo' : 'amber'
          }
          icon={
            displayState === 'ANALYZING' ? <Activity className="w-4 h-4 animate-pulse" /> :
            displayState === 'SOURCE_LOADING' || displayState === 'STARTING' ? <Loader2 className="w-4 h-4 animate-spin" /> :
            displayState === 'SOURCE_ERROR' ? <AlertTriangle className="w-4 h-4" /> :
            displayState === 'PAUSED' ? <Pause className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />
          }
          label={`State: ${displayState}`}
        />
        <StatusPill
          id="status-model-ready"
          active={modelStatus !== 'loading'}
          tone={modelStatus === 'error' ? 'red' : 'green'}
          icon={modelStatus === 'ready' ? <CheckCircle2 className="w-4 h-4" /> : modelStatus === 'error' ? <AlertTriangle className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
          label={modelStatus === 'ready' ? `${MODEL_NAME} Ready · ${provider.toUpperCase()}` : modelStatus === 'error' ? 'Model failed to load' : 'Model Loading…'}
        />
        <StatusPill
          id="status-source-source"
          active={!!sourceInfo}
          tone="indigo"
          icon={sourceMode === 'camera' ? <CameraIcon className="w-4 h-4" /> : <Film className="w-4 h-4" />}
          label={sourceInfo ? `${sourceInfo.kind === 'camera' ? 'Cam' : 'Vid'}: ${sourceInfo.name}` : 'No Source Selected'}
        />
        <StatusPill
          id="status-incidents-created"
          active={live.created > 0}
          tone="rose"
          icon={<ShieldAlert className="w-4 h-4" />}
          label={`Incidents: ${live.created} created (${live.saved} saved)`}
        />
      </div>

      {modelError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" id="analyze-model-error">
          AI model unavailable: {modelError}
        </div>
      )}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between" id="analyze-error">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-4">✕</button>
        </div>
      )}
      {saveError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm" id="analyze-save-error">
          Detections are running, but persistence failed: {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch min-h-[460px]">
        <div className="lg:col-span-8 flex flex-col gap-3">
          <div
            className="relative bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center min-h-[440px] max-h-[68vh] border border-slate-800 shadow-xl"
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
          >
            <video
              id="analyze-video"
              ref={videoRef}
              controls
              playsInline
              crossOrigin="anonymous"
              muted
              preload="auto"
              onLoadedMetadata={onLoadedMetadata}
              onPlay={onPlay}
              onPause={onPause}
              onEnded={onEnded}
              onError={onMediaError}
              className={`max-h-[68vh] w-auto z-10 ${showVideo ? '' : 'hidden'}`}
            />
            <canvas
              ref={canvasRef}
              className="absolute pointer-events-none z-20"
              style={{
                width: videoRef.current?.clientWidth,
                height: videoRef.current?.clientHeight,
                left: videoRef.current?.offsetLeft,
                top: videoRef.current?.offsetTop
              }}
            />

            {sourceState === 'SOURCE_LOADING' && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/70">
                <div className="flex items-center gap-3 text-slate-200 text-sm">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                  Loading {sourceInfo?.name ?? 'source'}…
                </div>
              </div>
            )}

            {sourceState === 'SOURCE_ERROR' && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 p-6">
                <div className="bg-slate-900 border border-rose-900/60 p-6 rounded-2xl max-w-md w-full text-center shadow-2xl">
                  <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-3" />
                  <h3 className="text-white font-semibold text-base mb-1">Source unavailable</h3>
                  <p className="text-slate-300 text-xs">{sourceError}</p>
                  {sourceMode === 'camera' && session.videoId && (
                    <button
                      type="button"
                      onClick={returnToUploadedVideo}
                      className="mt-4 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      <Film className="w-3.5 h-3.5" /> Back to Uploaded Video{session.videoLabel ? ` (${session.videoLabel})` : ''}
                    </button>
                  )}
                </div>
              </div>
            )}

            {sourceState === 'IDLE' && sourceMode === 'video' && (
              <div className="absolute inset-4 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-700 p-8 text-center text-slate-300">
                <div className="p-4 rounded-full bg-indigo-500/15">
                  <Film className="w-10 h-10 text-indigo-400" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-white">No active video</div>
                  <div className="text-sm text-slate-400 mt-1">Upload an MP4, open one from Video Library, or switch to a camera. Then press Start Inference.</div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={openFilePicker}
                    className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium cursor-pointer shadow-md"
                  >
                    <Upload className="w-4 h-4" /> Upload MP4
                  </button>
                  <Link
                    to="/app/videos"
                    className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-lg font-medium border border-slate-700"
                  >
                    <Film className="w-4 h-4 text-indigo-300" /> Video Library
                  </Link>
                  {cameras.length > 0 && (
                    <button
                      type="button"
                      onClick={enterCameraMode}
                      className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-lg font-medium cursor-pointer border border-slate-700"
                    >
                      <CameraIcon className="w-4 h-4 text-emerald-400" /> Switch to Camera
                    </button>
                  )}
                </div>
              </div>
            )}

            {sourceState === 'IDLE' && sourceMode === 'camera' && (
              <div className="absolute inset-4 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-700 p-8 text-center text-slate-300">
                <div className="p-4 rounded-full bg-emerald-500/15">
                  <CameraIcon className="w-10 h-10 text-emerald-400" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-white">Select a camera</div>
                  <div className="text-sm text-slate-400 mt-1">Choose a camera from the list above to start a live source.</div>
                </div>
                {session.videoId && (
                  <button
                    type="button"
                    onClick={returnToUploadedVideo}
                    className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium cursor-pointer shadow-md"
                  >
                    <Film className="w-4 h-4" /> Back to Uploaded Video{session.videoLabel ? ` (${session.videoLabel})` : ''}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Inference controls: every transition is driven by an explicit click */}
          {sourceInfo && (
            <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm" id="analyze-controls">
              {(runState === 'NONE' || runState === 'STOPPED' || runState === 'COMPLETED') && (
                <button
                  id="analyze-start-btn"
                  type="button"
                  onClick={() => { void startInference(); }}
                  disabled={!canStart}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-lg font-semibold text-sm cursor-pointer shadow-sm"
                >
                  {runState === 'NONE' ? <Play className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
                  {runState === 'NONE' ? 'Start Inference' : 'Start New Run'}
                </button>
              )}
              {runState === 'STARTING' && (
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-indigo-700">
                  <Loader2 className="w-4 h-4 animate-spin" /> Starting analysis run…
                </span>
              )}
              {runState === 'ANALYZING' && (
                <button type="button" onClick={pauseInference} className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 rounded-lg font-semibold text-sm cursor-pointer shadow-sm">
                  <Pause className="w-4 h-4" /> Pause
                </button>
              )}
              {runState === 'PAUSED' && (
                <button type="button" onClick={resumeInference} className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-semibold text-sm cursor-pointer shadow-sm">
                  <Play className="w-4 h-4" /> Resume
                </button>
              )}
              {(runState === 'ANALYZING' || runState === 'PAUSED') && (
                <button type="button" onClick={() => { void stopInference(); }} className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-5 py-2.5 rounded-lg font-semibold text-sm cursor-pointer">
                  <Square className="w-4 h-4" /> Stop
                </button>
              )}
              <span className="text-xs text-slate-500 ml-auto">
                {sourceState === 'SOURCE_LOADING' ? 'Waiting for media…'
                  : sourceState === 'SOURCE_ERROR' ? 'Source unavailable'
                  : modelStatus === 'loading' ? 'Waiting for AI model…'
                  : modelStatus === 'error' ? 'AI model unavailable'
                  : runState === 'COMPLETED' ? 'Run completed and saved'
                  : runState === 'STOPPED' ? 'Run stopped and saved'
                  : runState === 'NONE' ? 'Ready — playback alone does not run analysis'
                  : null}
              </span>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 flex flex-col h-full min-h-[440px] max-h-[68vh]">
          <AnalysisLogPanel
            videoId={sourceInfo?.kind === 'video' ? sourceInfo.id : null}
            cameraId={sourceInfo?.kind === 'camera' ? sourceInfo.id : null}
            className="h-full flex-1"
          />
        </div>
      </div>

      {sourceInfo && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <div>
            Active Source: <span className="font-semibold text-slate-800">{sourceInfo.name}</span>
            {saved && (
              <span className="ml-2">· Saved: {saved.runs} run(s), {saved.tracks} tracked object(s), {saved.incidents} incident(s)</span>
            )}
            {contentNote && <div className="mt-1 text-amber-700">{contentNote}</div>}
          </div>
          {sourceInfo.kind === 'video' && (
            <div className="flex items-center gap-3 shrink-0">
              <button
                id="analyze-clear-video"
                type="button"
                onClick={clearActiveVideo}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer"
                title="Remove this video from Live Analysis (it stays in Video Library)"
              >
                <X className="w-3.5 h-3.5" /> Clear Video
              </button>
              <Link
                to={`/app/video-review?video=${sourceInfo.id}`}
                className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline flex items-center gap-1"
              >
                Open persistent analysis in Video Review →
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="FPS / Latency"
          value={<>{live.fps} <span className="text-sm text-slate-400 font-normal">| {Math.round(live.latency)}ms</span></>}
          color="text-emerald-600"
        />
        <MetricCard label="Detections" value={live.detections.toLocaleString()} color="text-purple-600" />
        <MetricCard
          label="Incidents"
          value={<>{live.created} <span className="text-sm text-slate-400 font-normal">({live.saved} saved, {live.suppressed} suppressed)</span></>}
          color="text-rose-600"
        />
        <MetricCard label="Tracked Objects" value={live.tracked.toLocaleString()} color="text-cyan-600" />
        <MetricCard label="Frames Processed" value={live.frames.toLocaleString()} color="text-blue-600" />
        <MetricCard label="Queue Depth" value={live.queue.toLocaleString()} color="text-slate-700" />
      </div>
    </div>
  );
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function UploadCard({ fileName, fileSize, status, detail, progress, onDismiss }: {
  fileName: string;
  fileSize: number;
  status: 'CREATING RECORD' | 'UPLOADING' | 'UPLOADED' | 'FAILED';
  detail: string;
  progress: number | null;
  onDismiss?: () => void;
}) {
  const failed = status === 'FAILED';
  return (
    <div id="analyze-upload-card" className={`mb-6 rounded-xl p-4 border ${failed ? 'bg-red-50 border-red-200' : status === 'UPLOADED' ? 'bg-emerald-50 border-emerald-200' : 'bg-indigo-50 border-indigo-100'}`}>
      <div className="flex justify-between items-start gap-3 text-xs">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate flex items-center gap-2">
            {(status === 'UPLOADING' || status === 'CREATING RECORD') && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600 shrink-0" />}
            {failed && <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />}
            {status === 'UPLOADED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
            <span className="truncate">{fileName}</span>
            <span className="text-slate-500 font-normal shrink-0">{formatMb(fileSize)}</span>
          </div>
          <div className={`mt-1 ${failed ? 'text-red-700' : 'text-slate-600'}`}>{detail}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2 py-0.5 rounded font-bold tracking-wider ${failed ? 'bg-red-100 text-red-700' : status === 'UPLOADED' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
            {status}{progress !== null ? ` ${progress}%` : ''}
          </span>
          {onDismiss && <button type="button" onClick={onDismiss} className="text-slate-400 hover:text-slate-600 font-bold">✕</button>}
        </div>
      </div>
      {progress !== null && (
        <div className="mt-2 w-full bg-indigo-200/60 rounded-full h-2 overflow-hidden">
          <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}

const TONES: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  red: 'bg-red-50 text-red-700 border-red-200'
};

function StatusPill({ id, active, tone, icon, label }: { id: string; active: boolean; tone: string; icon: React.ReactNode; label: string }) {
  return (
    <div
      id={id}
      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all ${active ? TONES[tone] : 'bg-white text-slate-400 border-slate-200'}`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
      <div className="text-slate-500 text-xs font-medium mb-1 truncate">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
