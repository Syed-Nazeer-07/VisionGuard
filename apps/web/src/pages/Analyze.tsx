import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Upload, CheckCircle2, Loader2,
  AlertTriangle, Film, Play, Pause, Square, RotateCcw, X,
  Maximize2, Minimize2, Clock, Eye, Gauge
} from 'lucide-react';
import Hls from 'hls.js';
import { cn } from '../lib/utils';
import { drawBoundingBoxes } from '../pipeline/rendering/overlay';
import { computeVideoTransform } from '../pipeline/rendering/transform';
import { computeHomography } from '../pipeline/tracker/homography';
import {
  isOverlayAgeFresh,
  computeResultAge,
  shouldStopAfterInferenceErrors,
  isWorkerStalled,
  WORKER_STALL_RESTART_MS,
  diagnosePipeline
} from '../pipeline/worker/frameSync';
import { InferenceCoordinator } from '../pipeline/worker/inferenceCoordinator';
import type { ResultMessage, WorkerOutputMessage, CalibrationData } from '../pipeline/types';
import type { ViolationCandidate, ViolationMetadata } from '../pipeline/violations/types';
import { db, type VideoAsset } from '../services/db';
import { requestOcr } from '../pipeline/plate/service';
import { evidenceQueue } from '../pipeline/evidence/queue';
import { supabase } from '../lib/supabase';
import {
  checkBackendHealth,
  createAnalysisJob,
  getJobStatus,
  cancelAnalysisJob,
  getAllJobResults,
  findFrameAtMediaTime,
  downloadJobArtifactBlob,
  fetchJobArtifactJson,
  fetchJobArtifactBlobAndJson,
  saveArtifactToStorage,
  loadArtifactFromStorage,
  setActiveBackendJob,
  getActiveBackendJob,
  clearActiveBackendJob,
  type PersistedBackendJob,
  type BackendHealth,
  type BackendJobStatus,
  type BackendFrameResult,
  type DetectionProfile,
  DETECTION_PROFILES,
  type ProcessingSpeed,
  PROCESSING_SPEEDS
} from '../services/backendAnalysis';
import type { TrackedObject } from '../pipeline/types';
import { uploadManager, type ActiveUpload } from '../services/uploadManager';
import { liveAnalysisSession } from '../services/liveAnalysisSession';
import { analysisLogger } from '../services/analysisLogger';
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
type VideoPlaybackState = 'idle' | 'loading_source' | 'loading_metadata' | 'ready' | 'playing' | 'error';
type AnalysisJobState = 'idle' | 'preparing' | 'uploading' | 'queued' | 'analyzing' | 'finalizing' | 'completed' | 'failed' | 'cancelled';
type RunState = 'NONE' | 'STARTING' | 'ANALYZING' | 'PAUSED' | 'STOPPED' | 'COMPLETED';
type ModelStatus = 'loading' | 'ready' | 'error';
type TerminalStatus = 'completed' | 'stopped' | 'failed';

interface SourceContext {
  kind: 'video';
  id: string;
  name: string;
  location: string | null;
  isLocalOnly?: boolean;
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
  droppedFrames: number;
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
  logState: {
    lastLogTime: number;
    lastFramesProcessed: number;
    lastDroppedFrames: number;
    createdTracks: number;
  };
}

interface LiveMetrics {
  fps: number;
  latency: number;
  frames: number;
  droppedFrames: number;
  detections: number;
  created: number;
  suppressed: number;
  saved: number;
  tracked: number;
  queue: number;
  resultAge: number;
  renderedTracks: number;
  staleDropped: number;
  staleRejected: number;
  workerErrors: number;
  workerBusy: boolean;
}

interface SavedSummary {
  incidents: number;
  tracks: number;
  runs: number;
}

const EMPTY_METRICS: LiveMetrics = { fps: 0, latency: 0, frames: 0, droppedFrames: 0, detections: 0, created: 0, suppressed: 0, saved: 0, tracked: 0, queue: 0, resultAge: 0, renderedTracks: 0, staleDropped: 0, staleRejected: 0, workerErrors: 0, workerBusy: false };
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

export default function Analyze() {
  const [searchParams, setSearchParams] = useSearchParams();
  const videoParam = searchParams.get('video');
  const reanalyzeParam = searchParams.get('reanalyze') === 'true';
  const profileParam = searchParams.get('profile');
  const speedParam = searchParams.get('speed');
  const shouldReanalyzeRef = useRef<boolean>(false);
  const targetProfileRef = useRef<DetectionProfile | null>(null);
  const targetSpeedRef = useRef<ProcessingSpeed | null>(null);
  // The active source lives in the in-memory Live Analysis session: it survives SPA navigation and is
  // reset by a browser refresh. ?video= is an explicit entry point (e.g. History → Analyze).
  const session = useSyncExternalStore(liveAnalysisSession.subscribe, liveAnalysisSession.get);
  const selectionKey = videoParam ? `video:${videoParam}` : (session.videoId ? `video:${session.videoId}` : '');

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const localVideoUrlRef = useRef<string | null>(null);

  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [modelError, setModelError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>('');
  const [sourceState, setSourceStateValue] = useState<SourceState>('IDLE');
  const [runState, setRunStateValue] = useState<RunState>('NONE');
  const [sourceInfo, setSourceInfo] = useState<SourceContext | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveMetrics>(EMPTY_METRICS);
  const [saved, setSaved] = useState<SavedSummary | null>(null);
  const [saveToHistory, setSaveToHistory] = useState<boolean>(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [playbackTime, setPlaybackTime] = useState<{ current: number; duration: number }>({ current: 0, duration: 0 });
  const [playbackState, setPlaybackState] = useState<VideoPlaybackState>('idle');
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const playbackTimeoutRef = useRef<NodeJS.Timeout | number | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  // File chosen but its video_assets row not created yet (shown immediately on selection)
  const [pendingFile, setPendingFile] = useState<{ name: string; size: number; error: string | null } | null>(null);
  // Upload state of the currently selected video, if this tab is/was uploading it
  const [currentUpload, setCurrentUpload] = useState<ActiveUpload | null>(null);
  const [contentNote, setContentNote] = useState<string | null>(null);

  // Local Python backend vs In-Browser WebGPU mode
  const [analysisEngine, setAnalysisEngine] = useState<'backend' | 'browser'>(() => {
    return (localStorage.getItem('visionguard_analysis_engine') as 'backend' | 'browser') || 'backend';
  });
  const analysisEngineRef = useRef(analysisEngine);
  analysisEngineRef.current = analysisEngine;
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean>(false);
  const [backendJob, setBackendJob] = useState<BackendJobStatus | null>(null);
  const [, setBackendFrames] = useState<BackendFrameResult[] | null>(null);
  const backendFramesRef = useRef<BackendFrameResult[] | null>(null);
  const activeBackendJobIdRef = useRef<string | null>(null);
  const [analysisStage, setAnalysisStage] = useState<'idle' | 'preparing' | 'uploading' | 'queued' | 'analyzing' | 'finalizing' | 'completed' | 'failed' | 'cancelled'>('idle');
  const [isPollingRetrying, setIsPollingRetrying] = useState<boolean>(false);
  const [isProgressStalled, setIsProgressStalled] = useState<boolean>(false);
  const smoothedFpsRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);
  const lastProgressTimeRef = useRef<number>(Date.now());
  const consecutiveErrorsRef = useRef<number>(0);

  // Speed estimation ground-plane calibration state
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibrationPoints, setCalibrationPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [refWidth, setRefWidth] = useState<number>(3.5);
  const [refHeight, setRefHeight] = useState<number>(15.0);
  const [calSpeedLimit, setCalSpeedLimit] = useState<number>(60);
  const [calTolerance, setCalTolerance] = useState<number>(10);

  const saveCalibration = async (newCal: CalibrationData) => {
    // Validate homography before saving: ensure points are non-collinear and non-degenerate
    if (!newCal.calibrationArea || newCal.calibrationArea.length !== 4) {
      setError('Speed calibration requires exactly 4 road-plane ground points.');
      return;
    }
    const dst = [
      { x: 0, y: 0 },
      { x: newCal.referenceWidth, y: 0 },
      { x: newCal.referenceWidth, y: newCal.referenceHeight },
      { x: 0, y: newCal.referenceHeight }
    ];
    const H = computeHomography(newCal.calibrationArea, dst);
    if (!H || H.length !== 9) {
      setError('Invalid road calibration: selected points are collinear or degenerate. Please place 4 distinct corners outlining the road plane.');
      return;
    }

    setCalibration(newCal);
    setIsCalibrating(false);

    // Notify worker immediately if running in browser mode
    workerRef.current?.postMessage({
      type: 'update_calibration',
      calibration: newCal
    });

    if (sourceInfo && !sourceInfo.isLocalOnly && sourceInfo.id) {
      try {
        const { data: assetData } = await supabase
          .from('video_assets')
          .select('metadata')
          .eq('id', sourceInfo.id)
          .maybeSingle();

        const existingMeta = (assetData?.metadata && typeof assetData.metadata === 'object' && !Array.isArray(assetData.metadata))
          ? assetData.metadata
          : {};

        await supabase
          .from('video_assets')
          .update({
            metadata: {
              ...existingMeta,
              calibration: newCal
            }
          })
          .eq('id', sourceInfo.id);

        analysisLogger.log({
          category: 'SYSTEM',
          message: `Saved ground-plane speed calibration (${newCal.referenceWidth}m width × ${newCal.referenceHeight}m length) for video "${sourceInfo.name}".`
        });
      } catch (err) {
        console.warn('Failed to persist calibration to video_assets:', err);
      }
    }
  };

  const clearCalibration = async () => {
    setCalibration(null);
    setCalibrationPoints([]);
    setIsCalibrating(false);

    if (sourceInfo && !sourceInfo.isLocalOnly && sourceInfo.id) {
      try {
        const { data: assetData } = await supabase
          .from('video_assets')
          .select('metadata')
          .eq('id', sourceInfo.id)
          .maybeSingle();

        if (assetData?.metadata && typeof assetData.metadata === 'object' && !Array.isArray(assetData.metadata)) {
          const updatedMeta = { ...assetData.metadata };
          delete updatedMeta.calibration;
          await supabase
            .from('video_assets')
            .update({ metadata: updatedMeta })
            .eq('id', sourceInfo.id);
        }

        analysisLogger.log({
          category: 'SYSTEM',
          message: `Cleared speed calibration for video "${sourceInfo.name}".`
        });
      } catch (err) {
        console.warn('Failed to clear calibration from video_assets:', err);
      }
    }
  };

  // Helper to change engine explicitly (persisted to storage)
  const selectAnalysisEngine = (engine: 'backend' | 'browser') => {
    if (isSubmittingJobRef.current || backendJob?.status === 'running' || backendJob?.status === 'queued' || runStateRef.current === 'ANALYZING' || runStateRef.current === 'STARTING') {
      return;
    }
    analysisEngineRef.current = engine;
    setAnalysisEngine(engine);
    localStorage.setItem('visionguard_analysis_engine', engine);

    // Cleanly clear overlays and incompatible cached results without resetting the loaded source or preview player
    clearOverlayCanvas();
    latestResultRef.current = null;
    if (engine === 'browser') {
      stopBackendOverlayLoop();
      if (!workerRef.current) {
        spawnWorker();
      }
      if (runStateRef.current === 'ANALYZING' && videoRef.current && !videoRef.current.paused) {
        startLoop();
      }
    } else {
      stopLoop();
      workerRef.current?.postMessage({ type: 'reset_tracker' });
      void checkBackendHealth();
      if (backendFramesRef.current && videoRef.current && !videoRef.current.paused) {
        startBackendOverlayLoop();
      }
    }
    requestAnimationFrame(() => drawOverlayRef.current?.());
  };

  // Configurable Detection Quality Profile ('balanced' | 'high_recall')
  const [detectionProfile, setDetectionProfile] = useState<DetectionProfile>(() => {
    if (profileParam === 'balanced' || profileParam === 'high_recall') return profileParam;
    return (localStorage.getItem('visionguard_detection_profile') as DetectionProfile) || 'balanced';
  });

  useEffect(() => {
    if (profileParam === 'balanced' || profileParam === 'high_recall') {
      setDetectionProfile(profileParam);
    }
  }, [profileParam]);

  useEffect(() => {
    localStorage.setItem('visionguard_detection_profile', detectionProfile);
  }, [detectionProfile]);

  // Configurable Processing Speed ('full' | 'fast')
  const [processingSpeed, setProcessingSpeed] = useState<ProcessingSpeed>(() => {
    if (speedParam === 'full' || speedParam === 'fast') return speedParam;
    return (localStorage.getItem('visionguard_processing_speed') as ProcessingSpeed) || 'full';
  });

  useEffect(() => {
    if (speedParam === 'full' || speedParam === 'fast') {
      setProcessingSpeed(speedParam);
    }
  }, [speedParam]);

  useEffect(() => {
    localStorage.setItem('visionguard_processing_speed', processingSpeed);
  }, [processingSpeed]);

  const [isSubmittingJob, setIsSubmittingJob] = useState<boolean>(false);
  const isSubmittingJobRef = useRef<boolean>(false);
  const backendPollIntervalRef = useRef<NodeJS.Timeout | number | null>(null);

  // Surface evidence persistence errors in the UI banner
  useEffect(() => {
    return evidenceQueue.onError((errMsg) => {
      setSaveError(errMsg);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const res = await checkBackendHealth();
      if (!cancelled) {
        setBackendAvailable(res.isAvailable);
        setBackendHealth(res.health || null);
      }
    };
    void check();
    const interval = setInterval(check, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Refs read by worker/frame callbacks (never stale)
  const sourceStateRef = useRef<SourceState>('IDLE');
  const runStateRef = useRef<RunState>('NONE');
  const activeSourceRef = useRef<SourceContext | null>(null);
  const sessionRef = useRef<AnalysisSession | null>(null);
  const latestResultRef = useRef<ResultMessage | null>(null);
  const coordRef = useRef(new InferenceCoordinator<AnalysisSession>());
  const lastAcceptedAtRef = useRef(0);
  const pendingTrackerResetRef = useRef(false);
  const lastPresentedMediaTimeRef = useRef<number | null>(null);
  const [isOverlayDelayed, setIsOverlayDelayed] = useState(false);
  const isOverlayDelayedRef = useRef(false);
  const loadSeqRef = useRef(0);
  const startingRef = useRef(false);
  const loopActiveRef = useRef(false);
  const modelReadyRef = useRef(false);
  const providerRef = useRef<{ provider: string; fallbackReason: string | null }>({ provider: '', fallbackReason: null });
  const latestOverlayStatsRef = useRef({ rendered: 0, stale: 0 });
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
    video_id: session.source.isLocalOnly ? null : session.source.id,
    camera_id: null,
    analysis_run_id: session.source.isLocalOnly ? null : session.runId
  });
  const logForSource = (source: SourceContext) => ({
    video_id: source.isLocalOnly ? null : source.id,
    camera_id: null
  });

  // -------------------------------------------------------------------------------------------
  // Persistence (every function takes the session explicitly so stale work never leaks into a
  // newly selected source)
  // -------------------------------------------------------------------------------------------
  const persistRunMetrics = async (session: AnalysisSession, patch: { status?: string; ended_at?: string } = {}) => {
    if (session.source.isLocalOnly) return;
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
    if (session.source.isLocalOnly) {
      session.metrics.incidentsSaved += batch.length;
      return;
    }
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
    if (session.source.isLocalOnly || session.tracked.size === 0) return;
    const isVideo = session.source.kind === 'video';
    const rows = Array.from(session.tracked.values()).map(r => ({
      video_id: isVideo ? session.source.id : null,
      camera_id: null,
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
    if (!session.source.isLocalOnly) {
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
  // Frame loop and source-frame synchronization
  // -------------------------------------------------------------------------------------------
  const clearOverlayCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    latestOverlayStatsRef.current = { rendered: 0, stale: 0 };
  };

  // During playback, compare against the frame actually reported as presented by
  // requestVideoFrameCallback rather than the media clock, which may be slightly ahead.
  // Paused/seeking media uses currentTime because it is the position being held/selected.
  const getDisplayedMediaTime = (video: HTMLVideoElement): number => {
    if (video.paused || video.seeking) return video.currentTime;
    return lastPresentedMediaTimeRef.current ?? video.currentTime;
  };

  const drawOverlay = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
    }
    if (canvas.style.width !== `${video.clientWidth}px`) canvas.style.width = `${video.clientWidth}px`;
    if (canvas.style.height !== `${video.clientHeight}px`) canvas.style.height = `${video.clientHeight}px`;
    if (canvas.style.left !== `${video.offsetLeft}px`) canvas.style.left = `${video.offsetLeft}px`;
    if (canvas.style.top !== `${video.offsetTop}px`) canvas.style.top = `${video.offsetTop}px`;

    // 1. If in Backend mode and we have precomputed backendFrames:
    const activeEngine = analysisEngineRef.current;
    if (activeEngine === 'backend' && backendFramesRef.current) {
      const mediaTime = getDisplayedMediaTime(video);
      const matchedFrame = findFrameAtMediaTime(backendFramesRef.current, mediaTime, 0.15);
      if (!matchedFrame || !video.videoWidth || !video.videoHeight) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        latestOverlayStatsRef.current = { rendered: 0, stale: 0 };
        return;
      }
      try {
        const isCover = document.fullscreenElement === containerRef.current;
        const mappedTracks: TrackedObject[] = matchedFrame.tracks.map(t => ({
          trackId: t.track_id,
          x: t.x,
          y: t.y,
          w: t.w,
          h: t.h,
          dx: t.dx,
          dy: t.dy,
          dw: 0,
          dh: 0,
          prob: t.prob,
          classId: t.class_id,
          className: t.class_name,
          state: (t.state as 'Confirmed' | 'Tentative' | 'Lost' | 'Removed') || 'Confirmed',
          frameCount: 1,
          timeSinceUpdate: 0,
          hitCount: 2,
          speed: (t.class_name === 'person' || t.class_name === 'pedestrian') ? undefined : (t.speed ?? undefined),
          velocity: (t.class_name === 'person' || t.class_name === 'pedestrian') ? undefined : (t.velocity ?? undefined),
          isOverspeed: (t.class_name === 'person' || t.class_name === 'pedestrian') ? false : (t.is_overspeed ?? false),
          observationType: t.observation_type,
          predictionConfidence: t.prediction_confidence ?? undefined
        }));
        const srcW = matchedFrame.source_width || video.videoWidth;
        const srcH = matchedFrame.source_height || video.videoHeight;
        const stats = drawBoundingBoxes(
          ctx, mappedTracks, canvas.width, canvas.height,
          srcW, srcH, isCover, 0
        );
        latestOverlayStatsRef.current = stats;
      } catch (e) {
        console.error('Failed to render backend overlay:', e);
      }
      return;
    }

    // 2. Otherwise (Browser WebGPU mode):
    const latest = latestResultRef.current;
    if (!latest || !video.videoWidth || !video.videoHeight) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      latestOverlayStatsRef.current = { rendered: 0, stale: 0 };
      if (isOverlayDelayedRef.current) {
        isOverlayDelayedRef.current = false;
        setIsOverlayDelayed(false);
      }
      return;
    }

    try {
      const isCover = document.fullscreenElement === containerRef.current;
      const timeDelta = computeResultAge(getDisplayedMediaTime(video), latest.mediaTime);
      const srcW = latest.sourceWidth || video.videoWidth;
      const srcH = latest.sourceHeight || video.videoHeight;
      const stats = drawBoundingBoxes(
        ctx, latest.tracks, canvas.width, canvas.height,
        srcW, srcH, isCover, timeDelta
      );
      latestOverlayStatsRef.current = stats;

      const delayed = runStateRef.current === 'ANALYZING' && !video.paused && (
        (latest.tracks.length > 0 && stats.stale > 0 && stats.rendered === 0) ||
        !isOverlayAgeFresh(timeDelta)
      );
      if (delayed !== isOverlayDelayedRef.current) {
        isOverlayDelayedRef.current = delayed;
        setIsOverlayDelayed(delayed);
      }
    } catch (e) {
      console.error('Failed to render overlay:', e);
    }
  };

  const drawOverlayRef = useRef(drawOverlay);
  drawOverlayRef.current = drawOverlay;

  useEffect(() => {
    const onResize = () => {
      requestAnimationFrame(() => drawOverlayRef.current?.());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => drawOverlayRef.current?.());
    return () => cancelAnimationFrame(id);
  }, [isFullscreen]);

  const backendOverlayCallbackHandleRef = useRef<number | null>(null);

  const stopBackendOverlayLoop = () => {
    const video = videoRef.current;
    if (backendOverlayCallbackHandleRef.current !== null) {
      if (video && typeof (video as any).cancelVideoFrameCallback === 'function') {
        (video as any).cancelVideoFrameCallback(backendOverlayCallbackHandleRef.current);
      } else {
        cancelAnimationFrame(backendOverlayCallbackHandleRef.current);
      }
      backendOverlayCallbackHandleRef.current = null;
    }
  };

  const startBackendOverlayLoop = () => {
    const video = videoRef.current;
    if (!video) return;
    stopBackendOverlayLoop();

    const onFrame = (_now: DOMHighResTimeStamp, metadata?: any) => {
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) {
        backendOverlayCallbackHandleRef.current = null;
        return;
      }
      if (metadata && typeof metadata.mediaTime === 'number') {
        lastPresentedMediaTimeRef.current = metadata.mediaTime;
      } else {
        lastPresentedMediaTimeRef.current = videoRef.current.currentTime;
      }
      drawOverlayRef.current?.();
      if (typeof video.requestVideoFrameCallback === 'function') {
        backendOverlayCallbackHandleRef.current = video.requestVideoFrameCallback(onFrame);
      } else {
        backendOverlayCallbackHandleRef.current = requestAnimationFrame((ts) => onFrame(ts));
      }
    };

    if (typeof video.requestVideoFrameCallback === 'function') {
      backendOverlayCallbackHandleRef.current = video.requestVideoFrameCallback(onFrame);
    } else {
      backendOverlayCallbackHandleRef.current = requestAnimationFrame((ts) => onFrame(ts));
    }
  };

  const cancelCurrentBackendJob = async () => {
    if (backendPollIntervalRef.current) {
      clearInterval(backendPollIntervalRef.current);
      backendPollIntervalRef.current = null;
    }
    clearActiveBackendJob();
    isSubmittingJobRef.current = false;
    setIsSubmittingJob(false);
    setIsPollingRetrying(false);
    setIsProgressStalled(false);
    const jobId = activeBackendJobIdRef.current;
    activeBackendJobIdRef.current = null;
    setBackendJob(null);
    setAnalysisStage('cancelled');
    setRunState('STOPPED');
    if (jobId) {
      try {
        await cancelAnalysisJob(jobId);
      } catch (err) {
        console.warn('Failed to cancel backend job:', err);
      }
    }
    analysisLogger.log({ category: 'SYSTEM', message: 'Analysis cancelled by user.' });
  };

  const postTrackerResetWhenSafe = () => {
    if (coordRef.current.busy) {
      pendingTrackerResetRef.current = true;
      return;
    }
    postTrackerResetNow();
  };

  const scheduleNext = (video: HTMLVideoElement) => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback((_now, metadata) => {
        lastPresentedMediaTimeRef.current = metadata.mediaTime;
        processFrame(metadata.mediaTime);
      });
    } else {
      requestAnimationFrame(() => {
        const sampledMediaTime = video.currentTime;
        lastPresentedMediaTimeRef.current = sampledMediaTime;
        processFrame(sampledMediaTime);
      });
    }
  };

  const browserFrameIndexRef = useRef<number>(0);

  const processFrame = (callbackMediaTime?: number) => {
    const video = videoRef.current;
    const session = sessionRef.current;
    if (!video || !session || session.closed || runStateRef.current !== 'ANALYZING' || video.ended || video.paused) {
      loopActiveRef.current = false;
      return;
    }

    try {
      const stride = PROCESSING_SPEEDS[processingSpeed]?.frameStride ?? 1;
      browserFrameIndexRef.current += 1;
      if (stride > 1 && ((browserFrameIndexRef.current - 1) % stride !== 0)) {
        return;
      }

      const coord = coordRef.current;
      if (coord.busy) {
        coord.noteDropped();
        session.metrics.droppedFrames++;
        return;
      }

      const worker = workerRef.current;
      if (!worker || !modelReadyRef.current || video.readyState < 2) {
        return;
      }

      const mediaTime = Number.isFinite(callbackMediaTime) ? (callbackMediaTime as number) : video.currentTime;
      const inflight = coord.tryBegin(mediaTime, session, performance.now());
      if (!inflight) return;

      const { frameId, sourceGeneration } = inflight;

      createImageBitmap(video).then(bitmap => {
        if (
          session.closed || sessionRef.current !== session ||
          coord.generation !== sourceGeneration ||
          coord.inflight?.frameId !== frameId
        ) {
          bitmap.close();
          coord.cancel(frameId);
          flushPendingTrackerReset();
          return;
        }

        const settings = settingsRef.current;
        const confTh = DETECTION_PROFILES[detectionProfile]?.confidenceThreshold ?? 0.20;
        const iouTh = DETECTION_PROFILES[detectionProfile]?.iouThreshold ?? 0.45;
        worker.postMessage({
          type: 'inference',
          bitmap,
          mediaTime,
          frameId,
          sourceGeneration,
          sourceWidth: bitmap.width,
          sourceHeight: bitmap.height,
          confidenceThreshold: confTh,
          iouThreshold: iouTh,
          calibration: (calibration && calibration.calibrationArea?.length === 4)
            ? calibration
            : {
                referenceWidth: 2,
                referenceHeight: 2,
                speedLimit: settings.speed_limit_default ? Number(settings.speed_limit_default) : 60,
                tolerance: settings.speed_tolerance_default ? Number(settings.speed_tolerance_default) : 10,
                calibrationArea: [] // Empty means uncalibrated
              },
          featureFlags: {
            speed_detection: settings.feature_speed_detection !== false,
            red_light_detection: settings.feature_red_light_detection === true,
            lane_detection: settings.feature_lane_detection === true,
            helmet_detection: settings.feature_helmet_detection === true,
            triple_riding_detection: settings.feature_triple_riding_detection === true,
            plate_detection: settings.feature_plate_detection !== false
          }
        }, [bitmap]);
      }).catch(err => {
        handleInferenceFailure(frameId, `Cannot read video frames from this source: ${describeError(err)}`);
      });
    } finally {
      drawOverlay();
      if (!video.paused && !video.ended && runStateRef.current === 'ANALYZING') {
        scheduleNext(video);
      } else {
        loopActiveRef.current = false;
      }
    }
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
    const locationStr = `Video: ${source.name}`;

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
            camera_id: null,
            video_id: source.isLocalOnly ? null : source.id,
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
        const coord = coordRef.current;
        const video = videoRef.current;
        const latest = latestResultRef.current;
        const rawAge = video && latest ? computeResultAge(getDisplayedMediaTime(video), latest.mediaTime) : 0;
        const age = Number.isFinite(rawAge) ? Math.max(0, rawAge) : 0;
        setLive({
          fps: m.fps,
          latency: m.latency,
          frames: m.framesProcessed,
          droppedFrames: m.droppedFrames,
          detections: m.detectionsGenerated,
          created: m.incidentsCreated,
          suppressed: m.incidentsSuppressed,
          saved: m.incidentsSaved,
          tracked: session.tracked.size,
          queue: session.incidentQueue.length,
          resultAge: age,
          renderedTracks: latestOverlayStatsRef.current.rendered,
          staleDropped: latestOverlayStatsRef.current.stale,
          staleRejected: coord.counters.staleRejected + coord.counters.outOfOrderRejected,
          workerErrors: coord.counters.errors,
          workerBusy: coord.busy
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

  // Persisted track ids are `trackIdOffset + workerTrackId`. Whenever the tracker is reset its ids
  // restart at 1, so the offset is advanced first: records of the previous timeline are flushed
  // under their own ids and can never be merged with, or overwritten by, a new timeline's tracks.
  const rollTrackIds = (session: AnalysisSession) => {
    let maxWorkerId = 0;
    for (const id of session.tracked.keys()) maxWorkerId = Math.max(maxWorkerId, id);
    if (maxWorkerId === 0) return;
    void flushTracks(session, false);
    session.trackIdOffset += maxWorkerId;
    session.tracked.clear();
  };

  const postTrackerResetNow = () => {
    const session = sessionRef.current;
    if (session && !session.closed) rollTrackIds(session);
    workerRef.current?.postMessage({ type: 'reset_tracker' });
    pendingTrackerResetRef.current = false;
  };

  const flushPendingTrackerReset = () => {
    if (pendingTrackerResetRef.current && !coordRef.current.busy) postTrackerResetNow();
  };

  const applyResult = (msg: ResultMessage) => {
    const session = sessionRef.current;
    if (!session || session.closed) return;

    latestResultRef.current = msg;
    lastAcceptedAtRef.current = performance.now();

    session.metrics.latency = msg.inferenceTime;
    session.metrics.framesProcessed++;
    // Detections produced by the model for this frame (not the number of tracks derived from them).
    session.metrics.detectionsGenerated += msg.detectionCount;

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
        session.logState.createdTracks++;
      }
      rec.last_seen_timestamp = t;
      rec.frame_count++;
      rec.confidence = Math.max(rec.confidence, tr.prob);
      rec.object_type = tr.className; // the tracker's voted class, not a single-frame guess
      const last = rec.trajectory[rec.trajectory.length - 1];
      if ((!last || Math.abs(t - last.time) >= 0.25) && rec.trajectory.length < 400) {
        rec.trajectory.push({
          time: Math.round(t * 100) / 100,
          // Persisted in ORIGINAL video pixels as top-left x, y, width, height
          bbox: [Math.round(tr.x - tr.w / 2), Math.round(tr.y - tr.h / 2), Math.round(tr.w), Math.round(tr.h)],
          speed: typeof tr.speed === 'number' ? Math.round(tr.speed) : undefined
        });
      }
    }

    const now = Date.now();
    if (now - session.logState.lastLogTime >= 5000) {
      const coord = coordRef.current;
      const processed = session.metrics.framesProcessed - session.logState.lastFramesProcessed;
      const dropped = session.metrics.droppedFrames - session.logState.lastDroppedFrames;
      const fps = Math.round(processed / ((now - session.logState.lastLogTime) / 1000));
      const video = videoRef.current;
      const age = video ? computeResultAge(getDisplayedMediaTime(video), msg.mediaTime) : 0;
      const stats = latestOverlayStatsRef.current;
      const diagnosis = diagnosePipeline({
        workerBusyMs: coord.inflightAgeMs(performance.now()),
        latencyMs: msg.inferenceTime,
        resultAgeSeconds: Number.isFinite(age) ? age : 0,
        detectionCount: msg.detectionCount,
        trackCount: msg.tracks.length,
        renderedTracks: stats.rendered,
        workerErrors: coord.counters.errors
      });

      analysisLogger.log({
        ...logFor(session),
        category: 'PROCESSING',
        message: `Pipeline: ${fps} FPS | ${dropped} dropped | ${Math.round(msg.inferenceTime)}ms latency | result age ${Number.isFinite(age) ? age.toFixed(2) : 'n/a'}s | accepted ${coord.counters.accepted} | stale-rejected ${coord.counters.staleRejected + coord.counters.outOfOrderRejected} | worker errors ${coord.counters.errors} | ${diagnosis}`
      });

      const classCounts = msg.boxes.reduce((acc, b) => {
        acc[b.className] = (acc[b.className] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      const classDist = Object.entries(classCounts).map(([c, n]) => `${c}: ${n}`).join(', ');

      let minConf = 1;
      let sumConf = 0;
      let smallObjects = 0;
      const smallArea = 0.002 * msg.sourceWidth * msg.sourceHeight;
      msg.boxes.forEach(b => {
        if (b.prob < minConf) minConf = b.prob;
        sumConf += b.prob;
        if (b.w * b.h < smallArea) smallObjects++;
      });
      const avgConf = msg.boxes.length ? (sumConf / msg.boxes.length) : 0;
      minConf = msg.boxes.length ? minConf : 0;

      analysisLogger.log({
        ...logFor(session),
        category: 'DETECTION',
        message: `Objects: ${msg.boxes.length} (${smallObjects} small) | Conf: Avg ${(avgConf * 100).toFixed(0)}%, Min ${(minConf * 100).toFixed(0)}% | ${classDist || 'none'}`
      });

      analysisLogger.log({
        ...logFor(session),
        category: 'TRACKING',
        message: `Active tracks: ${msg.tracks.length} | Created recently: ${session.logState.createdTracks}`
      });

      session.logState.lastLogTime = now;
      session.logState.lastFramesProcessed = session.metrics.framesProcessed;
      session.logState.lastDroppedFrames = session.metrics.droppedFrames;
      session.logState.createdTracks = 0;
    }

    if (msg.violations && msg.violations.length > 0) handleViolations(session, msg.violations, t);
    tick(session);
  };

  /**
   * A frame request failed (worker exception or the frame could not be captured). The lock is
   * always released so the loop continues with the next presented frame; only a run of
   * consecutive failures stops the analysis.
   */
  const handleInferenceFailure = (frameId: number | undefined, message: string) => {
    const coord = coordRef.current;
    const { released, request } = coord.fail(frameId);
    if (!released || !request) return;
    flushPendingTrackerReset();

    const session = request.session;
    const stillCurrent = !session.closed && sessionRef.current === session && request.sourceGeneration === coord.generation;
    if (!stillCurrent) return;

    const failures = coord.counters.consecutiveErrors;
    if (shouldStopAfterInferenceErrors(failures)) {
      const text = `Inference failed ${failures} times in a row: ${message}`;
      setError(text);
      setRunState('STOPPED');
      videoRef.current?.pause();
      void closeSession(session, 'failed', text);
      analysisLogger.log({ ...logFor(session), category: 'ERROR', message: text });
    } else if (failures === 1) {
      analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `Frame skipped after inference error (analysis continues): ${message}` });
    }
  };

  const handleResult = (msg: ResultMessage) => {
    const coord = coordRef.current;
    const request = coord.inflight;
    const sessionIsCurrent = !!request && !request.session.closed && sessionRef.current === request.session;
    const outcome = coord.accept(msg, sessionIsCurrent);

    // A response for any frame other than the outstanding one never touches the lock or tracking.
    if (outcome.status === 'ignored') return;

    flushPendingTrackerReset();
    if (outcome.status !== 'accepted') return; // stale source/generation or out-of-order: discarded

    applyResult(msg);
    drawOverlay(); // redraw immediately; do not wait for the next presented frame

    const video = videoRef.current;
    if (video && !video.paused && runStateRef.current === 'ANALYZING' && !loopActiveRef.current) {
      startLoop();
    }
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
      if (msg.phase === 'init') {
        modelReadyRef.current = false;
        setModelStatus('error');
        setModelError(msg.error);
        const source = activeSourceRef.current;
        if (source) analysisLogger.log({ ...logForSource(source), category: 'ERROR', message: `Model failed to load: ${msg.error}` });
        return;
      }
      handleInferenceFailure(msg.frameId, msg.error);
    }
  };

  // Detection worker: one per mounted page, model loaded once. It is also the only thing
  // replaced by stall recovery, which is why creation lives in a function.
  const spawnWorker = () => {
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
    // Messages from a worker that has been replaced are ignored.
    worker.onmessage = (e: MessageEvent<WorkerOutputMessage>) => {
      if (workerRef.current === worker) workerMessageRef.current(e.data);
    };
    worker.onerror = (ev) => {
      if (workerRef.current !== worker) return;
      const message = ev.message || 'unknown worker error';
      if (!modelReadyRef.current) {
        workerMessageRef.current({ type: 'error', phase: 'init', error: `Detection worker error: ${message}` });
      } else {
        restartWorkerRef.current(`Detection worker crashed: ${message}`);
      }
    };
    worker.postMessage({ type: 'init', modelPath: MODEL_PATH });
  };

  /**
   * Replace the worker. Terminating the old one is what makes releasing the request lock safe:
   * it can no longer finish the abandoned frame, so no overlapping inference or out-of-order
   * tracker update is possible. The tracker restarts (new timeline), analysis continues.
   */
  const restartWorker = (reason: string) => {
    const coord = coordRef.current;
    const session = sessionRef.current;
    const old = workerRef.current;
    workerRef.current = null;
    old?.terminate();
    coord.recoverFromWorkerRestart();
    pendingTrackerResetRef.current = false;
    if (session && !session.closed) {
      rollTrackIds(session); // the new worker's tracker starts again at id 1
      analysisLogger.log({ ...logFor(session), category: 'ERROR', message: `Detection worker restarted: ${reason}` });
    } else {
      const source = activeSourceRef.current;
      if (source) analysisLogger.log({ ...logForSource(source), category: 'ERROR', message: `Detection worker restarted: ${reason}` });
    }
    spawnWorker();
  };
  const restartWorkerRef = useRef<(reason: string) => void>(() => {});
  restartWorkerRef.current = restartWorker;

  useEffect(() => {
    spawnWorker();
    return () => {
      const worker = workerRef.current;
      workerRef.current = null;
      worker?.terminate();
      modelReadyRef.current = false;
      coordRef.current.recoverFromWorkerRestart();
    };
  }, []);

  // Stall watchdog: a request outstanding for far longer than any real inference (shader
  // compilation included) means the worker is wedged. It is replaced, never overlapped.
  useEffect(() => {
    const id = window.setInterval(() => {
      const coord = coordRef.current;
      if (coord.busy && isWorkerStalled(coord.inflightAgeMs(performance.now()))) {
        restartWorkerRef.current(`no result for ${Math.round(WORKER_STALL_RESTART_MS / 1000)}s`);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // System settings for calibration & feature flags
  useEffect(() => {
    db.settings.list().then(s => { settingsRef.current = s || {}; }).catch(e => console.warn('Settings load failed:', e));

    const channel = supabase.channel('analyze-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => {
        db.settings.list().then(s => { settingsRef.current = s || {}; }).catch(() => {});
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
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
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
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    setPlaybackError(null);
    setPlaybackState('loading_source');
    setSourceState('SOURCE_LOADING');
    setMediaUrl(url);

    // Timeout: if metadata has not loaded after 15s, show friendly retry
    playbackTimeoutRef.current = setTimeout(() => {
      if (sourceStateRef.current !== 'SOURCE_READY') {
        const msg = 'Playback could not start. Check the video source or reconnect to storage.';
        setPlaybackState('error');
        setPlaybackError(msg);
        setSourceState('SOURCE_ERROR', msg);
      }
    }, 15000);

    const video = videoRef.current;
    if (!video) return;

    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (useHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && hlsRef.current === hls) handleSourceFailure(`HLS stream error: ${data.details}`);
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      if (video.src !== url) {
        video.src = url;
      }
      video.load();
    }
  };

  const retryPlayback = async () => {
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    setPlaybackError(null);
    setSourceError(null);
    setPlaybackState('loading_source');
    setSourceState('SOURCE_LOADING');

    const source = activeSourceRef.current;
    if (!source) return;

    // 1. If we have a local object URL (from recent file upload in this tab), retry it
    if (localVideoUrlRef.current) {
      attachMedia(localVideoUrlRef.current, false);
      return;
    }

    // 2. If it's a saved asset in Supabase/B2, resolve a fresh authorized URL
    if (!source.isLocalOnly && source.id) {
      try {
        const { data: assetData } = await supabase
          .from('video_assets')
          .select('id, storage_path, storage_provider')
          .eq('id', source.id)
          .maybeSingle();
        if (assetData) {
          const freshUrl = await resolveVideoUrl(assetData as VideoAsset);
          attachMedia(freshUrl, false);
          return;
        }
      } catch (err) {
        const msg = `Could not refresh playback URL: ${describeError(err)}`;
        setPlaybackState('error');
        setPlaybackError(msg);
        setSourceState('SOURCE_ERROR', msg);
        return;
      }
    }

    // 3. Fallback: reload current video element if src exists
    const video = videoRef.current;
    if (video && (video.src || mediaUrl)) {
      video.load();
    }
  };

  const handleSourceFailure = (message: string) => {
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    setPlaybackState('error');
    setPlaybackError(message);
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
    stopBackendOverlayLoop();
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    isSubmittingJobRef.current = false;
    setIsSubmittingJob(false);
    // Do NOT cancel active backend jobs on teardownSource.
    // Only explicit user cancellation (cancelCurrentBackendJob) cancels FastAPI jobs.
    const activePersisted = getActiveBackendJob();
    if (!activePersisted || (activePersisted.status !== 'running' && activePersisted.status !== 'queued')) {
      if (backendPollIntervalRef.current) {
        clearInterval(backendPollIntervalRef.current);
        backendPollIntervalRef.current = null;
      }
      activeBackendJobIdRef.current = null;
      setBackendJob(null);
    }
    backendFramesRef.current = null;
    setBackendFrames(null);
    const session = sessionRef.current;
    sessionRef.current = null;
    coordRef.current.invalidate();
    loopActiveRef.current = false;
    latestResultRef.current = null;
    lastPresentedMediaTimeRef.current = null;
    isOverlayDelayedRef.current = false;
    setIsOverlayDelayed(false);
    clearOverlayCanvas();
    if (coordRef.current.busy) pendingTrackerResetRef.current = true;
    else {
      workerRef.current?.postMessage({ type: 'reset_tracker' });
      pendingTrackerResetRef.current = false;
    }
    if (session && !session.closed) void closeSession(session, 'stopped', 'source changed');
    uploadUnsubRef.current?.();
    uploadUnsubRef.current = null;
    activeSourceRef.current = null;
    detachMedia();
  };

  const loadSavedSummary = async (source: SourceContext, seq: number) => {
    if (source.isLocalOnly) return;
    const col = 'video_id';
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
    if (fetchErr) {
      const msg = `Could not load video asset: ${describeError(fetchErr)}`;
      setPlaybackState('error');
      setPlaybackError(msg);
      return setSourceState('SOURCE_ERROR', msg);
    }
    if (!data) {
      const msg = `Video asset ${videoId} was not found.`;
      setPlaybackState('error');
      setPlaybackError(msg);
      return setSourceState('SOURCE_ERROR', msg);
    }

    const asset = data as VideoAsset;
    const source: SourceContext = { kind: 'video', id: asset.id, name: videoDisplayName(asset), location: null };
    activeSourceRef.current = source;
    setSourceInfo(source);
    liveAnalysisSession.setVideoLabel(asset.id, source.name);
    void loadSavedSummary(source, seq);

    const isReanalyze = shouldReanalyzeRef.current;
    shouldReanalyzeRef.current = false;

    const meta = (asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata) ? asset.metadata : {}) as Record<string, any>;
    if (meta.calibration && typeof meta.calibration === 'object' && Array.isArray(meta.calibration.calibrationArea) && meta.calibration.calibrationArea.length === 4) {
      setCalibration(meta.calibration as CalibrationData);
      setCalibrationPoints(meta.calibration.calibrationArea);
      setRefWidth(meta.calibration.referenceWidth || 3.5);
      setRefHeight(meta.calibration.referenceHeight || 15.0);
      setCalSpeedLimit(meta.calibration.speedLimit || 60);
    } else {
      setCalibration(null);
      setCalibrationPoints([]);
    }
    const preferredProfile = targetProfileRef.current || (meta.detection_profile === 'balanced' || meta.detection_profile === 'high_recall' ? meta.detection_profile : null);
    if (preferredProfile) {
      setDetectionProfile(preferredProfile);
    }
    const preferredSpeed = targetSpeedRef.current || (meta.processing_speed === 'full' || meta.processing_speed === 'fast' ? meta.processing_speed : null);
    if (preferredSpeed) {
      setProcessingSpeed(preferredSpeed);
    }
    targetProfileRef.current = null;
    targetSpeedRef.current = null;

    const activePersisted = getActiveBackendJob();
    const isJobRunningForVideo = activePersisted && activePersisted.videoId === videoId && (activePersisted.status === 'running' || activePersisted.status === 'queued');

    if (!isReanalyze && !isJobRunningForVideo && !activeBackendJobIdRef.current) {
      // Restore persisted analysis artifact if already processed (avoids re-running inference or needing port 8000)
      let artifactPath = meta.artifact_storage_path as string | undefined;
      let artifactBucket = (meta.artifact_bucket as string | undefined) || 'videos';

      if (!artifactPath) {
        const { data: latestRun } = await supabase
          .from('analysis_runs')
          .select('metrics')
          .eq('video_id', asset.id)
          .eq('status', 'completed')
          .order('ended_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const runMeta = (latestRun?.metrics && typeof latestRun.metrics === 'object' && !Array.isArray(latestRun.metrics) ? latestRun.metrics : {}) as Record<string, any>;
        if (runMeta.artifact_storage_path) {
          artifactPath = runMeta.artifact_storage_path;
          artifactBucket = runMeta.artifact_bucket || 'videos';
        }
      }

      if (artifactPath && typeof artifactPath === 'string') {
        try {
          const artifact = await loadArtifactFromStorage(artifactPath, artifactBucket);
          if (seq === loadSeqRef.current && artifact?.frames?.length) {
            backendFramesRef.current = artifact.frames;
            setBackendFrames(artifact.frames);
            setRunState('COMPLETED');
            setAnalysisStage('completed');
          }
        } catch (e) {
          console.warn('Could not restore saved analysis artifact from storage:', e);
        }
      }
    }

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
      const msg = `The upload of this video failed: ${upload.error ?? 'unknown error'}. Upload the file again.`;
      setPlaybackState('error');
      setPlaybackError(msg);
      setSourceState('SOURCE_ERROR', msg);
      return;
    }

    // Priority 1: If this tab has a local preview object URL, use it directly for immediate, flawless playback
    if (localVideoUrlRef.current) {
      attachMedia(localVideoUrlRef.current, false);
      return;
    }
    if (upload?.localPreviewUrl) {
      attachMedia(upload.localPreviewUrl, false);
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
        setPlaybackState('error');
        setPlaybackError(msg);
        setSourceState('SOURCE_ERROR', msg);
        analysisLogger.log({ ...logForSource(source), category: 'ERROR', message: msg });
      }
    } else {
      const msg = availabilityMessage(availability) ?? 'This video has no playable stored file.';
      setPlaybackState('error');
      setPlaybackError(msg);
      setSourceState('SOURCE_ERROR', msg);
    }
  };

  // Explicit ?video= → session, then drop the param
  useEffect(() => {
    if (!videoParam) return;
    if (reanalyzeParam) {
      shouldReanalyzeRef.current = true;
    }
    if (profileParam === 'balanced' || profileParam === 'high_recall') {
      targetProfileRef.current = profileParam;
      setDetectionProfile(profileParam);
    }
    if (speedParam === 'full' || speedParam === 'fast') {
      targetSpeedRef.current = speedParam;
      setProcessingSpeed(speedParam);
    }
    liveAnalysisSession.selectVideo(videoParam);
    setSearchParams({}, { replace: true });
  }, [videoParam, reanalyzeParam, profileParam, speedParam, setSearchParams]);

  // Selected asset follows the active source. Changing ?video= loads the new source;
  // sequence ids discard stale async results.
  useEffect(() => {
    const selectedId = selectionKey ? selectionKey.slice(selectionKey.indexOf(':') + 1) : null;

    // If this video is already active (e.g. prepared directly by handleFile), do NOT teardown or re-run
    if (selectedId && activeSourceRef.current?.id === selectedId) {
      return;
    }

    // If a backend job is being submitted or active for this video ID, do NOT teardown
    if (isSubmittingJobRef.current) {
      return;
    }
    if (activeBackendJobIdRef.current && (activeSourceRef.current?.id === selectedId || !selectedId)) {
      return;
    }

    if (backendPollIntervalRef.current) {
      clearInterval(backendPollIntervalRef.current);
      backendPollIntervalRef.current = null;
    }

    coordRef.current.invalidate();
    latestResultRef.current = null;
    lastPresentedMediaTimeRef.current = null;
    isOverlayDelayedRef.current = false;
    setIsOverlayDelayed(false);
    clearOverlayCanvas();
    backendFramesRef.current = null;
    setBackendFrames(null);
    const persisted = getActiveBackendJob();
    const isJobForSelected = persisted && persisted.videoId === selectedId && (persisted.status === 'running' || persisted.status === 'queued');
    if (!isJobForSelected) {
      activeBackendJobIdRef.current = null;
      setBackendJob(null);
    }
    setError(null);
    setSaveError(null);
    setSaved(null);
    setCurrentUpload(null);
    setContentNote(null);
    setActiveRunId(null);
    setLive(EMPTY_METRICS);
    setRunState('NONE');

    if (!selectionKey) {
      teardownSource();
      setSourceInfo(null);
      setSourceState('IDLE');
      setPlaybackState('idle');
      return;
    }

    const seq = ++loadSeqRef.current;
    setPlaybackState('loading_source');
    setSourceState('SOURCE_LOADING');
    const [kind, id] = [selectionKey.slice(0, selectionKey.indexOf(':')), selectionKey.slice(selectionKey.indexOf(':') + 1)];
    if (kind === 'video') {
      void loadVideo(id, seq);
    } else {
      setSourceState('IDLE');
      setPlaybackState('idle');
    }
  }, [selectionKey]);

  // Dedicated component-level unmount cleanup
  useEffect(() => {
    return () => {
      teardownSource();
      if (localVideoUrlRef.current) {
        URL.revokeObjectURL(localVideoUrlRef.current);
        localVideoUrlRef.current = null;
      }
    };
  }, []);

  // -------------------------------------------------------------------------------------------
  // User actions
  // -------------------------------------------------------------------------------------------
  const startInference = async () => {
    const video = videoRef.current;
    const source = activeSourceRef.current;
    if (!video || !source || startingRef.current || sessionRef.current) return;
    if (coordRef.current.busy) {
      setError('A previous frame is still finishing. Wait for it to settle before starting a new analysis run.');
      return;
    }
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
      let trackIdOffset = 0;
      if (source.isLocalOnly) {
        runId = `local-run-${Date.now()}`;
        trackIdOffset = 0;
      } else {
        try {
          const col = 'video_id';
          const { data: maxRow, error: maxErr } = await supabase
            .from('tracked_objects').select('track_id').eq(col, source.id)
            .order('track_id', { ascending: false }).limit(1);
          if (maxErr) throw maxErr;
          trackIdOffset = Number((maxRow as Array<{ track_id: number }> | null)?.[0]?.track_id ?? 0);

          const run = await db.analysisRuns.create({
            camera_id: null,
            video_id: source.id,
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
      }

      if (activeSourceRef.current !== source) {
        // Source changed while the run was being created: close it immediately.
        if (!source.isLocalOnly) {
          await db.analysisRuns.update(runId, { status: 'stopped', ended_at: new Date().toISOString() }).catch(() => {});
        }
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
        metrics: { framesProcessed: 0, droppedFrames: 0, detectionsGenerated: 0, incidentsCreated: 0, incidentsSuppressed: 0, incidentsSaved: 0, fps: 0, latency: 0 },
        fpsWindowStart: now,
        fpsWindowFrames: 0,
        lastMetricsPersist: now,
        lastTrackFlush: now,
        metricsErrorLogged: false,
        closed: false,
        logState: { lastLogTime: now, lastFramesProcessed: 0, lastDroppedFrames: 0, createdTracks: 0 }
      };
      sessionRef.current = session;
      coordRef.current.resetForNewRun();
      latestResultRef.current = null;
      workerRef.current?.postMessage({ type: 'reset_tracker' });
      setActiveRunId(runId);
      setLive(EMPTY_METRICS);

      const { provider: p, fallbackReason } = providerRef.current;
      analysisLogger.log({ ...logFor(session), category: 'PROCESSING', message: `Analysis run #${runId.slice(0, 8)} started on ${source.name}` });
      analysisLogger.log({ ...logFor(session), category: 'MODEL', message: `Inference backend: ${p.toUpperCase()}${fallbackReason ? ` (${fallbackReason})` : ''} | Input: 640x640 | Conf: 0.15, IoU: 0.45` });
      analysisLogger.log({ ...logFor(session), category: 'TRACKING', message: `Tracker initialized (track ids from #${trackIdOffset + 1})` });

      if (!source.isLocalOnly) {
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

  const pauseInference = () => {
    videoRef.current?.pause(); // onPause transitions the session
  };
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
  const onLoadStart = () => {
    setPlaybackState('loading_metadata');
  };

  const onLoadedMetadata = () => {
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    const video = videoRef.current;
    const source = activeSourceRef.current;
    if (!video) return;

    setSourceState('SOURCE_READY');
    setPlaybackState('ready');
    setPlaybackError(null);

    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    setPlaybackTime(prev => ({ ...prev, duration: dur }));

    const dims = video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : 'unknown size';
    const durStr = dur > 0 ? `, ${dur.toFixed(1)}s` : ' (live)';
    if (source) {
      analysisLogger.log({ ...logForSource(source), category: 'SYSTEM', message: `Media ready: ${dims}${durStr}` });
    }
  };

  const onLoadedData = () => {
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    setPlaybackState(prev => (prev === 'loading_source' || prev === 'loading_metadata' ? 'ready' : prev));
  };

  const onCanPlay = () => {
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
    setPlaybackState(prev => (prev === 'loading_source' || prev === 'loading_metadata' ? 'ready' : prev));
  };

  const onMediaError = () => {
    const video = videoRef.current;
    if (!video || !activeSourceRef.current) return;
    if (!video.getAttribute('src') && !video.src && !hlsRef.current) return; // detached element
    const errMsg = mediaErrorText(video.error);
    setPlaybackState('error');
    setPlaybackError(errMsg);
    handleSourceFailure(errMsg);
  };

  const onPlay = () => {
    setPlaybackState('playing');
    if (analysisEngine === 'backend') {
      startBackendOverlayLoop();
      return;
    }
    const session = sessionRef.current;
    if (session && runStateRef.current === 'PAUSED') resumeSession(session);
    else if (session && runStateRef.current === 'ANALYZING') startLoop();
  };

  const onPause = () => {
    stopBackendOverlayLoop();
    const video = videoRef.current;
    const session = sessionRef.current;
    if (!video || video.ended) return;
    setPlaybackState('ready');
    if (session && runStateRef.current === 'ANALYZING') void pauseSession(session);
    drawOverlay();
  };

  const onEmptied = () => {
    stopBackendOverlayLoop();
    setPlaybackState('idle');
  };

  const onSeeking = () => {
    browserFrameIndexRef.current = 0;
    if (analysisEngine === 'backend') {
      drawOverlay();
      return;
    }
    coordRef.current.invalidate();
    latestResultRef.current = null;
    clearOverlayCanvas();
    postTrackerResetWhenSafe();
  };

  const onSeeked = () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.seeking && Number.isFinite(video.currentTime)) {
      lastPresentedMediaTimeRef.current = video.currentTime;
    }
    drawOverlay();
    if (analysisEngine === 'backend') {
      if (!video.paused) startBackendOverlayLoop();
      return;
    }
    if (!video.paused && runStateRef.current === 'ANALYZING') {
      startLoop();
    }
  };

  const onEnded = () => {
    stopBackendOverlayLoop();
    setPlaybackState('ready');
    const session = sessionRef.current;
    if (!session) return;
    setRunState('COMPLETED');
    void closeSession(session, 'completed', 'end of video');
  };

  const startPollingJob = (
    currentJobId: string,
    displayName: string,
    jobProfile: DetectionProfile,
    jobSpeed: ProcessingSpeed
  ) => {
    if (backendPollIntervalRef.current) {
      clearInterval(backendPollIntervalRef.current);
      backendPollIntervalRef.current = null;
    }

    const pollInterval = setInterval(async () => {
      if (activeBackendJobIdRef.current !== currentJobId) {
        clearInterval(pollInterval);
        if (backendPollIntervalRef.current === pollInterval) {
          backendPollIntervalRef.current = null;
        }
        return;
      }

      try {
        const st = await getJobStatus(currentJobId);
        if (activeBackendJobIdRef.current !== currentJobId) {
          clearInterval(pollInterval);
          if (backendPollIntervalRef.current === pollInterval) {
            backendPollIntervalRef.current = null;
          }
          return;
        }
        consecutiveErrorsRef.current = 0;
        setIsPollingRetrying(false);
        setBackendJob(st);

        if (st.status === 'queued') {
          setAnalysisStage('queued');
        } else if (st.status === 'running') {
          if (st.progress?.stage === 'finalizing') {
            setAnalysisStage('finalizing');
          } else {
            setAnalysisStage('analyzing');
          }
          const curr = st.progress?.current_frame || 0;
          const now = Date.now();
          if (curr > lastFrameRef.current) {
            lastFrameRef.current = curr;
            lastProgressTimeRef.current = now;
            setIsProgressStalled(false);
          } else if (now - lastProgressTimeRef.current > 20000) {
            setIsProgressStalled(true);
          }

          const rawFps = st.progress?.processing_fps || 0;
          if (rawFps > 0) {
            smoothedFpsRef.current = smoothedFpsRef.current === 0
              ? rawFps
              : smoothedFpsRef.current * 0.7 + rawFps * 0.3;
          }
        } else if (st.status === 'completed') {
          clearInterval(pollInterval);
          if (backendPollIntervalRef.current === pollInterval) {
            backendPollIntervalRef.current = null;
          }
          clearActiveBackendJob();
          setAnalysisStage('finalizing');
          setIsProgressStalled(false);
          setIsPollingRetrying(false);

          let frames: BackendFrameResult[] = [];
          let artifactBlob: Blob | null = null;
          try {
            const { blob, json } = await fetchJobArtifactBlobAndJson(currentJobId);
            artifactBlob = blob;
            frames = json.frames || [];
          } catch {
            frames = await getAllJobResults(currentJobId);
          }

          if (activeBackendJobIdRef.current !== currentJobId) return;
          backendFramesRef.current = frames;
          setBackendFrames(frames);
          setRunState('COMPLETED');
          setAnalysisStage('completed');
          if (st.summary) {
            setLive({
              fps: Math.round(st.progress?.processing_fps || 30),
              latency: 0,
              frames: st.summary.processed_frames,
              droppedFrames: 0,
              detections: st.summary.processed_frames,
              created: 0,
              suppressed: 0,
              saved: 0,
              tracked: st.summary.unique_vehicles,
              queue: 0,
              resultAge: 0,
              renderedTracks: 0,
              staleDropped: 0,
              staleRejected: 0,
              workerErrors: 0,
              workerBusy: false
            });
          }

          // Persist to Supabase if Save to History is enabled
          if (st.save_to_history && st.video_id) {
            const vid = st.video_id;
            try {
              // 1. Download artifact blob from local backend (reuse if already downloaded)
              if (!artifactBlob) {
                artifactBlob = await downloadJobArtifactBlob(currentJobId);
              }

              // 2. Create analysis run
              const run = await db.analysisRuns.create({
                camera_id: null,
                video_id: vid,
                status: 'completed',
                started_at: st.created_at,
                ended_at: st.completed_at || new Date().toISOString(),
                fps: Math.round(st.progress?.processing_fps || 30),
                frames_processed: st.summary?.processed_frames || frames.length,
                detections_generated: st.summary?.processed_frames || frames.length,
                incidents_created: st.summary?.speed_violations_count || 0,
                incidents_suppressed: 0,
                metrics: {
                  schema_version: '1.0',
                  detection_profile: st.detection_profile || jobProfile,
                  confidence_threshold: st.confidence_threshold,
                  iou_threshold: st.iou_threshold,
                  processing_speed: st.processing_speed || jobSpeed,
                  frame_stride: st.frame_stride,
                  summary: st.summary
                }
              });

              // 3. Save artifact to Supabase Storage
              const { storagePath, bucket } = await saveArtifactToStorage(vid, run.id, artifactBlob);

              // 4. Update analysis_runs metrics with storage path
              await db.analysisRuns.update(run.id, {
                metrics: {
                  artifact_storage_path: storagePath,
                  artifact_bucket: bucket,
                  schema_version: '1.0',
                  detection_profile: st.detection_profile || jobProfile,
                  confidence_threshold: st.confidence_threshold,
                  iou_threshold: st.iou_threshold,
                  processing_speed: st.processing_speed || jobSpeed,
                  frame_stride: st.frame_stride,
                  summary: st.summary
                }
              }).catch(() => {});

              // Deduplicate & compile unique tracks from all processed frames
              const trackMap = new Map<number, {
                track_id: number;
                object_type: string;
                confidence: number;
                first_seen: number;
                last_seen: number;
                frame_count: number;
                trajectory: Array<{ time: number; bbox: [number, number, number, number]; speed?: number }>;
              }>();

              for (const frame of frames) {
                for (const t of frame.tracks) {
                  let entry = trackMap.get(t.track_id);
                  const tl_x = Math.round(t.x - t.w / 2);
                  const tl_y = Math.round(t.y - t.h / 2);
                  const bbox: [number, number, number, number] = [tl_x, tl_y, Math.round(t.w), Math.round(t.h)];
                  const pt = { time: frame.media_time, bbox, speed: t.speed ?? undefined };

                  if (!entry) {
                    entry = {
                      track_id: t.track_id,
                      object_type: t.class_name,
                      confidence: t.prob,
                      first_seen: frame.media_time,
                      last_seen: frame.media_time,
                      frame_count: 1,
                      trajectory: [pt]
                    };
                    trackMap.set(t.track_id, entry);
                  } else {
                    entry.frame_count++;
                    entry.last_seen = frame.media_time;
                    entry.confidence = Math.max(entry.confidence, t.prob);
                    const lastPt = entry.trajectory[entry.trajectory.length - 1];
                    if (!lastPt || frame.media_time - lastPt.time >= 0.25) {
                      entry.trajectory.push(pt);
                    }
                  }
                }
              }

              if (trackMap.size > 0) {
                const rows = Array.from(trackMap.values()).map(r => ({
                  video_id: vid,
                  camera_id: null,
                  analysis_run_id: run.id,
                  track_id: r.track_id,
                  object_type: r.object_type,
                  confidence: r.confidence,
                  first_seen_timestamp: r.first_seen,
                  last_seen_timestamp: r.last_seen,
                  frame_count: r.frame_count,
                  metadata: { trajectory: r.trajectory }
                }));

                const { error: upsertErr } = await supabase
                  .from('tracked_objects')
                  .upsert(rows, { onConflict: 'video_id,track_id' });
                if (upsertErr) {
                  console.warn('Backend tracking persistence failed:', upsertErr);
                }
              }

              // 5. Update video_assets ONLY AFTER artifact is persisted
              const { data: currentAsset } = await supabase.from('video_assets').select('metadata').eq('id', vid).maybeSingle();
              const existingMeta = (currentAsset?.metadata && typeof currentAsset.metadata === 'object' && !Array.isArray(currentAsset.metadata) ? currentAsset.metadata : {}) as Record<string, any>;
              await supabase.from('video_assets').update({
                processing_status: 'completed',
                duration: st.summary?.duration_seconds,
                metadata: {
                  ...existingMeta,
                  artifact_storage_path: storagePath,
                  artifact_bucket: bucket,
                  schema_version: '1.0',
                  detection_profile: st.detection_profile || jobProfile,
                  processing_speed: st.processing_speed || jobSpeed,
                  calibration: calibration && calibration.calibrationArea?.length === 4 ? calibration : (existingMeta.calibration ?? null),
                  summary: st.summary,
                  unique_vehicles: st.summary?.unique_vehicles || trackMap.size,
                  total_frames: st.summary?.total_frames || frames.length,
                  processed_frames: st.summary?.processed_frames || frames.length,
                  average_speed_kmh: st.summary?.average_speed_kmh ?? null,
                  speed_violations_count: st.summary?.speed_violations_count ?? 0
                }
              }).eq('id', vid);

              setSaved({ incidents: st.summary?.speed_violations_count || 0, tracks: trackMap.size, runs: 1 });
              analysisLogger.log({
                category: 'PERSISTENCE',
                message: `Persisted analysis artifact and ${trackMap.size} tracks to History for video "${displayName}"`
              });
            } catch (err) {
              console.warn('Failed to persist backend results to History:', err);
            }
          }

          analysisLogger.log({
            category: 'PROCESSING',
            message: `Backend analysis completed: ${frames.length} frames ready for synchronized playback.`
          });
          requestAnimationFrame(drawOverlay);
        } else if (st.status === 'failed') {
          clearInterval(pollInterval);
          if (backendPollIntervalRef.current === pollInterval) {
            backendPollIntervalRef.current = null;
          }
          clearActiveBackendJob();
          setRunState('STOPPED');
          setAnalysisStage('failed');
          setIsProgressStalled(false);
          setIsPollingRetrying(false);
          if (st.error) setError(`Backend analysis error: ${st.error}`);
        } else if (st.status === 'cancelled') {
          clearInterval(pollInterval);
          if (backendPollIntervalRef.current === pollInterval) {
            backendPollIntervalRef.current = null;
          }
          clearActiveBackendJob();
          setRunState('STOPPED');
          setAnalysisStage('cancelled');
          setIsProgressStalled(false);
          setIsPollingRetrying(false);
        }
      } catch (e) {
        console.warn('Poll backend job error:', e);
        if (activeBackendJobIdRef.current !== currentJobId) {
          clearInterval(pollInterval);
          return;
        }
        consecutiveErrorsRef.current += 1;
        if (consecutiveErrorsRef.current <= 5) {
          setIsPollingRetrying(true);
        } else {
          clearInterval(pollInterval);
          if (backendPollIntervalRef.current === pollInterval) {
            backendPollIntervalRef.current = null;
          }
          clearActiveBackendJob();
          setIsPollingRetrying(false);
          setRunState('STOPPED');
          setAnalysisStage('failed');
          setError('Lost connection to backend service while polling progress.');
        }
      }
    }, 500);

    backendPollIntervalRef.current = pollInterval;
  };

  const runBackendJob = async (
    fileOrUrl: File | string,
    displayName: string,
    saveHistory: boolean,
    targetVideoId?: string
  ) => {
    if (backendJob?.status === 'running' || backendJob?.status === 'queued') {
      return;
    }
    isSubmittingJobRef.current = true;
    setIsSubmittingJob(true);

    if (backendPollIntervalRef.current) {
      clearInterval(backendPollIntervalRef.current);
      backendPollIntervalRef.current = null;
    }

    setRunState('STARTING');
    setError(null);
    setAnalysisStage('preparing');
    setIsPollingRetrying(false);
    setIsProgressStalled(false);
    smoothedFpsRef.current = 0;
    lastFrameRef.current = 0;
    lastProgressTimeRef.current = Date.now();
    consecutiveErrorsRef.current = 0;

    // Snapshot parameters locked to this job instance
    const jobProfile = detectionProfile;
    const jobSpeed = processingSpeed;
    const activeCal = calibration && calibration.calibrationArea?.length === 4 ? calibration : null;

    try {
      const { job_id, status } = await createAnalysisJob(
        fileOrUrl,
        saveHistory,
        targetVideoId,
        jobProfile,
        jobSpeed,
        activeCal
      );
      activeBackendJobIdRef.current = job_id;
      setBackendJob({
        job_id,
        status,
        save_to_history: saveHistory,
        video_id: targetVideoId,
        created_at: new Date().toISOString(),
        detection_profile: jobProfile,
        confidence_threshold: DETECTION_PROFILES[jobProfile].confidenceThreshold,
        iou_threshold: DETECTION_PROFILES[jobProfile].iouThreshold,
        processing_speed: jobSpeed,
        frame_stride: PROCESSING_SPEEDS[jobSpeed].frameStride,
        is_calibrated: Boolean(activeCal)
      });
      setAnalysisStage(status === 'running' ? 'analyzing' : 'queued');
      setRunState('ANALYZING');

      // Persist active job state for reconnection across navigation
      setActiveBackendJob({
        jobId: job_id,
        videoId: targetVideoId || (activeSourceRef.current?.id ?? ''),
        detectionProfile: jobProfile,
        processingSpeed: jobSpeed,
        status: status === 'running' ? 'running' : 'queued',
        displayName,
        saveHistory,
        startedAt: Date.now()
      });

      startPollingJob(job_id, displayName, jobProfile, jobSpeed);
    } catch (err) {
      setRunState('NONE');
      setAnalysisStage('failed');
      setError(`Failed to create backend analysis job: ${describeError(err)}`);
    } finally {
      isSubmittingJobRef.current = false;
      setIsSubmittingJob(false);
    }
  };

  // Reconnect to active background job upon navigation or page reload
  useEffect(() => {
    const active = getActiveBackendJob();
    if (!active) return;

    void (async () => {
      try {
        const st = await getJobStatus(active.jobId);
        if (st.status === 'queued' || st.status === 'running') {
          activeBackendJobIdRef.current = active.jobId;
          setDetectionProfile(active.detectionProfile);
          setProcessingSpeed(active.processingSpeed);
          setBackendJob(st);
          setAnalysisStage(st.status === 'running' ? 'analyzing' : 'queued');
          setRunState('ANALYZING');
          if (active.videoId && !activeSourceRef.current) {
            liveAnalysisSession.selectVideo(active.videoId);
          }
          startPollingJob(active.jobId, active.displayName || active.sourceName || 'Video', active.detectionProfile, active.processingSpeed);
        } else if (st.status === 'completed') {
          clearActiveBackendJob();
          if (active.videoId && !activeSourceRef.current) {
            liveAnalysisSession.selectVideo(active.videoId);
          }
          const frames = await getAllJobResults(active.jobId);
          backendFramesRef.current = frames;
          setBackendFrames(frames);
          setRunState('COMPLETED');
          setAnalysisStage('completed');
          setBackendJob(st);
          requestAnimationFrame(drawOverlay);
        } else {
          clearActiveBackendJob();
        }
      } catch (err) {
        console.warn('Could not reconnect to persisted backend job:', err);
        clearActiveBackendJob();
      }
    })();
  }, []);

  const startBackendAnalysis = async () => {
    if (isSubmittingJobRef.current || backendJob?.status === 'running' || backendJob?.status === 'queued') {
      return;
    }
    const source = activeSourceRef.current;
    const video = videoRef.current;
    if (!source || !video) return;
    const videoSrc = video.src || localVideoUrlRef.current;
    if (!videoSrc) {
      setError('No playable video source available.');
      return;
    }

    const health = await checkBackendHealth();
    setBackendAvailable(health.isAvailable);
    setBackendHealth(health.health || null);

    if (!health.isAvailable) {
      if (modelStatus !== 'error') {
        setAnalysisEngine('browser');
        analysisLogger.log({
          category: 'SYSTEM',
          message: 'Local AI backend on port 8000 is offline. Automatically falling back to Browser WebGPU mode for this session.'
        });
        void startInference();
        return;
      }
      setError('Local AI backend is offline at http://127.0.0.1:8000. Start it with Start-VisionGuard.bat or switch to Browser WebGPU mode.');
      return;
    }

    const isSaved = !source.isLocalOnly;
    const targetVideoId = isSaved ? source.id : undefined;
    analysisLogger.log({
      category: 'SYSTEM',
      message: `Submitted "${source.name}" to Local Backend (${DETECTION_PROFILES[detectionProfile].label} profile, ${PROCESSING_SPEEDS[processingSpeed].label}).`
    });
    await runBackendJob(videoSrc, source.name, isSaved, targetVideoId);
  };

  // Upload: show the selection immediately, create the asset row, then select it via the URL
  // (the selection effect plays the local copy while uploadManager uploads in the background).
  const handleFile = async (file: File) => {
    if (isSubmittingJobRef.current || (pendingFile && !pendingFile.error)) {
      return;
    }
    setCalibration(null);
    setCalibrationPoints([]);
    setIsCalibrating(false);
    const selectedAt = new Date().toISOString();
    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      const msg = `"${file.name}" is not a supported video file (type: ${file.type || 'unknown'}). Select an MP4, WebM or MOV file.`;
      console.warn('Upload validation failed:', msg);
      setPendingFile({ name: file.name, size: file.size, error: msg });
      setError(msg);
      return;
    }

    let engine = analysisEngine;
    if (engine === 'backend') {
      let isAvailable = backendAvailable;
      if (!isAvailable) {
        const health = await checkBackendHealth();
        setBackendAvailable(health.isAvailable);
        setBackendHealth(health.health || null);
        isAvailable = health.isAvailable;
      }

      if (!isAvailable) {
        if (modelStatus !== 'error') {
          engine = 'browser';
          setAnalysisEngine('browser');
          analysisLogger.log({
            category: 'SYSTEM',
            message: 'Local AI backend on port 8000 is offline. Switched to Browser WebGPU mode for this session.'
          });
        } else {
          const msg = 'Local AI backend is offline at http://127.0.0.1:8000. Start it with Start-VisionGuard.bat or switch to Browser WebGPU mode.';
          setError(msg);
          return;
        }
      }
    }

    if (engine === 'backend') {

      isSubmittingJobRef.current = true;
      setIsSubmittingJob(true);

      try {
        if (localVideoUrlRef.current) {
          URL.revokeObjectURL(localVideoUrlRef.current);
          localVideoUrlRef.current = null;
        }
        liveAnalysisSession.clearVideo();
        const localUrl = URL.createObjectURL(file);
        localVideoUrlRef.current = localUrl;

        let targetVideoId: string | undefined = undefined;
        if (saveToHistory) {
          setPendingFile({ name: file.name, size: file.size, error: null });
          try {
            const { videoId } = await uploadManager.startUpload(file, selectedAt);
            targetVideoId = videoId;
            setPendingFile(null);
          } catch (err) {
            console.error('Upload could not start:', err);
          }
        }

        const source: SourceContext = {
          kind: 'video',
          id: targetVideoId || `local-${Date.now()}`,
          name: file.name,
          location: null,
          isLocalOnly: !saveToHistory
        };
        activeSourceRef.current = source;
        setSourceInfo(source);
        setError(null);
        setPendingFile(null);
        setCurrentUpload(null);
        setSaved(null);
        setContentNote(null);
        setRunState('STARTING');
        setSourceState('SOURCE_LOADING');
        setPlaybackState('loading_source');
        attachMedia(localUrl, false);
        if (targetVideoId) {
          liveAnalysisSession.selectVideo(targetVideoId);
        }
        analysisLogger.log({
          category: 'SYSTEM',
          message: `Submitted "${file.name}" (${formatMb(file.size)}) to Local Backend (${DETECTION_PROFILES[detectionProfile].label} profile: ${DETECTION_PROFILES[detectionProfile].confidenceThreshold} conf • ${DETECTION_PROFILES[detectionProfile].iouThreshold} IoU, ${PROCESSING_SPEEDS[processingSpeed].label}: stride ${PROCESSING_SPEEDS[processingSpeed].frameStride}).`
        });

        await runBackendJob(file, file.name, saveToHistory, targetVideoId);
      } finally {
        isSubmittingJobRef.current = false;
        setIsSubmittingJob(false);
      }
      return;
    }

    if (!saveToHistory) {
      if (localVideoUrlRef.current) {
        URL.revokeObjectURL(localVideoUrlRef.current);
        localVideoUrlRef.current = null;
      }
      liveAnalysisSession.clearVideo();
      const localUrl = URL.createObjectURL(file);
      localVideoUrlRef.current = localUrl;
      const source: SourceContext = {
        kind: 'video',
        id: `local-${Date.now()}`,
        name: file.name,
        location: null,
        isLocalOnly: true
      };
      activeSourceRef.current = source;
      setSourceInfo(source);
      setError(null);
      setPendingFile(null);
      setCurrentUpload(null);
      setSaved(null);
      setContentNote(null);
      setRunState('NONE');
      setSourceState('SOURCE_LOADING');
      setPlaybackState('loading_source');
      attachMedia(localUrl, false);
      analysisLogger.log({
        category: 'SYSTEM',
        message: `Opened local video "${file.name}" (${formatMb(file.size)}) in temporary mode (not saved to History)`
      });
      return;
    }

    if (localVideoUrlRef.current) {
      URL.revokeObjectURL(localVideoUrlRef.current);
      localVideoUrlRef.current = null;
    }
    const localUrl = URL.createObjectURL(file);
    localVideoUrlRef.current = localUrl;
    setPendingFile({ name: file.name, size: file.size, error: null });
    setError(null);
    try {
      const { videoId } = await uploadManager.startUpload(file, selectedAt);
      setPendingFile(null);
      const source: SourceContext = {
        kind: 'video',
        id: videoId,
        name: file.name,
        location: null,
        isLocalOnly: false
      };
      activeSourceRef.current = source;
      setSourceInfo(source);
      setError(null);
      setCurrentUpload(null);
      setSaved(null);
      setContentNote(null);
      setRunState('NONE');
      setSourceState('SOURCE_LOADING');
      setPlaybackState('loading_source');
      attachMedia(localUrl, false);
      liveAnalysisSession.selectVideo(videoId);
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
    if (file && !isSubmittingJobRef.current) {
      setStagedFile(file);
      setIsUploadModalOpen(true);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (isSubmittingJobRef.current) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setStagedFile(file);
      setIsUploadModalOpen(true);
    }
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  const clearActiveVideo = () => {
    detachMedia();
    if (localVideoUrlRef.current) {
      URL.revokeObjectURL(localVideoUrlRef.current);
      localVideoUrlRef.current = null;
    }
    const prev = liveAnalysisSession.get();
    if (prev.videoId) {
      analysisLogger.log({ video_id: prev.videoId, category: 'SYSTEM', message: 'Active video cleared from Live Analysis (the asset remains in History)' });
      liveAnalysisSession.clearVideo(); // selection effect cleanup stops any active run and resets the player
      uploadManager.releasePreview(prev.videoId);
    }
    activeSourceRef.current = null;
    setSourceInfo(null);
    setSourceState('IDLE');
    setPendingFile(null);
    setCurrentUpload(null);
    setCalibration(null);
    setIsCalibrating(false);
    setCalibrationPoints([]);
    clearOverlayCanvas();
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tagName = target.tagName ? target.tagName.toUpperCase() : '';
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || tagName === 'BUTTON' || target.isContentEditable) {
          return;
        }
      }
      const video = videoRef.current;
      if (!video || !sourceInfo) return;

      if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
        e.preventDefault();
        if (video.paused) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 2);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 2);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sourceInfo]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isUploadModalOpen) {
        setIsUploadModalOpen(false);
        setStagedFile(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isUploadModalOpen]);

  // -------------------------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------------------------
  const isJobActive = isSubmittingJob ||
    analysisStage === 'preparing' ||
    analysisStage === 'queued' ||
    analysisStage === 'analyzing' ||
    analysisStage === 'finalizing' ||
    backendJob?.status === 'running' ||
    backendJob?.status === 'queued';

  const totalFrames = backendJob?.progress?.total_frames || 0;
  const currentFrame = backendJob?.progress?.current_frame || 0;
  const percentage = Number(backendJob?.progress?.percentage ?? (totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 0));
  const fps = smoothedFpsRef.current || Number(backendJob?.progress?.processing_fps || 0);

  const canStart = (sourceState === 'SOURCE_READY' || playbackState === 'ready' || playbackState === 'playing') &&
    (analysisEngine === 'backend' ? (backendAvailable || modelStatus !== 'error') : modelStatus === 'ready') &&
    (runState === 'NONE' || runState === 'STOPPED' || runState === 'COMPLETED') &&
    !isJobActive;

  return (
    <div className="flex-1 p-5 md:p-6 overflow-y-auto bg-slate-50 min-h-screen">
      <div className="max-w-[1600px] mx-auto space-y-4">
        {/* Compact Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Live Analysis</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Analyze traffic footage, track vehicles, and inspect detected events.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            {/* Primary Action in Header: Prominent Upload Video with icon and readable text */}
            <button
              id="analyze-upload-video-btn"
              type="button"
              onClick={() => setIsUploadModalOpen(true)}
              disabled={isSubmittingJob || (!!pendingFile && !pendingFile.error)}
              className="inline-flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 active:scale-[0.99] text-white px-3.5 py-1.5 rounded-md font-semibold shadow-xs transition-colors text-xs cursor-pointer shrink-0"
            >
              {isSubmittingJob || (pendingFile && !pendingFile.error) ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : (
                <Upload className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>Upload Video</span>
            </button>

            {/* Analysis Engine Selector */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded-md border border-slate-200 text-xs shrink-0">
              <button
                type="button"
                onClick={() => selectAnalysisEngine('browser')}
                disabled={isSubmittingJob || backendJob?.status === 'running' || backendJob?.status === 'queued' || runState === 'ANALYZING' || runState === 'STARTING'}
                className={`px-2 py-1 rounded font-medium transition-colors cursor-pointer text-[11px] ${
                  analysisEngine === 'browser'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-500 hover:text-slate-700 disabled:opacity-50'
                }`}
                title="Process in-browser with ONNX Runtime Web (WebGPU/WASM)"
              >
                Browser WebGPU
              </button>
              <button
                type="button"
                onClick={() => selectAnalysisEngine('backend')}
                disabled={isSubmittingJob || backendJob?.status === 'running' || backendJob?.status === 'queued' || runState === 'ANALYZING' || runState === 'STARTING'}
                className={`px-2 py-1 rounded font-medium transition-colors cursor-pointer text-[11px] ${
                  analysisEngine === 'backend'
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-500 hover:text-slate-700 disabled:opacity-50'
                }`}
                title={backendAvailable ? "Local DirectML/CPU Backend" : "Local Backend (Offline)"}
              >
                Local Backend
              </button>
            </div>

            {/* Speed Calibration Button */}
            <div className="flex items-center">
              <button
                id="analyze-calibrate-btn"
                type="button"
                onClick={() => {
                  const video = videoRef.current;
                  if (video && !video.paused) {
                    video.pause();
                  }
                  if (calibration && calibration.calibrationArea?.length === 4) {
                    setCalibrationPoints(calibration.calibrationArea);
                    setRefWidth(calibration.referenceWidth || 3.5);
                    setRefHeight(calibration.referenceHeight || 15.0);
                    setCalSpeedLimit(calibration.speedLimit || 60);
                  } else {
                    setCalibrationPoints([]);
                  }
                  setIsCalibrating(true);
                }}
                disabled={!sourceInfo || isSubmittingJob || backendJob?.status === 'running' || backendJob?.status === 'queued'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  calibration && calibration.calibrationArea?.length === 4
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
                title={
                  calibration && calibration.calibrationArea?.length === 4
                    ? `Speed Calibrated (${calibration.referenceWidth}m × ${calibration.referenceHeight}m). Click to edit.`
                    : 'Calibrate vehicle speed estimation using 4 road ground-plane points'
                }
              >
                <Gauge className={`w-3.5 h-3.5 ${calibration && calibration.calibrationArea?.length === 4 ? 'text-emerald-600' : 'text-indigo-600'}`} />
                <span>
                  {calibration && calibration.calibrationArea?.length === 4
                    ? `Calibrated (${calibration.referenceWidth}m × ${calibration.referenceHeight}m)`
                    : 'Calibrate Speed'}
                </span>
              </button>
            </div>
          </div>

          <input
            id="analyze-file-input"
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/*"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>

        {/* Upload Notifications */}
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
                ? `${formatMb(currentUpload.bytesUploaded)} of ${formatMb(currentUpload.fileSize)} sent to ${currentUpload.providerLabel}${currentUpload.bytesPerSecond ? ` · ${formatMb(currentUpload.bytesPerSecond)}/s` : ''}${currentUpload.etaSeconds !== null ? ` · about ${formatDuration(currentUpload.etaSeconds)} left` : ''} — playing local copy meanwhile.`
                : currentUpload.status === 'uploaded'
                  ? `Stored in ${currentUpload.providerLabel}: ${currentUpload.storagePath ?? ''}`
                  : `Upload failed: ${currentUpload.error ?? 'unknown error'}`
            }
            progress={currentUpload.status === 'uploading' ? currentUpload.progress : null}
          />
        )}

        {/* System & Model Alerts */}
        {modelError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-md text-xs flex items-center gap-2" id="analyze-model-error">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
            <span>AI model unavailable: {modelError}</span>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-md text-xs flex items-center justify-between" id="analyze-error">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-4">✕</button>
          </div>
        )}
        {saveError && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3.5 py-2.5 rounded-md text-xs flex items-center gap-2" id="analyze-save-error">
            <Clock className="w-4 h-4 shrink-0 text-amber-600" />
            <span>Detections active, but persistence failed: {saveError}</span>
          </div>
        )}

        {/* Actionable Local Backend Offline Banner */}
        {analysisEngine === 'backend' && !backendAvailable && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 px-4 py-3 rounded-lg text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs" id="analyze-backend-offline-banner">
            <div className="flex items-start sm:items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5 sm:mt-0" />
              <div>
                <span className="font-semibold text-amber-950">Local AI Backend is Offline (http://127.0.0.1:8000).</span>
                <span className="text-amber-800 ml-1">
                  Run <code className="bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded font-mono text-[11px]">Start-VisionGuard.bat</code> to launch local DirectML/CPU acceleration, or switch to{' '}
                  <button
                    type="button"
                    onClick={() => selectAnalysisEngine('browser')}
                    className="underline font-bold text-amber-950 hover:text-indigo-700 cursor-pointer"
                  >
                    Browser WebGPU Mode
                  </button>.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  const res = await checkBackendHealth();
                  setBackendAvailable(res.isAvailable);
                  setBackendHealth(res.health || null);
                }}
                className="inline-flex items-center gap-1.5 bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 px-3 py-1.5 rounded-md text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Retry Connection</span>
              </button>
              <button
                type="button"
                onClick={() => selectAnalysisEngine('browser')}
                className="inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-md text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
              >
                <span>Use WebGPU</span>
              </button>
            </div>
          </div>
        )}

        {/* Main Analysis Workspace: Video Viewport and Playback Controls */}
        <div className="w-full flex flex-col gap-2">
            <div
              ref={containerRef}
              className={`bg-slate-950 flex items-center justify-center overflow-hidden border border-slate-800 shadow-xs transition-all ${
                isFullscreen
                  ? 'fixed inset-0 z-[100] w-full h-full'
                  : 'relative rounded-lg aspect-video max-h-[58vh] min-h-[300px] w-full'
              }`}
              onDragOver={e => e.preventDefault()}
              onDrop={handleDrop}
            >


              {/* Permanent Video Element and Overlay Canvas */}
              <div className={`relative inline-flex items-center justify-center max-w-full max-h-full ${isFullscreen ? 'w-full h-full' : ''} ${!sourceInfo ? 'hidden' : ''}`}>
                <video
                  id="analyze-video"
                  ref={videoRef}
                  src={mediaUrl || undefined}
                  playsInline
                  crossOrigin="anonymous"
                  muted
                  preload="auto"
                  onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    if (video.paused) {
                      video.play().catch(e => setError(`Playback could not start: ${describeError(e)}`));
                    } else {
                      video.pause();
                    }
                  }}
                  onLoadStart={onLoadStart}
                  onLoadedMetadata={onLoadedMetadata}
                  onLoadedData={onLoadedData}
                  onCanPlay={onCanPlay}
                  onPlay={onPlay}
                  onPause={onPause}
                  onSeeking={onSeeking}
                  onSeeked={onSeeked}
                  onEnded={onEnded}
                  onEmptied={onEmptied}
                  onError={onMediaError}
                  onTimeUpdate={(e) => setPlaybackTime({ current: e.currentTarget.currentTime, duration: e.currentTarget.duration || 0 })}
                  className={`max-w-full max-h-full z-10 cursor-pointer ${isFullscreen ? 'object-cover w-full h-full' : 'object-contain'}`}
                />
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full pointer-events-none z-20"
                />
              </div>

              {sourceInfo && (
                <>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="absolute top-3 right-3 z-40 p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-md backdrop-blur-xs border border-white/10 transition-colors cursor-pointer"
                    title="Toggle Fullscreen"
                  >
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                  </button>

                  {isOverlayDelayed && (
                    <div className="absolute top-3 left-3 z-40 rounded-md border border-amber-500/30 bg-slate-950/90 px-2.5 py-1 text-[11px] font-medium text-amber-300 shadow-xs backdrop-blur-xs flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span>AI overlay delayed</span>
                    </div>
                  )}
                </>
              )}

              {/* Interactive Speed Calibration Overlay */}
              {isCalibrating && sourceInfo && (
                <div
                  className="absolute inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex flex-col justify-between p-3 select-none cursor-crosshair"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('#calibration-controls-card') || (e.target as HTMLElement).closest('#calibration-header-card')) {
                      return;
                    }
                    const video = videoRef.current;
                    if (!video || !video.videoWidth || !video.videoHeight) return;
                    const rect = video.getBoundingClientRect();
                    const clickX = e.clientX;
                    const clickY = e.clientY;
                    const isCover = isFullscreen;
                    const transform = computeVideoTransform(
                      { videoWidth: video.videoWidth, videoHeight: video.videoHeight },
                      { containerWidth: rect.width, containerHeight: rect.height },
                      isCover ? 'cover' : 'contain'
                    );
                    const imgX = clickX - rect.left - transform.offsetX;
                    const imgY = clickY - rect.top - transform.offsetY;
                    if (imgX < 0 || imgX > transform.renderWidth || imgY < 0 || imgY > transform.renderHeight) {
                      return; // Ignored letterbox/pillarbox margin click
                    }
                    if (calibrationPoints.length >= 4) {
                      return;
                    }
                    const normX = Math.max(0, Math.min(1, imgX / transform.renderWidth));
                    const normY = Math.max(0, Math.min(1, imgY / transform.renderHeight));
                    setCalibrationPoints(prev => [
                      ...prev,
                      { x: Number(normX.toFixed(4)), y: Number(normY.toFixed(4)) }
                    ]);
                  }}
                >
                  {/* Top Header / Instructions */}
                  <div id="calibration-header-card" className="flex items-center justify-between bg-slate-900/90 border border-slate-700/80 px-3.5 py-2 rounded-lg text-white shadow-lg pointer-events-auto">
                    <div className="flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-indigo-400" />
                      <span className="font-semibold text-xs">Road Speed Calibration</span>
                      <span className="text-slate-400 text-xs">·</span>
                      <span className="text-xs text-indigo-300 font-medium">
                        {calibrationPoints.length === 0 && 'Click Point 1: Top-Left (far left road corner)'}
                        {calibrationPoints.length === 1 && 'Click Point 2: Top-Right (far right road corner)'}
                        {calibrationPoints.length === 2 && 'Click Point 3: Bottom-Right (near right road corner)'}
                        {calibrationPoints.length === 3 && 'Click Point 4: Bottom-Left (near left road corner)'}
                        {calibrationPoints.length >= 4 && '✓ 4 points placed. Adjust reference dimensions below and save.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsCalibrating(false)}
                      className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Close calibration overlay"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* SVG Overlay for Quadrilateral Polygon & Corner Markers */}
                  <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    {(() => {
                      const video = videoRef.current;
                      if (!video || !video.videoWidth || !video.videoHeight) return null;
                      const parentRect = containerRef.current?.getBoundingClientRect();
                      const vidRect = video.getBoundingClientRect();
                      if (!parentRect) return null;

                      const isCover = isFullscreen;
                      const transform = computeVideoTransform(
                        { videoWidth: video.videoWidth, videoHeight: video.videoHeight },
                        { containerWidth: vidRect.width, containerHeight: vidRect.height },
                        isCover ? 'cover' : 'contain'
                      );

                      const leftOffset = vidRect.left - parentRect.left + transform.offsetX;
                      const topOffset = vidRect.top - parentRect.top + transform.offsetY;

                      const pts = calibrationPoints.map(p => ({
                        x: leftOffset + p.x * transform.renderWidth,
                        y: topOffset + p.y * transform.renderHeight
                      }));

                      const pointLabels = ['1: Top-Left', '2: Top-Right', '3: Bottom-Right', '4: Bottom-Left'];

                      return (
                        <svg className="w-full h-full absolute inset-0">
                          {pts.length >= 2 && (
                            <polygon
                              points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                              fill={pts.length === 4 ? 'rgba(99, 102, 241, 0.25)' : 'none'}
                              stroke="#6366f1"
                              strokeWidth="2"
                              strokeDasharray={pts.length === 4 ? 'none' : '4 4'}
                            />
                          )}
                          {pts.map((p, i) => (
                            <g key={i}>
                              <circle cx={p.x} cy={p.y} r="7" fill="#4f46e5" stroke="#ffffff" strokeWidth="2" />
                              <text
                                x={p.x}
                                y={p.y - 10}
                                fill="#ffffff"
                                fontSize="11"
                                fontWeight="bold"
                                textAnchor="middle"
                                className="drop-shadow-md select-none font-sans"
                              >
                                {pointLabels[i]}
                              </text>
                            </g>
                          ))}
                        </svg>
                      );
                    })()}
                  </div>

                  {/* Bottom Control Bar */}
                  <div
                    id="calibration-controls-card"
                    className="bg-slate-900/95 border border-slate-700/80 px-3.5 py-2.5 rounded-lg text-white shadow-2xl flex flex-wrap items-center justify-between gap-2.5 pointer-events-auto"
                  >
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <div className="flex items-center gap-1.5">
                        <label className="text-slate-300 font-medium">Road Width:</label>
                        <input
                          type="number"
                          min="1.0"
                          max="50.0"
                          step="0.5"
                          value={refWidth}
                          onChange={e => setRefWidth(Math.max(0.5, parseFloat(e.target.value) || 3.5))}
                          className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-slate-400">meters</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-slate-300 font-medium">Segment Length:</label>
                        <input
                          type="number"
                          min="2.0"
                          max="200.0"
                          step="1.0"
                          value={refHeight}
                          onChange={e => setRefHeight(Math.max(1.0, parseFloat(e.target.value) || 15.0))}
                          className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-slate-400">meters</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <label className="text-slate-300 font-medium">Speed Limit:</label>
                        <input
                          type="number"
                          min="10"
                          max="150"
                          step="5"
                          value={calSpeedLimit}
                          onChange={e => setCalSpeedLimit(Math.max(10, parseInt(e.target.value) || 60))}
                          className="w-14 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                        />
                        <span className="text-slate-400">km/h</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCalibrationPoints([
                            { x: 0.35, y: 0.38 },
                            { x: 0.65, y: 0.38 },
                            { x: 0.85, y: 0.88 },
                            { x: 0.15, y: 0.88 }
                          ]);
                        }}
                        className="px-2.5 py-1 text-xs text-indigo-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-indigo-700/50 rounded font-medium transition-colors cursor-pointer"
                        title="Set standard highway/lane trapezoid preset"
                      >
                        Road Preset
                      </button>
                      <button
                        type="button"
                        onClick={() => setCalibrationPoints([])}
                        className="px-2.5 py-1 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded font-medium transition-colors cursor-pointer"
                      >
                        Reset
                      </button>
                      {calibration && (
                        <button
                          type="button"
                          onClick={() => void clearCalibration()}
                          className="px-2.5 py-1 text-xs text-rose-300 hover:text-rose-100 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 rounded font-medium transition-colors cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={calibrationPoints.length !== 4 || refWidth <= 0 || refHeight <= 0}
                        onClick={() => {
                          void saveCalibration({
                            referenceWidth: refWidth,
                            referenceHeight: refHeight,
                            speedLimit: calSpeedLimit,
                            tolerance: calTolerance,
                            calibrationArea: calibrationPoints
                          });
                        }}
                        className="px-3 py-1 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed rounded shadow-xs transition-colors cursor-pointer"
                      >
                        Save Calibration
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Single Unified Analysis Progress Overlay */}
              {isJobActive && (
                <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-[2px] flex flex-col items-center justify-center p-4 text-center z-30">
                  <div className="flex flex-col items-center justify-center text-center max-w-sm w-full px-5 py-4 rounded-xl bg-slate-900/90 border border-slate-700/60 shadow-2xl">
                    <div className="flex items-center gap-2 mb-1">
                      <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
                      <h3 className="text-sm font-semibold text-white tracking-tight">
                        {analysisStage === 'preparing'
                          ? 'Preparing video for analysis…'
                          : analysisStage === 'queued'
                            ? 'Queued for analysis'
                            : analysisStage === 'finalizing'
                              ? 'Finalizing results…'
                              : 'Analyzing traffic video'}
                      </h3>
                    </div>

                    <p className="text-xs text-slate-300 font-medium truncate max-w-[260px] mb-2" title={sourceInfo?.name || 'Video'}>
                      {sourceInfo?.name || 'traffic-video.mp4'}
                    </p>

                    {analysisStage === 'queued' ? (
                      <p className="text-[11px] text-slate-400 mb-3">
                        Waiting for backend worker…
                      </p>
                    ) : analysisStage === 'finalizing' ? (
                      <p className="text-[11px] text-slate-400 mb-3">
                        Compiling vehicle tracks and saving metadata…
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-300 mb-2 font-mono">
                        {totalFrames > 0
                          ? `Frame ${currentFrame.toLocaleString()} of ${totalFrames.toLocaleString()} · ${percentage.toFixed(1)}% complete`
                          : 'Initializing video decoder & model…'}
                      </p>
                    )}

                    <div className="w-full bg-slate-800 rounded-full h-1.5 mb-2.5 overflow-hidden border border-slate-700/80">
                      <div
                        className={`bg-indigo-500 h-full transition-all duration-300 ${
                          analysisStage === 'queued' || (analysisStage === 'analyzing' && totalFrames === 0)
                            ? 'w-1/3 animate-pulse'
                            : ''
                        }`}
                        style={{
                          width:
                            analysisStage === 'queued' || (analysisStage === 'analyzing' && totalFrames === 0)
                              ? undefined
                              : `${Math.min(100, Math.max(0, percentage))}%`
                        }}
                      />
                    </div>

                    <div className="min-h-[16px] mb-3 text-[11px]">
                      {isPollingRetrying ? (
                        <span className="text-amber-400 flex items-center justify-center gap-1 font-medium">
                          <RotateCcw className="w-3 h-3 animate-spin" />
                          <span>Reconnecting to backend…</span>
                        </span>
                      ) : isProgressStalled ? (
                        <span className="text-amber-300 font-medium">
                          Analysis taking longer than usual · Backend is still processing
                        </span>
                      ) : analysisStage === 'analyzing' && currentFrame >= 10 && fps > 0.5 && totalFrames > currentFrame ? (
                        <span className="text-slate-400 font-mono">
                          {fps.toFixed(1)} FPS · Estimated time remaining: {formatRemainingTime((totalFrames - currentFrame) / fps)}
                        </span>
                      ) : analysisStage === 'analyzing' && currentFrame > 0 ? (
                        <span className="text-slate-400 font-mono">
                          {fps > 0 ? `${fps.toFixed(1)} FPS` : 'Processing…'}
                        </span>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => void cancelCurrentBackendJob()}
                      className="text-xs text-slate-300 hover:text-white bg-slate-800/80 hover:bg-rose-950/60 border border-slate-700 hover:border-rose-700/60 px-3 py-1 rounded-md transition-colors cursor-pointer"
                    >
                      Cancel Analysis
                    </button>
                  </div>
                </div>
              )}

              {/* Minimal Empty State */}
              {!sourceInfo && !isJobActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 select-none z-20 pointer-events-none">
                  <h2 className="text-2xl font-semibold text-white tracking-tight">No video loaded</h2>
                  <p className="text-base text-slate-400 mt-2">Upload a traffic video to start analysis.</p>
                </div>
              )}

              {/* Video Loading Spinner: only when loading video and not running an active job */}
              {sourceInfo && (playbackState === 'loading_source' || playbackState === 'loading_metadata' || sourceState === 'SOURCE_LOADING') && !isJobActive && playbackState !== 'error' && sourceState !== 'SOURCE_ERROR' && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/80">
                  <div className="flex items-center gap-2.5 text-slate-200 text-xs font-medium">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    <span>Loading {sourceInfo.name}…</span>
                  </div>
                </div>
              )}

              {/* Playback & Source Error Card */}
              {(playbackState === 'error' || sourceState === 'SOURCE_ERROR') && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 p-6">
                  <div className="bg-slate-900 border border-rose-900/60 p-5 rounded-lg max-w-sm w-full text-center shadow-xl">
                    <AlertTriangle className="w-6 h-6 text-rose-400 mx-auto mb-2" />
                    <h3 className="text-white font-semibold text-sm mb-1">Unable to load video</h3>
                    <p className="text-slate-300 text-xs mb-4">{playbackError || sourceError || 'Playback could not start. Check the video source or reconnect to storage.'}</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => void retryPlayback()}
                        className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-md text-xs font-medium cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Retry Playback</span>
                      </button>
                      <button
                        type="button"
                        onClick={clearActiveVideo}
                        className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-md text-xs font-medium cursor-pointer"
                      >
                        Reset Video
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Speed Calibration Notice Banner when uncalibrated */}
            {sourceInfo && (!calibration || calibration.calibrationArea?.length !== 4) && (
              <div className="bg-amber-50 border border-amber-200/90 rounded-lg px-3.5 py-2 flex items-center justify-between gap-3 text-xs text-amber-900 shadow-2xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Gauge className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="truncate">
                    <span className="font-semibold">Speed uncalibrated:</span> Real-world km/h speed measurements require 4 ground-plane road calibration points.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const video = videoRef.current;
                    if (video && !video.paused) {
                      video.pause();
                    }
                    if (calibration && calibration.calibrationArea?.length === 4) {
                      setCalibrationPoints(calibration.calibrationArea);
                      setRefWidth(calibration.referenceWidth || 3.5);
                      setRefHeight(calibration.referenceHeight || 15.0);
                      setCalSpeedLimit(calibration.speedLimit || 60);
                    } else {
                      setCalibrationPoints([]);
                    }
                    setIsCalibrating(true);
                  }}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] rounded transition-colors cursor-pointer shrink-0"
                >
                  Calibrate Speed
                </button>
              </div>
            )}

            {/* Playback Toolbar */}
            <div className="bg-white border border-slate-200 rounded-lg px-3.5 py-2 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 text-xs shadow-xs min-h-[46px]" id="analyze-controls">
              {sourceInfo ? (
                <>
                  {/* Left: Video Play/Pause Toggle, Current / Duration Time, Interactive Seek Bar */}
                  <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                    <button
                      type="button"
                      onClick={() => {
                        const video = videoRef.current;
                        if (!video) return;
                        if (video.paused) {
                          video.play().catch(e => setError(`Playback could not start: ${describeError(e)}`));
                        } else {
                          video.pause();
                        }
                      }}
                      className="p-1.5 rounded-md hover:bg-slate-100 text-slate-700 hover:text-slate-900 transition-colors cursor-pointer shrink-0"
                      title={playbackState === 'playing' ? 'Pause Video (Space)' : 'Play Video (Space)'}
                    >
                      {playbackState === 'playing' ? (
                        <Pause className="w-4 h-4 fill-current text-slate-700" />
                      ) : (
                        <Play className="w-4 h-4 fill-current text-slate-700" />
                      )}
                    </button>

                    <span className="font-mono text-slate-600 text-[11px] shrink-0 select-none">
                      {formatTime(playbackTime.current)} / {formatTime(playbackTime.duration)}
                    </span>

                    <input
                      type="range"
                      min={0}
                      max={playbackTime.duration || 100}
                      step={0.05}
                      value={playbackTime.current}
                      onChange={(e) => {
                        const video = videoRef.current;
                        if (!video) return;
                        const targetTime = parseFloat(e.target.value);
                        video.currentTime = targetTime;
                        setPlaybackTime(prev => ({ ...prev, current: targetTime }));
                        if (video.paused) {
                          lastPresentedMediaTimeRef.current = targetTime;
                          drawOverlay();
                        }
                      }}
                      className="flex-1 h-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg appearance-none cursor-pointer accent-indigo-600 focus:outline-none min-w-[70px]"
                      title="Scrub video"
                    />
                  </div>

                  {/* Right: Analysis Actions, Video Review Link, Fullscreen, Clear Video */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* While job is active: show clean in-progress status and Cancel button, NO conflicting Start/New Run/Ready */}
                    {isJobActive ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 px-2 py-1 bg-indigo-50 rounded">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                          <span>
                            {analysisStage === 'preparing'
                              ? 'Preparing…'
                              : analysisStage === 'queued'
                                ? 'Queued'
                                : analysisStage === 'finalizing'
                                  ? 'Finalizing…'
                                  : 'Analyzing'}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => void cancelCurrentBackendJob()}
                          className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer"
                        >
                          <Square className="w-3 h-3 fill-current text-rose-500" />
                          <span>Cancel Analysis</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        {(runState === 'NONE' || runState === 'STOPPED' || runState === 'COMPLETED') && (
                          <button
                            id="analyze-start-btn"
                            type="button"
                            onClick={() => {
                              if (analysisEngine === 'backend') {
                                void startBackendAnalysis();
                              } else {
                                void startInference();
                              }
                            }}
                            disabled={!canStart}
                            className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md font-medium text-xs shadow-xs transition-colors cursor-pointer"
                          >
                            {runState === 'NONE' ? <Play className="w-3.5 h-3.5 fill-current" /> : <RotateCcw className="w-3.5 h-3.5" />}
                            <span>{runState === 'NONE' ? 'Start Analysis' : 'New Run'}</span>
                          </button>
                        )}

                        {runState === 'ANALYZING' && (
                          <button
                            type="button"
                            onClick={pauseInference}
                            className="inline-flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-md font-medium text-xs shadow-xs transition-colors cursor-pointer"
                          >
                            <Pause className="w-3.5 h-3.5 fill-current" />
                            <span>Pause</span>
                          </button>
                        )}

                        {runState === 'PAUSED' && (
                          <button
                            type="button"
                            onClick={resumeInference}
                            className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-md font-medium text-xs shadow-xs transition-colors cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Resume</span>
                          </button>
                        )}

                        {(runState === 'ANALYZING' || runState === 'PAUSED') && (
                          <button
                            type="button"
                            onClick={() => { void stopInference(); }}
                            className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-2.5 py-1.5 rounded-md font-medium text-xs transition-colors cursor-pointer"
                          >
                            <Square className="w-3 h-3 fill-current text-slate-500" />
                            <span>Stop</span>
                          </button>
                        )}
                      </>
                    )}

                    {!isJobActive && (
                      <span className="text-[11px] font-medium text-slate-500 hidden md:inline">
                        {playbackState === 'loading_source' || playbackState === 'loading_metadata' ? (
                          <span className="text-indigo-600 font-medium flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Loading video…
                          </span>
                        ) : playbackState === 'error' ? (
                          <span className="text-rose-600 font-medium">Video error</span>
                        ) : runState === 'ANALYZING' ? (
                          <span className="text-emerald-700 font-semibold flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Analyzing
                          </span>
                        ) : runState === 'PAUSED' ? (
                          <span className="text-amber-700 font-semibold">Paused</span>
                        ) : runState === 'COMPLETED' ? (
                          <span className="text-slate-700 font-semibold">Completed</span>
                        ) : runState === 'STOPPED' ? (
                          <span className="text-slate-600">Stopped</span>
                        ) : (
                          <span>Ready</span>
                        )}
                      </span>
                    )}

                    {runState === 'COMPLETED' && !sourceInfo?.isLocalOnly && (
                      <Link
                        to={`/app/videos?video=${sourceInfo.id}`}
                        className="inline-flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-md font-semibold text-xs transition-colors"
                        title="Open full timeline, tracks, and incident replay in History"
                      >
                        <Eye className="w-3.5 h-3.5 text-indigo-600" />
                        <span className="hidden lg:inline">Inspect in History →</span>
                      </Link>
                    )}

                    {sourceInfo?.isLocalOnly && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200" title="Unsaved session: zero database writes. Will not appear in History or survive a page refresh.">
                        <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" /> Local-Only
                      </span>
                    )}

                    <div className="h-4 w-px bg-slate-200 mx-0.5 hidden sm:block" />

                    {/* Fullscreen Button */}
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      className="p-1.5 rounded-md hover:bg-slate-100 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
                      title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
                    >
                      {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>

                    {/* Clear Video Button */}
                    <button
                      id="analyze-clear-video"
                      type="button"
                      onClick={clearActiveVideo}
                      className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-medium px-2 py-1 rounded hover:bg-slate-100 transition-colors text-xs cursor-pointer"
                      title="Clear current video from Live Analysis"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Clear Video</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="w-full flex items-center justify-between text-slate-400 text-[11px]">
                  <span>No video selected</span>
                  <span>Spacebar playback active when video is loaded</span>
                </div>
              )}
            </div>
        </div>
      </div>

      {/* Accessible Upload Dialog */}
      {isUploadModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-dialog-title"
          onClick={e => {
            if (isSubmittingJob) return;
            if (e.target === e.currentTarget) {
              setIsUploadModalOpen(false);
              setStagedFile(null);
            }
          }}
        >
          <div className="bg-white rounded-lg border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <h2 id="upload-dialog-title" className="text-sm font-semibold text-slate-900">
                Upload Traffic Video
              </h2>
              <button
                type="button"
                disabled={isSubmittingJob}
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setStagedFile(null);
                }}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-50 p-1 rounded transition-colors cursor-pointer"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {stagedFile ? (
                <div className="border border-slate-200 bg-slate-50/70 rounded-lg p-3.5 flex items-center justify-between">
                  <div className="min-w-0 flex items-center gap-3">
                    <Film className="w-5 h-5 text-indigo-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-800 truncate">{stagedFile.name}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">{formatMb(stagedFile.size)}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStagedFile(null)}
                    className="text-xs text-slate-400 hover:text-slate-600 font-medium ml-2 cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div
                  onClick={openFilePicker}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) setStagedFile(file);
                  }}
                  className="border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/80 hover:bg-slate-50 rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors group"
                >
                  <Upload className="w-6 h-6 text-slate-400 group-hover:text-indigo-600 transition-colors mb-2" />
                  <div className="text-xs font-medium text-slate-700">Click to select video or drag file here</div>
                  <div className="text-[11px] text-slate-400 mt-1">MP4, WebM, or MOV formats</div>
                </div>
              )}

              {/* Save to History Option */}
              <div className={cn(
                "border rounded-lg p-3 transition-colors",
                saveToHistory ? "bg-slate-50 border-slate-200/80" : "bg-amber-50/70 border-amber-200"
              )}>
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveToHistory}
                    onChange={e => setSaveToHistory(e.target.checked)}
                    className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-slate-800">Save video to History</span>
                    <p className="text-slate-500 text-[11px] mt-0.5 leading-normal">
                      {saveToHistory
                        ? "Stores the video file and its complete analysis artifact in durable storage for future replay in History."
                        : "Temporary local-only processing. Video, detections, and tracks will NOT be saved to History and will not survive a page refresh."}
                    </p>
                  </div>
                </label>
                {!saveToHistory && (
                  <div className="mt-2 pl-6 text-[11px] font-medium text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>Unsaved analysis: Zero database writes. All results reset on refresh.</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-slate-50 border-t border-slate-100">
              <button
                type="button"
                disabled={isSubmittingJob}
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setStagedFile(null);
                }}
                className="px-3.5 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              {stagedFile ? (
                <button
                  type="button"
                  disabled={isSubmittingJob}
                  onClick={() => {
                    if (isSubmittingJobRef.current) return;
                    const f = stagedFile;
                    setIsUploadModalOpen(false);
                    setStagedFile(null);
                    void handleFile(f);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer"
                >
                  {isSubmittingJob ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Submitting…</span>
                    </>
                  ) : (
                    <span>Start Analysis</span>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isSubmittingJob}
                  onClick={openFilePicker}
                  className="px-3.5 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-xs font-medium text-white shadow-xs transition-colors cursor-pointer"
                >
                  Select Video…
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatRemainingTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'calculating…';
  const totalSec = Math.round(seconds);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs} hr ${mins} min`;
  }
  if (mins > 0) {
    return `${mins} min ${secs} sec`;
  }
  return `${secs} sec`;
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
    <div id="analyze-upload-card" className={`rounded-lg p-3.5 border ${failed ? 'bg-red-50 border-red-200' : status === 'UPLOADED' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
      <div className="flex justify-between items-start gap-3 text-xs">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate flex items-center gap-2">
            {(status === 'UPLOADING' || status === 'CREATING RECORD') && <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600 shrink-0" />}
            {failed && <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />}
            {status === 'UPLOADED' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
            <span className="truncate">{fileName}</span>
            <span className="text-slate-500 font-mono shrink-0">{formatMb(fileSize)}</span>
          </div>
          <div className={`mt-1 text-[11px] ${failed ? 'text-red-700' : 'text-slate-500'}`}>{detail}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${failed ? 'bg-red-100 text-red-700' : status === 'UPLOADED' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
            {status}{progress !== null ? ` ${progress}%` : ''}
          </span>
          {onDismiss && <button type="button" onClick={onDismiss} className="text-slate-400 hover:text-slate-600 font-bold cursor-pointer">✕</button>}
        </div>
      </div>
      {progress !== null && (
        <div className="mt-2 w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
          <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
