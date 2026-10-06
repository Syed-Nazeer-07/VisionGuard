import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { 
  Upload, Cpu, CheckCircle2, Loader2, Activity, ShieldAlert, 
  AlertTriangle, Film, Play, Camera as CameraIcon, Radio, Pause
} from 'lucide-react';
import { drawBoundingBoxes } from '../pipeline/rendering/overlay';
import type { WorkerOutputMessage } from '../pipeline/types';
import { db } from '../services/db';
import { requestOcr } from '../pipeline/plate/service';
import { evidenceQueue } from '../pipeline/evidence/queue';
import { supabase } from '../lib/supabase';
import { uploadManager } from '../services/uploadManager';
import { analysisLogger } from '../services/analysisLogger';
import { AnalysisLogPanel } from '../components/analysis/AnalysisLogPanel';
import Hls from 'hls.js';

type ModelStatus = 'loading' | 'ready' | 'error';
type AnalysisState = 'READY' | 'STARTING' | 'ANALYZING' | 'PAUSED' | 'STOPPING' | 'COMPLETED' | 'FAILED';
type SourceMode = 'video' | 'camera';

interface TrackedRecord {
  video_id: string | null;
  camera_id: string | null;
  analysis_run_id: string | null;
  track_id: number;
  object_type: string;
  confidence: number;
  first_seen_timestamp: number;
  last_seen_timestamp: number;
  frame_count: number;
  metadata: {
    trajectory: Array<{
      time: number;
      bbox: [number, number, number, number];
      speed?: number;
    }>;
  };
}

export default function Analyze() {
  const [searchParams, setSearchParams] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [analysisState, setAnalysisState] = useState<AnalysisState>('READY');
  const [sourceMode, setSourceMode] = useState<SourceMode>('video');
  const [provider, setProvider] = useState<string>('');
  const [fps, setFps] = useState<number>(0);
  const [inferenceTime, setInferenceTime] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState<string>('');
  const [totalProcessedFrames, setTotalProcessedFrames] = useState(0);
  const [metrics, setMetrics] = useState({ generated: 0, created: 0, suppressed: 0, saved: 0 });
  const [trackedCount, setTrackedCount] = useState(0);
  const [queueDepth, setQueueDepth] = useState(0);

  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [playBlocked, setPlayBlocked] = useState<boolean>(false);
  const [isUploadingOnly, setIsUploadingOnly] = useState<boolean>(false);
  const uploadSubRef = useRef<(() => void) | null>(null);

  // Refs mirror mutable state so worker/frame callbacks never read stale values
  const modelReadyRef = useRef(false);
  const isProcessingRef = useRef(false);
  const loopActiveRef = useRef(false);
  const settingsRef = useRef<Record<string, any>>({});
  const cameraIdRef = useRef<string | null>(null);
  const videoIdRef = useRef<string | null>(null);
  const analysisRunIdRef = useRef<string | null>(null);
  const inferenceTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const lastTrackFlushTimeRef = useRef(performance.now());
  const isWorkerBusyRef = useRef(false);
  const busySinceRef = useRef(0);
  const dedupeCache = useRef(new Map<string, number>());
  const incidentQueueRef = useRef<any[]>([]);
  const pipelineMetricsRef = useRef({
    framesProcessed: 0,
    detectionsGenerated: 0,
    incidentsCreated: 0,
    incidentsSuppressed: 0,
    incidentsSaved: 0
  });
  const trackedObjectsRef = useRef<Map<number, TrackedRecord>>(new Map());
  const loadedCameraIdRef = useRef<string | null>(null);
  const fpsRef = useRef<number>(0);
  const camerasRef = useRef<any[]>([]);

  // Synchronize videoId with ref and state
  const setResolvedVideoId = useCallback((id: string | null) => {
    setVideoId(id);
    videoIdRef.current = id;
    if (id) {
      localStorage.setItem('visionguard_active_video_id', id);
    }
  }, []);

  // Persistent Analysis Run Lifecycle Management
  const startAnalysisSession = useCallback(async (camId: string | null, vidId?: string | null) => {
    if (!camId && !vidId) return null;
    if (analysisRunIdRef.current) return analysisRunIdRef.current;

    try {
      const run = await db.analysisRuns.create({
        camera_id: (camId || null) as any,
        started_at: new Date().toISOString(),
        status: 'running',
        metrics: {
          fps: 0,
          latency: 0,
          queue_depth: 0,
          frames_processed: 0,
          detections_generated: 0,
          incidents_created: 0,
          incidents_suppressed: 0,
          video_id: vidId || null
        } as any
      });
      analysisRunIdRef.current = run.id;
      setActiveRunId(run.id);

      analysisLogger.log({
        video_id: vidId || null,
        camera_id: camId || null,
        analysis_run_id: run.id,
        category: 'SYSTEM',
        message: `Analysis run session initialized (Run #${run.id.slice(0, 8)})`
      });

      return run.id;
    } catch (e) {
      console.warn('Analysis run creation exception:', e);
      return null;
    }
  }, []);

  const finalizeAnalysisRun = useCallback(async (terminalStatus: 'completed' | 'stopped' | 'failed') => {
    const runId = analysisRunIdRef.current;
    if (!runId) return;
    analysisRunIdRef.current = null;
    setActiveRunId(null);

    const nowIso = new Date().toISOString();
    try {
      await db.analysisRuns.update(runId, {
        ended_at: nowIso,
        status: terminalStatus,
        metrics: {
          ...pipelineMetricsRef.current,
          fps: fpsRef.current,
          latency: inferenceTimeRef.current,
          queue_depth: incidentQueueRef.current.length
        } as any
      });

      analysisLogger.log({
        video_id: videoIdRef.current || null,
        camera_id: cameraIdRef.current || null,
        analysis_run_id: runId,
        category: 'SYSTEM',
        message: `Analysis run concluded (${terminalStatus})`
      });
    } catch (e) {
      console.warn('Analysis run finalization warning:', e);
    }
  }, []);

  // Flush tracked objects to database (both live cameras and uploaded videos)
  const flushTrackedObjects = useCallback(async () => {
    const currentVid = videoIdRef.current;
    const currentCam = cameraIdRef.current;
    if ((!currentVid && !currentCam) || trackedObjectsRef.current.size === 0) return;

    const rows = Array.from(trackedObjectsRef.current.values()).map(r => ({
      video_id: currentVid || null,
      camera_id: currentCam || null,
      analysis_run_id: r.analysis_run_id || analysisRunIdRef.current || null,
      track_id: r.track_id,
      object_type: r.object_type,
      confidence: r.confidence,
      first_seen_timestamp: r.first_seen_timestamp,
      last_seen_timestamp: r.last_seen_timestamp,
      frame_count: r.frame_count,
      metadata: r.metadata || {}
    }));

    try {
      const conflictCol = currentVid ? 'video_id,track_id' : 'camera_id,track_id';
      const { error: upsertErr } = await (supabase as any)
        .from('tracked_objects')
        .upsert(rows, { onConflict: conflictCol });

      if (upsertErr) {
        console.warn('Tracked objects upsert error:', upsertErr);
      } else {
        analysisLogger.log({
          video_id: currentVid || null,
          camera_id: currentCam || null,
          analysis_run_id: analysisRunIdRef.current || null,
          category: 'PERSISTENCE',
          message: `Tracked objects checkpoint saved (${rows.length} tracks)`
        });
      }
    } catch (err) {
      console.warn('Tracked objects flush error:', err);
    }
  }, []);

  // Flush queued incidents to database (both live cameras and uploaded videos)
  const flushIncidents = useCallback(async () => {
    if (incidentQueueRef.current.length === 0) return;
    const toFlush = [...incidentQueueRef.current];
    incidentQueueRef.current = [];
    setQueueDepth(0);

    const rows = toFlush.map(t => t.incident);
    const { data, error: insErr } = await (supabase as any).from('incidents').insert(rows).select();
    if (insErr) {
      console.error('Incident insert failed:', insErr);
      setSaveError(insErr.message || 'Failed to save incidents');
      analysisLogger.log({
        video_id: rows[0]?.video_id || videoIdRef.current || null,
        camera_id: rows[0]?.camera_id || cameraIdRef.current || null,
        analysis_run_id: analysisRunIdRef.current || null,
        category: 'ERROR',
        message: `Incident persistence failed: ${insErr.message}`
      });
      return;
    }
    setSaveError(null);
    const created: any[] = data || [];
    pipelineMetricsRef.current.incidentsSaved += created.length;

    analysisLogger.log({
      video_id: rows[0]?.video_id || videoIdRef.current || null,
      camera_id: rows[0]?.camera_id || cameraIdRef.current || null,
      analysis_run_id: analysisRunIdRef.current || null,
      category: 'PERSISTENCE',
      message: `Persisted ${created.length} incident record(s) to database`
    });

    created.forEach((inc: any, index: number) => {
      const src = toFlush[index];
      if (src?.evidence) {
        src.evidence.forEach((ev: any) => {
          evidenceQueue.add({
            incident_id: inc.id,
            camera_id: inc.camera_id ?? null,
            video_id: inc.video_id ?? null,
            analysis_run_id: inc.analysis_run_id ?? null,
            base64Data: ev.base64,
            type: ev.type,
            capture_timestamp: src.timestamp
          });
          analysisLogger.log({
            video_id: inc.video_id ?? null,
            camera_id: inc.camera_id ?? null,
            analysis_run_id: inc.analysis_run_id ?? null,
            category: 'EVIDENCE',
            message: `Evidence snapshot queued for incident #${inc.id.slice(0, 8)} (${ev.type})`
          });
        });
      }
      
      // Also register into violations table for review queue
      if (inc.camera_id || inc.video_id) {
        (supabase as any).from('violations').insert({
          camera_id: inc.camera_id || null,
          video_id: inc.video_id || null,
          analysis_run_id: inc.analysis_run_id || null,
          type: src.type,
          severity: src.severity,
          status: 'pending_review',
          timestamp: src.timestamp,
          metadata: src.metadata
        }).then(({ error }: any) => {
          if (error) console.warn('Violation insert warning:', error);
        });
      }
    });
  }, []);

  // Clean tear-down of current media source
  const resetSourceState = useCallback(async () => {
    isProcessingRef.current = false;
    loopActiveRef.current = false;
    await finalizeAnalysisRun('stopped');
    await flushIncidents();
    await flushTrackedObjects();
    workerRef.current?.postMessage({ type: 'reset_tracker' });
    dedupeCache.current.clear();
    trackedObjectsRef.current.clear();
    setTrackedCount(0);
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, [finalizeAnalysisRun, flushIncidents, flushTrackedObjects]);

  // Load persistent video asset
  const loadVideoAsset = useCallback(async (vidId: string) => {
    await resetSourceState();
    setAnalysisState('STARTING');
    setSourceMode('video');
    setSelectedCameraId('');
    cameraIdRef.current = null;
    setError(null);
    setSaveError(null);
    setIsUploadingOnly(false);

    try {
      const activeUpload = uploadManager.getUpload(vidId);

      // 1. Fetch video_assets record
      let assetData: any = null;
      const { data, error: fetchErr } = await (supabase as any)
        .from('video_assets')
        .select('*')
        .eq('id', vidId)
        .maybeSingle();

      if (data) {
        assetData = data;
      } else if (activeUpload) {
        assetData = {
          id: activeUpload.videoId,
          filename: activeUpload.fileName,
          storage_path: activeUpload.storagePath,
          file_size: activeUpload.fileSize,
          processing_status: activeUpload.status
        };
      } else {
        throw new Error(fetchErr?.message || 'Video asset not found');
      }

      setResolvedVideoId(assetData.id);

      // 2. Resolve Playable URL with graceful fallback
      let playUrl = '';
      if (assetData.storage_path) {
        const { data: urlData } = supabase.storage.from('videos').getPublicUrl(assetData.storage_path);
        playUrl = urlData?.publicUrl || '';
      }

      // Fallback 1: Local preview blob if still valid in memory
      if (!playUrl && activeUpload?.localPreviewUrl) {
        playUrl = activeUpload.localPreviewUrl;
      }

      // Fallback 2: Default asset sample
      if (!playUrl && (assetData.filename?.includes('car-detection') || assetData.storage_path === 'car-detection.mp4')) {
        playUrl = '/car-detection.mp4';
      }

      // If active upload is still uploading, subscribe and monitor progress
      if (activeUpload && activeUpload.status === 'uploading') {
        setUploadProgress(activeUpload.progress);
        if (uploadSubRef.current) uploadSubRef.current();
        uploadSubRef.current = uploadManager.subscribe(vidId, (up) => {
          setUploadProgress(up.progress);
          if (up.status === 'uploaded') {
            setTimeout(() => setUploadProgress(0), 1000);
            setIsUploadingOnly(false);
            if (!playUrl && up.storagePath) {
              const { data: uData } = supabase.storage.from('videos').getPublicUrl(up.storagePath);
              if (uData?.publicUrl) {
                loadMediaUrl(uData.publicUrl, up.fileName);
              }
            }
          }
        });
      }

      if (playUrl) {
        setIsUploadingOnly(false);
        loadMediaUrl(playUrl, assetData.filename);
      } else if (activeUpload?.status === 'uploading' || !assetData.storage_path) {
        // Upload is in progress — show non-blocking progress UI instead of marking as failed
        setIsUploadingOnly(true);
        setSourceName(assetData.filename);
      } else {
        throw new Error('Could not resolve video stream URL');
      }

      // 3. Rehydrate persistent analysis data (incidents, tracked objects, analysis runs)
      try {
        const [tracksRes, incsRes, runsRes] = await Promise.all([
          (supabase as any).from('tracked_objects').select('*').eq('video_id', vidId),
          (supabase as any).from('incidents').select('*').eq('video_id', vidId).order('created_at', { ascending: true }),
          (supabase as any).from('analysis_runs').select('*').order('started_at', { ascending: false }).limit(10)
        ]);

        const savedTracks = tracksRes.data || [];
        const savedIncs = incsRes.data || [];
        const savedRuns = (runsRes.data || []).filter((r: any) => r.metrics?.video_id === vidId);

        setTrackedCount(savedTracks.length);
        setMetrics({
          generated: savedTracks.length,
          created: savedIncs.length,
          suppressed: 0,
          saved: savedIncs.length
        });

        if (savedTracks.length > 0) {
          savedTracks.forEach((t: any) => {
            trackedObjectsRef.current.set(t.track_id, {
              video_id: vidId,
              camera_id: null,
              analysis_run_id: t.analysis_run_id || null,
              track_id: t.track_id,
              object_type: t.object_type,
              confidence: Number(t.confidence),
              first_seen_timestamp: Number(t.first_seen_timestamp || 0),
              last_seen_timestamp: Number(t.last_seen_timestamp || 0),
              frame_count: t.frame_count || 0,
              metadata: t.metadata || { trajectory: [] }
            });
          });
        }

        if (savedRuns.length > 0) {
          analysisRunIdRef.current = savedRuns[0].id;
          setActiveRunId(savedRuns[0].id);
          if (savedRuns[0].metrics?.frames_processed) {
            setTotalProcessedFrames(savedRuns[0].metrics.frames_processed);
          }
        }
      } catch (hydrateErr) {
        console.warn('Persistent video analysis hydration warning:', hydrateErr);
      }

      // 4. Load historical analysis logs
      analysisLogger.fetchHistoricalLogs(vidId, null).catch(() => {});

      // 5. Update state machine
      if (assetData.processing_status === 'completed') {
        setAnalysisState('COMPLETED');
      } else if (assetData.processing_status === 'failed') {
        setAnalysisState('FAILED');
      } else {
        setAnalysisState('READY');
      }

    } catch (err: any) {
      console.error('Failed to load video asset:', err);
      setError(`Failed to load video: ${err.message}`);
      setAnalysisState('FAILED');
    }
  }, [resetSourceState, setResolvedVideoId]);

  // Load live camera source
  const loadCameraSource = useCallback(async (camId: string) => {
    if (loadedCameraIdRef.current === camId && cameraIdRef.current === camId) return;
    await resetSourceState();

    loadedCameraIdRef.current = camId;
    cameraIdRef.current = camId;
    setResolvedVideoId(null);
    setSourceMode('camera');
    setSelectedCameraId(camId);
    setAnalysisState('STARTING');
    setError(null);
    setSaveError(null);

    // Update query params to reflect camera selection only if changed
    const currentParam = new URLSearchParams(window.location.search).get('camera');
    if (currentParam !== camId) {
      setSearchParams({ camera: camId }, { replace: true });
    }

    const cam = camerasRef.current.find(c => c.id === camId);
    const video = videoRef.current;
    if (!cam || !video) return;

    const url = cam.source_url || cam.stream_url;
    if (!url) {
      setError(`Camera "${cam.name}" does not have a stream URL configured.`);
      setAnalysisState('FAILED');
      return;
    }

    setSourceName(cam.name);
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (cam.source_type === 'hls' || url.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: false, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => setPlayBlocked(true));
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            setError(`Camera stream error: ${data.details}`);
            setAnalysisState('FAILED');
          }
        });
      } else {
        video.src = url;
        video.play().catch(() => setPlayBlocked(true));
      }
    } else {
      video.src = url;
      video.play().catch(() => setPlayBlocked(true));
    }
  }, [resetSourceState, setResolvedVideoId, setSearchParams]);

  // Media playback loader
  const loadMediaUrl = (url: string, name: string) => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setSourceName(name);

    video.src = url;
    video.load();
    video.play().then(() => {
      setPlayBlocked(false);
    }).catch((err) => {
      console.warn('Autoplay blocked by browser policy:', err);
      setPlayBlocked(true);
    });
  };

  // Initial mount configuration
  useEffect(() => {
    db.settings.list().then(s => { settingsRef.current = s || {}; }).catch(() => {});
    db.cameras.list().then(c => {
      camerasRef.current = c || [];
      setCameras(c || []);
      const urlParams = new URLSearchParams(window.location.search);
      const camId = urlParams.get('camera');
      const vidId = urlParams.get('video');
      
      if (camId) {
        loadCameraSource(camId);
      } else if (vidId) {
        loadVideoAsset(vidId);
      } else if (c && c.length > 0) {
        // Default to first camera if present
        loadCameraSource(c[0].id);
      }
    }).catch(() => {});

    const channel = supabase.channel('analyze-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => {
        db.settings.list().then(s => { settingsRef.current = s || {}; }).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras' }, () => {
        db.cameras.list().then(c => {
          camerasRef.current = c || [];
          setCameras(c || []);
        }).catch(() => {});
      })
      .subscribe();

    const onBeforeUnload = () => {
      finalizeAnalysisRun('stopped');
      flushTrackedObjects();
      flushIncidents();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => { 
      window.removeEventListener('beforeunload', onBeforeUnload);
      supabase.removeChannel(channel); 
      finalizeAnalysisRun('stopped');
      flushTrackedObjects();
      flushIncidents();
    };
  }, [finalizeAnalysisRun, flushIncidents, flushTrackedObjects, loadCameraSource, loadVideoAsset]);

  // Synchronize route search param updates
  useEffect(() => {
    const vidParam = searchParams.get('video');
    const camParam = searchParams.get('camera');
    if (vidParam && vidParam !== videoIdRef.current) {
      loadVideoAsset(vidParam);
    } else if (camParam && camParam !== cameraIdRef.current && cameras.length > 0) {
      loadCameraSource(camParam);
    }
  }, [searchParams, cameras, loadVideoAsset, loadCameraSource]);

  // FPS, Performance & Live Metrics Timer
  const updateFps = () => {
    frameCountRef.current += 1;
    pipelineMetricsRef.current.framesProcessed += 1;

    const now = performance.now();
    const elapsed = now - lastFpsTimeRef.current;
    if (elapsed >= 1000) {
      const currentFps = Math.round((frameCountRef.current * 1000) / elapsed);
      fpsRef.current = currentFps;
      setFps(currentFps);
      setTotalProcessedFrames(pipelineMetricsRef.current.framesProcessed);
      setMetrics({
        generated: pipelineMetricsRef.current.detectionsGenerated,
        created: pipelineMetricsRef.current.incidentsCreated,
        suppressed: pipelineMetricsRef.current.incidentsSuppressed,
        saved: pipelineMetricsRef.current.incidentsSaved
      });
      setTrackedCount(trackedObjectsRef.current.size);
      setQueueDepth(incidentQueueRef.current.length);

      // Periodically update active analysis run with live metrics
      if (analysisRunIdRef.current) {
        db.analysisRuns.update(analysisRunIdRef.current, {
          metrics: {
            fps: currentFps,
            latency: inferenceTimeRef.current,
            queue_depth: incidentQueueRef.current.length,
            frames_processed: pipelineMetricsRef.current.framesProcessed,
            detections_generated: pipelineMetricsRef.current.detectionsGenerated,
            incidents_created: pipelineMetricsRef.current.incidentsCreated,
            incidents_suppressed: pipelineMetricsRef.current.incidentsSuppressed,
            incidents_saved: pipelineMetricsRef.current.incidentsSaved
          } as any
        }).catch(() => {});
      }

      flushIncidents();
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }

    // Periodic flush of tracked objects every 3 seconds
    if (now - lastTrackFlushTimeRef.current >= 3000) {
      flushTrackedObjects();
      lastTrackFlushTimeRef.current = now;
    }
  };

  // Rule violation processor (Unified for live camera and uploaded video)
  const handleViolations = (violations: any[]) => {
    const now = Date.now();
    const camId = cameraIdRef.current;
    const currentVid = videoIdRef.current;

    // DATA INTEGRITY:
    // Never create a live incident without a camera_id.
    // Never create an uploaded-video incident without its video_id.
    // Do not silently substitute one source identifier for the other.
    if (!camId && !currentVid) return;

    violations.forEach(async (v: any) => {
      pipelineMetricsRef.current.detectionsGenerated++;
      const meta = (v.metadata || {}) as any;
      const conf = meta.confidence ?? 1.0;
      if (conf < 0.6) return;

      const dedupeKey = `${camId ? `cam_${camId}` : `vid_${currentVid}`}_${v.type}_${meta.track_id}`;
      const lastSeen = dedupeCache.current.get(dedupeKey);
      if (lastSeen && now - lastSeen < 10000) {
        pipelineMetricsRef.current.incidentsSuppressed++;
        return;
      }
      dedupeCache.current.set(dedupeKey, now);
      pipelineMetricsRef.current.incidentsCreated++;

      analysisLogger.log({
        video_id: currentVid || null,
        camera_id: camId || null,
        analysis_run_id: analysisRunIdRef.current || null,
        category: 'INCIDENT',
        message: `Incident created: ${String(v.type).replace(/_/g, ' ')} (Track #${meta.track_id ?? '?'}, conf ${(conf * 100).toFixed(0)}%)`
      });

      try {
        if (meta.plate_crop_path && meta.ocr_status === 'pending') {
          try {
            const ocrRes = await requestOcr(meta.plate_crop_path);
            meta.plate_text = ocrRes.text;
            meta.plate_confidence = ocrRes.confidence;
            meta.ocr_status = 'completed';
          } catch {
            meta.ocr_status = 'failed';
          }
        }

        const snapshotBase64: string | null = v.snapshot_url || null;
        const plateCropBase64: string | null = meta.plate_crop_path || null;
        v.snapshot_url = undefined;
        meta.plate_crop_path = undefined;

        const cam = cameras.find(c => c.id === camId);
        const ts = v.timestamp || new Date().toISOString();
        const locationStr = camId 
          ? (cam?.location || cam?.name || 'Live Camera Stream') 
          : (sourceName ? `Uploaded Video: ${sourceName}` : 'Uploaded Video Asset');

        incidentQueueRef.current.push({
          type: v.type,
          severity: v.severity || 'medium',
          timestamp: ts,
          metadata: {
            ...meta,
            track_id: meta.track_id,
            confidence: conf
          },
          incident: {
            incident_type: v.type,
            violation_type: v.type,
            severity: v.severity || 'medium',
            status: 'Active',
            confidence: conf,
            track_id: meta.track_id ?? null,
            timestamp: ts,
            camera_id: camId || null,
            video_id: camId ? null : currentVid,
            analysis_run_id: analysisRunIdRef.current || null,
            location: locationStr,
            description: `${String(v.type).replace(/_/g, ' ')} detected (track #${meta.track_id ?? '?'}, confidence ${(conf * 100).toFixed(0)}%) at ${locationStr}`,
            created_at: ts
          },
          evidence: [
            snapshotBase64 && snapshotBase64.startsWith('data:image') ? { type: 'snapshot', base64: snapshotBase64 } : null,
            plateCropBase64 && plateCropBase64.startsWith('data:image') ? { type: 'plate_crop', base64: plateCropBase64 } : null
          ].filter(Boolean)
        });
        setQueueDepth(incidentQueueRef.current.length);
      } catch (err) {
        console.warn('Failed to queue incident:', err);
      }
    });
  };

  const violationHandlerRef = useRef(handleViolations);
  violationHandlerRef.current = handleViolations;
  const fpsHandlerRef = useRef(updateFps);
  fpsHandlerRef.current = updateFps;

  // Web Worker Initialization
  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../pipeline/worker/index.ts', import.meta.url), { type: 'module' });
    } catch (e: any) {
      setModelStatus('error');
      setError(`Failed to initialize detection worker: ${e?.message || e}`);
      setAnalysisState('FAILED');
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOutputMessage>) => {
      const msg: any = e.data;
      if (msg.type === 'ready') {
        modelReadyRef.current = true;
        setModelStatus('ready');
        setProvider(msg.provider || '');
        analysisLogger.log({
          video_id: videoIdRef.current,
          camera_id: cameraIdRef.current,
          category: 'MODEL',
          message: `AI YOLOv8 model loaded and ready (${(msg.provider || 'wasm').toUpperCase()})`
        });
      } else if (msg.type === 'result') {
        isWorkerBusyRef.current = false;
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
        inferenceTimeRef.current = msg.inferenceTime;
        setInferenceTime(msg.inferenceTime);

        if (msg.tracks && msg.tracks.length > 0) {
          analysisLogger.logDetection(
            videoIdRef.current,
            cameraIdRef.current,
            analysisRunIdRef.current,
            `Detection: ${msg.tracks.map((t: any) => `${t.className} (#${t.trackId})`).slice(0, 3).join(', ')}${msg.tracks.length > 3 ? ` +${msg.tracks.length - 3} more` : ''}`
          );
        }
        
        // Track objects with per-frame trajectory coordinates
        const nowTime = (videoRef.current && !isNaN(videoRef.current.currentTime) && videoRef.current.currentTime > 0)
          ? videoRef.current.currentTime 
          : (performance.now() / 1000);

        msg.tracks.forEach((t: any) => {
          let rec = trackedObjectsRef.current.get(t.trackId);
          if (!rec) {
            rec = {
              video_id: videoIdRef.current,
              camera_id: cameraIdRef.current,
              analysis_run_id: analysisRunIdRef.current,
              track_id: t.trackId,
              object_type: t.className,
              confidence: t.prob,
              first_seen_timestamp: nowTime,
              last_seen_timestamp: nowTime,
              frame_count: 0,
              metadata: {
                trajectory: []
              }
            };
            trackedObjectsRef.current.set(t.trackId, rec);
          }
          rec.last_seen_timestamp = nowTime;
          rec.frame_count++;
          rec.confidence = Math.max(rec.confidence, t.prob);
          if (analysisRunIdRef.current && !rec.analysis_run_id) {
            rec.analysis_run_id = analysisRunIdRef.current;
          }
          if (cameraIdRef.current && !rec.camera_id) {
            rec.camera_id = cameraIdRef.current;
          }
          
          if (!rec.metadata) rec.metadata = { trajectory: [] };
          const traj = rec.metadata.trajectory;
          const lastPoint = traj[traj.length - 1];
          if (!lastPoint || Math.abs(nowTime - lastPoint.time) >= 0.25) {
            if (traj.length < 400) {
              traj.push({
                time: Math.round(nowTime * 100) / 100,
                bbox: t.bbox,
                speed: t.speed ? Math.round(t.speed) : undefined
              });
            }
          }
        });

        fpsHandlerRef.current();
        if (msg.violations && msg.violations.length > 0) {
          violationHandlerRef.current(msg.violations);
        }
      } else if (msg.type === 'error') {
        isWorkerBusyRef.current = false;
        if (!modelReadyRef.current) setModelStatus('error');
        setError(msg.error);
        setAnalysisState('FAILED');
        finalizeAnalysisRun('failed');
      }
    };

    worker.onerror = (ev) => {
      if (!modelReadyRef.current) setModelStatus('error');
      setError(`Detection worker error: ${ev.message || (ev.error?.message) || 'unknown'}`);
      setAnalysisState('FAILED');
      finalizeAnalysisRun('failed');
    };

    worker.postMessage({ type: 'init', modelPath: '/models/yolo11n.onnx' });

    return () => {
      worker.terminate();
      workerRef.current = null;
      hlsRef.current?.destroy();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [finalizeAnalysisRun]);

  const scheduleNext = (video: HTMLVideoElement) => {
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
      (video as any).requestVideoFrameCallback(() => processFrame());
    } else {
      requestAnimationFrame(() => processFrame());
    }
  };

  const processFrame = async () => {
    const video = videoRef.current;
    if (!video || video.paused || video.ended || !isProcessingRef.current) {
      loopActiveRef.current = false;
      return;
    }

    if (isWorkerBusyRef.current && performance.now() - busySinceRef.current > 5000) {
      isWorkerBusyRef.current = false;
    }

    if (!isWorkerBusyRef.current && modelReadyRef.current && video.readyState >= 2) {
      try {
        const bitmap = await createImageBitmap(video);
        isWorkerBusyRef.current = true;
        busySinceRef.current = performance.now();
        const s = settingsRef.current;
        workerRef.current?.postMessage({
          type: 'inference',
          bitmap,
          mediaTime: video.currentTime,
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
      } catch (err) {
        console.warn('Frame bitmap extraction warning:', err);
      }
    }

    scheduleNext(video);
  };

  const startLoop = () => {
    if (loopActiveRef.current) return;
    loopActiveRef.current = true;
    processFrame();
  };

  const openFilePicker = () => fileInputRef.current?.click();

  // Canonical video upload flow using persistent UploadManagerService
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      setError('Please select a valid video file (MP4, WebM, or MOV).');
      return;
    }

    try {
      await resetSourceState();
      setAnalysisState('STARTING');
      setSourceMode('video');
      setSelectedCameraId('');
      cameraIdRef.current = null;
      setError(null);
      setSaveError(null);
      setIsUploadingOnly(false);

      // Start upload via persistent UploadManagerService
      const { videoId: newVideoId, localPreviewUrl } = await uploadManager.startUpload(file);

      setResolvedVideoId(newVideoId);
      setSearchParams({ video: newVideoId }, { replace: true });

      // Immediate local playback URL
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = localPreviewUrl;
      loadMediaUrl(localPreviewUrl, file.name);

      // Subscribe to upload manager progress updates
      if (uploadSubRef.current) uploadSubRef.current();
      uploadSubRef.current = uploadManager.subscribe(newVideoId, (upload) => {
        setUploadProgress(upload.progress);
        if (upload.status === 'uploaded') {
          setTimeout(() => setUploadProgress(0), 1000);
          analysisLogger.log({
            video_id: newVideoId,
            category: 'SYSTEM',
            message: `Video asset ready for analysis pipeline`
          });
        } else if (upload.status === 'failed') {
          setError(upload.error || 'Upload failed');
          setAnalysisState('FAILED');
        }
      });

    } catch (err: any) {
      console.error('Upload flow failed:', err);
      setError(err?.message || 'Upload flow failed');
      setAnalysisState('FAILED');
      setUploadProgress(0);
      isProcessingRef.current = false;
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleFileUpload({ target: { files: [file], value: '' } } as any);
    }
  };

  // Playback handlers
  const handlePlay = async () => {
    setPlayBlocked(false);
    setError(prev => (prev && prev.startsWith('Autoplay') ? null : prev));
    isProcessingRef.current = true;
    setAnalysisState('ANALYZING');
    startLoop();

    // Start persistent session run for live camera or video
    const camId = cameraIdRef.current;
    const vidId = videoIdRef.current;
    await startAnalysisSession(camId, vidId);

    if (vidId) {
      (supabase as any).from('video_assets').update({
        processing_status: 'processing'
      }).eq('id', vidId).then(() => {}).catch(() => {});
    }

    analysisLogger.log({
      video_id: vidId || null,
      camera_id: camId || null,
      analysis_run_id: analysisRunIdRef.current,
      category: 'PROCESSING',
      message: `Detection and tracking pipeline started for ${sourceName || 'selected media'}`
    });
  };

  const handlePause = async () => {
    isProcessingRef.current = false;
    setAnalysisState('PAUSED');
    await flushIncidents();
    await flushTrackedObjects();
    await finalizeAnalysisRun('stopped');

    analysisLogger.log({
      video_id: videoIdRef.current || null,
      camera_id: cameraIdRef.current || null,
      analysis_run_id: analysisRunIdRef.current,
      category: 'PROCESSING',
      message: `Analysis paused`
    });
  };

  const handleEnded = async () => {
    isProcessingRef.current = false;
    setAnalysisState('COMPLETED');
    await flushIncidents();
    await flushTrackedObjects();
    await finalizeAnalysisRun('completed');
    const vidId = videoIdRef.current;
    if (vidId) {
      await (supabase as any).from('video_assets').update({
        processing_status: 'completed',
        duration: videoRef.current?.duration || null
      }).eq('id', vidId);
    }

    analysisLogger.log({
      video_id: vidId || null,
      camera_id: cameraIdRef.current || null,
      analysis_run_id: analysisRunIdRef.current,
      category: 'PROCESSING',
      message: `Analysis run finished (${pipelineMetricsRef.current.detectionsGenerated} detections, ${pipelineMetricsRef.current.incidentsCreated} incidents)`
    });
  };

  const handleVideoError = () => {
    setError('Video source playback error or stream unavailable.');
    setAnalysisState('FAILED');
    isProcessingRef.current = false;
    finalizeAnalysisRun('failed');
  };

  const hasMedia = !!sourceName;

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto">
      {/* Header with Source Switching & Actions */}
      <header className="mb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
              sourceMode === 'camera' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
            }`}>
              {sourceMode === 'camera' ? <Radio className="w-3 h-3 animate-pulse text-emerald-600" /> : <Film className="w-3 h-3 text-indigo-600" />}
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
          {/* Source Selection Dropdown for Live Cameras */}
          {cameras.length > 0 && (
            <div className="relative">
              <select
                id="analyze-camera-select"
                aria-label="Select live camera for analysis"
                className="bg-white border border-slate-300 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-bold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                value={selectedCameraId}
                onChange={(e) => {
                  if (e.target.value) {
                    loadCameraSource(e.target.value);
                  }
                }}
              >
                <option value="">-- Switch to Camera --</option>
                {cameras.map(cam => (
                  <option key={cam.id} value={cam.id} disabled={!cam.source_url && !cam.stream_url}>
                    📹 {cam.name} {(!cam.source_url && !cam.stream_url) ? '(No URL)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            id="analyze-upload-video-btn"
            type="button"
            onClick={openFilePicker}
            disabled={uploadProgress > 0}
            className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 active:scale-[0.98] text-white px-5 py-2.5 rounded-xl font-semibold shadow-md shadow-indigo-500/20 transition-all cursor-pointer text-xs"
          >
            {uploadProgress > 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploadProgress > 0 ? `Uploading (${uploadProgress}%)` : 'Upload MP4'}
          </button>
        </div>

        <input
          id="analyze-file-input"
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/*"
          className="hidden"
          onChange={handleFileUpload}
        />
      </header>

      {/* Upload State & Pipeline Progress Bar */}
      {uploadProgress > 0 && (
        <div className="mb-6 bg-indigo-50 border border-indigo-100 rounded-xl p-4">
          <div className="flex justify-between items-center text-xs font-semibold text-indigo-900 mb-2">
            <span>Uploading to Persistent Storage...</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full bg-indigo-200/60 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-indigo-600 h-full rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Explicit Analysis & Pipeline Status Bar */}
      <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3" id="analyze-status-bar">
        <StatusPill
          id="status-analysis-state"
          active={true}
          tone={
            analysisState === 'FAILED' ? 'red' :
            analysisState === 'ANALYZING' ? 'green' :
            analysisState === 'STARTING' ? 'indigo' :
            analysisState === 'COMPLETED' ? 'green' : 'amber'
          }
          icon={
            analysisState === 'ANALYZING' ? <Activity className="w-4 h-4 animate-pulse" /> :
            analysisState === 'STARTING' ? <Loader2 className="w-4 h-4 animate-spin" /> :
            analysisState === 'FAILED' ? <AlertTriangle className="w-4 h-4" /> :
            analysisState === 'PAUSED' ? <Pause className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />
          }
          label={`State: ${analysisState}`}
        />

        <StatusPill
          id="status-model-ready"
          active={modelStatus === 'ready'}
          tone={modelStatus === 'error' ? 'red' : 'green'}
          icon={modelStatus === 'ready' ? <CheckCircle2 className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
          label={modelStatus === 'ready' ? `YOLO Ready${provider ? ` · ${provider.toUpperCase()}` : ''}` : 'Model Loading…'}
        />

        <StatusPill
          id="status-source-source"
          active={hasMedia}
          tone="indigo"
          icon={sourceMode === 'camera' ? <CameraIcon className="w-4 h-4" /> : <Film className="w-4 h-4" />}
          label={sourceName ? `${sourceMode === 'camera' ? 'Cam: ' : 'Vid: '}${sourceName}` : 'No Source Selected'}
        />

        <StatusPill
          id="status-incidents-created"
          active={metrics.created > 0}
          tone="rose"
          icon={<ShieldAlert className="w-4 h-4" />}
          label={`Incidents: ${metrics.created} created (${metrics.saved} saved)`}
        />
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between" id="analyze-error">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-4">✕</button>
        </div>
      )}
      {saveError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm" id="analyze-save-error">
          Live detections running, but database insert warning: {saveError}
        </div>
      )}

      {/* Main Video Viewport & Real-Time Analysis Logs Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch min-h-[460px]">
        {/* Main Video Viewport & Inference Canvas */}
        <div
          className="lg:col-span-8 relative bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center min-h-[440px] max-h-[68vh] border border-slate-800 shadow-xl"
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
            autoPlay
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
            onError={handleVideoError}
            className={`max-h-[68vh] w-auto z-10 ${hasMedia && !isUploadingOnly ? '' : 'hidden'}`}
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

          {/* Upload In Progress State Overlay */}
          {isUploadingOnly && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-6">
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl max-w-sm w-full text-center shadow-2xl">
                <div className="w-12 h-12 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-4">
                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin" />
                </div>
                <h3 className="text-white font-semibold text-base mb-1">Video upload in progress</h3>
                <p className="text-slate-400 text-xs mb-4">
                  Playback will be available when upload completes. You can navigate freely — the upload continues in the background.
                </p>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden mb-2">
                  <div 
                    className="bg-indigo-500 h-full transition-all duration-300" 
                    style={{ width: `${uploadProgress || 20}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-slate-400">{uploadProgress || 20}% completed</span>
              </div>
            </div>
          )}

          {playBlocked && hasMedia && !isUploadingOnly && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-md">
              <div className="bg-slate-900/80 p-8 rounded-3xl border border-white/10 shadow-2xl flex flex-col items-center max-w-sm text-center">
                <div className="bg-indigo-500/20 p-4 rounded-full mb-5">
                  <Play className="w-10 h-10 text-indigo-400 pl-1" />
                </div>
                <h2 className="text-2xl font-bold text-white mb-2">Resume Live Analysis</h2>
                <p className="text-slate-300 mb-6 text-sm">
                  Stream ready. Click below to begin live AI inference.
                </p>
                <button
                  onClick={() => {
                    videoRef.current?.play().then(() => setPlayBlocked(false));
                  }}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 px-6 rounded-xl shadow-lg transition-all cursor-pointer"
                >
                  Start Inference
                </button>
              </div>
            </div>
          )}

          {!hasMedia && !isUploadingOnly && (
            <div className="absolute inset-4 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-700 p-8 text-center text-slate-300">
              <div className="p-4 rounded-full bg-indigo-500/15">
                <Film className="w-10 h-10 text-indigo-400" />
              </div>
              <div>
                <div className="text-lg font-semibold text-white">Select a Camera Stream or Upload an MP4</div>
                <div className="text-sm text-slate-400 mt-1">Real-time object detection and violation tracking will run automatically.</div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={openFilePicker}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg font-medium cursor-pointer shadow-md"
                >
                  <Upload className="w-4 h-4" /> Upload MP4
                </button>
                {cameras.length > 0 && (
                  <button
                    type="button"
                    onClick={() => loadCameraSource(cameras[0].id)}
                    className="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-lg font-medium cursor-pointer border border-slate-700"
                  >
                    <CameraIcon className="w-4 h-4 text-emerald-400" /> Use Camera ({cameras[0].name})
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Live Real-Time Analysis Logs Panel */}
        <div className="lg:col-span-4 flex flex-col h-full min-h-[440px] max-h-[68vh]">
          <AnalysisLogPanel 
            videoId={videoId} 
            cameraId={selectedCameraId}
            className="h-full flex-1"
          />
        </div>
      </div>

      {hasMedia && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
          <div>Active Source: <span className="font-semibold text-slate-800">{sourceName}</span></div>
          {videoId && (
            <Link 
              to={`/app/video-review?video=${videoId}`}
              className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline flex items-center gap-1"
            >
              Open persistent analysis in Video Review →
            </Link>
          )}
        </div>
      )}

      {/* Real Live Metrics Cards */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard 
          label="FPS / Latency" 
          value={<>{fps} <span className="text-sm text-slate-400 font-normal">| {Math.round(inferenceTime)}ms</span></>} 
          color="text-emerald-600" 
        />
        <MetricCard 
          label="Detections" 
          value={metrics.generated.toLocaleString()} 
          color="text-purple-600" 
        />
        <MetricCard 
          label="Incidents" 
          value={<>{metrics.created} <span className="text-sm text-slate-400 font-normal">({metrics.saved} saved)</span></>} 
          color="text-rose-600" 
        />
        <MetricCard 
          label="Tracked Vehicles" 
          value={trackedCount.toLocaleString()} 
          color="text-cyan-600" 
        />
        <MetricCard 
          label="Frames Processed" 
          value={totalProcessedFrames.toLocaleString()} 
          color="text-blue-600" 
        />
        <MetricCard 
          label="Queue Depth" 
          value={queueDepth.toLocaleString()} 
          color="text-slate-700" 
        />
      </div>
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
