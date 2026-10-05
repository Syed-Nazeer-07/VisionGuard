import React, { useEffect, useRef, useState } from 'react';
import { Upload, Cpu, CheckCircle2, Loader2, Activity, ShieldAlert, AlertTriangle, Film, Play } from 'lucide-react';
import { drawBoundingBoxes } from '../pipeline/rendering/overlay';
import type { WorkerOutputMessage } from '../pipeline/types';
import { db } from '../services/db';
import { requestOcr } from '../pipeline/plate/service';
import { evidenceQueue } from '../pipeline/evidence/queue';
import { supabase } from '../lib/supabase';
import Hls from 'hls.js';

type ModelStatus = 'loading' | 'ready' | 'error';

export default function Analyze() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [modelStatus, setModelStatus] = useState<ModelStatus>('loading');
  const [provider, setProvider] = useState<string>('');
  const [fps, setFps] = useState<number>(0);
  const [inferenceTime, setInferenceTime] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoName, setVideoName] = useState<string>('');
  const [totalProcessedFrames, setTotalProcessedFrames] = useState(0);
  const [metrics, setMetrics] = useState({ generated: 0, created: 0, suppressed: 0, saved: 0 });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<any[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [playBlocked, setPlayBlocked] = useState<boolean>(false);

  // Refs mirror state so worker / frame callbacks never read stale values
  const modelReadyRef = useRef(false);
  const isProcessingRef = useRef(false);
  const loopActiveRef = useRef(false);
  const settingsRef = useRef<Record<string, any>>({});
  const cameraIdRef = useRef<string | null>(null);
  const inferenceTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(performance.now());
  const isWorkerBusyRef = useRef(false);
  const busySinceRef = useRef(0);
  const dedupeCache = useRef(new Map<string, number>());
  const incidentQueueRef = useRef<any[]>([]);
  const analysisRunIdRef = useRef<string | null>(null);
  const pipelineMetricsRef = useRef({
    framesProcessed: 0,
    detectionsGenerated: 0,
    incidentsCreated: 0,
    incidentsSuppressed: 0,
    incidentsSaved: 0
  });
  const videoIdRef = useRef<string | null>(null);
  const trackedObjectsRef = useRef<Map<number, any>>(new Map());

  useEffect(() => {
    db.settings.list().then(s => { settingsRef.current = s || {}; }).catch(() => {});
    db.cameras.list().then(c => {
      setCameras(c || []);
      const urlParams = new URLSearchParams(window.location.search);
      const camId = urlParams.get('camera');
      const vidId = urlParams.get('video');
      
      if (vidId) {
        setTimeout(() => loadVideoAsset(vidId), 100);
      } else if (camId && c?.find((cam: any) => cam.id === camId)) {
        setTimeout(() => {
          setSelectedCameraId(camId);
          cameraIdRef.current = camId;
          // // const fakeEvent = { target: { value: camId } } as any;
          // We can't call handleCameraSelect directly since it depends on the updated cameras state which might not be closed over yet.
          // Let's just set the selectedCameraId and let an effect handle the auto-play.
        }, 100);
      }
    }).catch(() => {});

    const channel = supabase.channel('analyze-settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => {
        db.settings.list().then(s => { settingsRef.current = s || {}; }).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras' }, () => {
        db.cameras.list().then(c => setCameras(c || [])).catch(() => {});
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    cameraIdRef.current = selectedCameraId || null;
    if (selectedCameraId && cameras.length > 0 && selectedCameraId !== loadedCameraIdRef.current) {
      loadCamera(selectedCameraId);
    }
  }, [selectedCameraId, cameras]);

  useEffect(() => {
    videoIdRef.current = videoId;
  }, [videoId]);

  const flushIncidents = async () => {
    if (incidentQueueRef.current.length === 0) return;
    const toFlush = [...incidentQueueRef.current];
    incidentQueueRef.current = [];

    const rows = toFlush.map(t => t.incident);
    const { data, error: insErr } = await (supabase as any).from('incidents').insert(rows).select();
    if (insErr) {
      console.warn('Incident insert failed:', insErr);
      setSaveError(insErr.message || 'Failed to save incidents');
      return;
    }
    setSaveError(null);
    const created: any[] = data || [];
    pipelineMetricsRef.current.incidentsSaved += created.length;

    created.forEach((inc: any, index: number) => {
      const src = toFlush[index];
      src.evidence.forEach((ev: any) => {
        evidenceQueue.add({
          incident_id: inc.id,
          camera_id: inc.camera_id ?? null,
          video_id: videoIdRef.current ?? null,
          base64Data: ev.base64,
          type: ev.type,
          capture_timestamp: src.timestamp
        });
      });
      // Legacy violations table requires a camera
      if (inc.camera_id || videoIdRef.current) {
        (supabase as any).from('violations').insert({
          camera_id: inc.camera_id,
          video_id: videoIdRef.current,
          type: src.type,
          severity: src.severity,
          status: 'pending',
          timestamp: src.timestamp,
          metadata: src.metadata
        }).then(() => {}, () => {});
      }
    });
  };

  const updateFps = () => {
    frameCountRef.current += 1;
    pipelineMetricsRef.current.framesProcessed += 1;

    const now = performance.now();
    const elapsed = now - lastFpsTimeRef.current;
    if (elapsed >= 1000) {
      const currentFps = Math.round((frameCountRef.current * 1000) / elapsed);
      setFps(currentFps);
      setTotalProcessedFrames(pipelineMetricsRef.current.framesProcessed);
      setMetrics({
        generated: pipelineMetricsRef.current.detectionsGenerated,
        created: pipelineMetricsRef.current.incidentsCreated,
        suppressed: pipelineMetricsRef.current.incidentsSuppressed,
        saved: pipelineMetricsRef.current.incidentsSaved
      });

      if (analysisRunIdRef.current) {
        db.analysisRuns.update(analysisRunIdRef.current, {
          metrics: {
            ...pipelineMetricsRef.current,
            fps: currentFps,
            latency: inferenceTimeRef.current,
            queue_depth: incidentQueueRef.current.length
          } as any
        }).catch(() => {});
      }

      flushIncidents();
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }
  };

  const handleViolations = (violations: any[]) => {
    const now = Date.now();
    const camId = cameraIdRef.current;

    violations.forEach(async (v: any) => {
      pipelineMetricsRef.current.detectionsGenerated++;
      const meta = (v.metadata || {}) as any;
      const conf = meta.confidence ?? 1.0;
      if (conf < 0.6) return;

      const dedupeKey = `${camId ?? 'upload'}_${v.type}_${meta.track_id}`;
      const lastSeen = dedupeCache.current.get(dedupeKey);
      if (lastSeen && now - lastSeen < 10000) {
        pipelineMetricsRef.current.incidentsSuppressed++;
        return;
      }
      dedupeCache.current.set(dedupeKey, now);
      pipelineMetricsRef.current.incidentsCreated++;

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

        incidentQueueRef.current.push({
          type: v.type,
          severity: v.severity || 'medium',
          timestamp: ts,
          metadata: meta,
          incident: {
            incident_type: v.type,
            severity: v.severity || 'medium',
            status: 'Active',
            camera_id: camId,
            video_id: videoIdRef.current,
            location: cam?.location || cam?.name || 'Uploaded video',
            description: `${String(v.type).replace(/_/g, ' ')} detected (track #${meta.track_id ?? '?'}, confidence ${(conf * 100).toFixed(0)}%)${videoName ? ` in ${videoName}` : ''}`
          },
          evidence: [
            snapshotBase64 && snapshotBase64.startsWith('data:image') ? { type: 'snapshot', base64: snapshotBase64 } : null,
            plateCropBase64 && plateCropBase64.startsWith('data:image') ? { type: 'plate_crop', base64: plateCropBase64 } : null
          ].filter(Boolean)
        });
      } catch (err) {
        console.warn('Failed to queue incident:', err);
      }
    });
  };

  // Keep latest handler reachable from the worker without re-creating it
  const violationHandlerRef = useRef(handleViolations);
  violationHandlerRef.current = handleViolations;
  const fpsHandlerRef = useRef(updateFps);
  fpsHandlerRef.current = updateFps;

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../pipeline/worker/index.ts', import.meta.url), { type: 'module' });
    } catch (e: any) {
      setModelStatus('error');
      setError(`Failed to start detection worker: ${e?.message || e}`);
      return;
    }
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOutputMessage>) => {
      const msg: any = e.data;
      if (msg.type === 'ready') {
        modelReadyRef.current = true;
        setModelStatus('ready');
        setProvider(msg.provider || '');
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
        
        // Track objects for persistence
        const nowTime = videoRef.current ? videoRef.current.currentTime : 0;
        msg.tracks.forEach((t: any) => {
          let rec = trackedObjectsRef.current.get(t.trackId);
          if (!rec) {
            rec = {
              track_id: t.trackId,
              object_type: t.className,
              confidence: t.prob,
              first_seen_timestamp: nowTime,
              last_seen_timestamp: nowTime,
              frame_count: 0
            };
            trackedObjectsRef.current.set(t.trackId, rec);
          }
          rec.last_seen_timestamp = nowTime;
          rec.frame_count++;
          rec.confidence = Math.max(rec.confidence, t.prob);
        });

        fpsHandlerRef.current();
        if (msg.violations && msg.violations.length > 0) {
          violationHandlerRef.current(msg.violations);
        }
      } else if (msg.type === 'error') {
        isWorkerBusyRef.current = false;
        if (!modelReadyRef.current) setModelStatus('error');
        setError(msg.error);
      }
    };
    worker.onerror = (ev) => {
      if (!modelReadyRef.current) setModelStatus('error');
      setError(`Detection worker error: ${ev.message || (ev.error?.message) || 'unknown'}`);
    };

    worker.postMessage({ type: 'init', modelPath: '/models/yolo11n.onnx' });

    return () => {
      worker.terminate();
      workerRef.current = null;
      hlsRef.current?.destroy();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

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

    // Recover from a stuck worker
    if (isWorkerBusyRef.current && performance.now() - busySinceRef.current > 5000) {
      isWorkerBusyRef.current = false;
    }

    if (!isWorkerBusyRef.current && modelReadyRef.current && video.readyState >= 3 && video.currentTime > 0) {
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
        console.warn('Failed to create ImageBitmap', err);
      }
    }

    scheduleNext(video);
  };

  const startLoop = () => {
    if (loopActiveRef.current) return;
    loopActiveRef.current = true;
    processFrame();
  };

  const resetSession = () => {
    workerRef.current?.postMessage({ type: 'reset_tracker' });
    dedupeCache.current.clear();
    trackedObjectsRef.current.clear();
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const loadVideoAsset = async (vidId: string) => {
    setIsProcessing(true);
    setUploadProgress(10);
    try {
      const { data, error } = await (supabase as any).from('video_assets').select('*').eq('id', vidId).single();
      if (error || !data) throw new Error('Video not found');
      
      setVideoId(data.id);
      
      const { data: urlData } = supabase.storage.from('videos').getPublicUrl(data.storage_path);
      if (!urlData) throw new Error('Could not get public URL');
      
      setUploadProgress(100);
      loadUrl(urlData.publicUrl, data.filename);
      setTimeout(() => setUploadProgress(0), 1000);
    } catch (err: any) {
      setError(`Failed to load video: ${err.message}`);
      setIsProcessing(false);
      setUploadProgress(0);
    }
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const loadUrl = (url: string, name: string) => {
    const video = videoRef.current;
    if (!video) return;
    setError(null);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    setSelectedCameraId('');
    cameraIdRef.current = null;
    setVideoName(name);
    resetSession();
    video.src = url;
    video.load();
    video.play().then(() => {
      setPlayBlocked(false);
    }).catch((err) => {
      console.warn('Autoplay blocked:', err);
      setPlayBlocked(true);
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      setError('Please select a video file (MP4 recommended).');
      return;
    }

    try {
      setIsProcessing(true);
      setError(null);
      setUploadProgress(10);
      
      // COEP bypass: Create local object URL for immediate same-origin playback
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;
      loadUrl(url, file.name);
      
      // Background upload to Supabase Storage for persistence
      const fileExt = file.name.split('.').pop();
      const filename = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      
      supabase.storage.from('videos').upload(filename, file).then(async ({ error: uploadErr }: any) => {
        if (uploadErr) {
          console.warn('Background upload failed', uploadErr);
          return;
        }
        setUploadProgress(70);

        const { data: dbData, error: dbErr } = await (supabase as any).from('video_assets').insert({
          filename: file.name,
          storage_path: filename,
          file_size: file.size,
        }).select().single();
        
        if (dbErr) {
          console.warn('DB insert failed', dbErr);
          return;
        }

        setVideoId(dbData.id);
        setUploadProgress(100);
        setTimeout(() => setUploadProgress(0), 2000);
      });
      
    } catch(err: any) {
      setError(`Upload setup failed: ${err.message}`);
      setIsProcessing(false);
      setUploadProgress(0);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      // Simulate input event
      await handleFileUpload({ target: { files: [file], value: '' } } as any);
    }
  };

  const loadedCameraIdRef = useRef<string | null>(null);

  const loadCamera = (camId: string) => {
    if (loadedCameraIdRef.current === camId) return;
    loadedCameraIdRef.current = camId;
    cameraIdRef.current = camId || null;
    const cam = cameras.find(c => c.id === camId);
    const video = videoRef.current;
    if (!cam || !video) return;

    const url = cam.source_url || cam.stream_url;
    if (!url) {
      setError('Selected camera does not have a valid source URL configured.');
      return;
    }
    setError(null);
    setVideoName(cam.name);
    resetSession();
    hlsRef.current?.destroy();
    hlsRef.current = null;

    if (cam.source_type === 'hls' || url.endsWith('.m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      } else {
        video.src = url;
        video.play().catch(() => {});
      }
    } else {
      video.src = url;
      video.play().catch(() => {});
    }
  };

  const handlePlay = async () => {
    console.log(`video.onplay triggered | src: ${videoRef.current?.src.substring(0, 50)}... | readyState: ${videoRef.current?.readyState} | networkState: ${videoRef.current?.networkState} | error: ${videoRef.current?.error?.message}`);
    setPlayBlocked(false);
    setError(prev => (prev && prev.startsWith('Autoplay') ? null : prev));
    isProcessingRef.current = true;
    setIsProcessing(true);
    startLoop();
    const camId = cameraIdRef.current;
    if (!analysisRunIdRef.current && (camId || videoIdRef.current)) {
      try {
        const run = await db.analysisRuns.create({
          camera_id: camId || 'video-upload',
          started_at: new Date().toISOString(),
          status: 'running',
          metrics: {}
        });
        analysisRunIdRef.current = run.id;
      } catch { /* optional */ }
    }
  };

  const handlePause = async () => {
    console.log('video.onpause triggered');
    isProcessingRef.current = false;
    setIsProcessing(false);
    await flushIncidents();
    
    // Save tracked objects
    if (videoIdRef.current && trackedObjectsRef.current.size > 0) {
      const rows = Array.from(trackedObjectsRef.current.values()).map(r => ({
        video_id: videoIdRef.current,
        ...r
      }));
      try {
        await (supabase as any).from('tracked_objects').insert(rows);
        trackedObjectsRef.current.clear(); // only insert once
      } catch (err) {
        console.warn('Failed to save tracked objects', err);
      }
    }

    if (analysisRunIdRef.current) {
      await db.analysisRuns.update(analysisRunIdRef.current, {
        ended_at: new Date().toISOString(),
        status: 'stopped',
        metrics: { ...pipelineMetricsRef.current, fps, latency: inferenceTimeRef.current } as any
      }).catch(() => {});
      analysisRunIdRef.current = null;
    }
  };

  const hasVideo = !!videoName;
  const waitingForModel = isProcessing && modelStatus === 'loading';

  return (
    <div className="flex-1 p-6 md:p-8 overflow-y-auto">
      <header className="mb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-1">Live Analysis</h1>
          <p className="text-slate-500">Upload an MP4 and run YOLO11n detection directly in your browser. No camera setup required.</p>
        </div>
        <button
          id="analyze-upload-video-btn"
          type="button"
          onClick={openFilePicker}
          className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98] text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-indigo-500/30 transition-all"
        >
          <Upload className="w-5 h-5" />
          Upload Video
        </button>
        <input
          id="analyze-file-input"
          ref={fileInputRef}
          type="file"
          accept="video/mp4,video/*"
          className="hidden"
          onChange={handleFileUpload}
        />
      </header>

      {/* Status indicators */}
      <div className="mb-6 grid grid-cols-2 lg:grid-cols-4 gap-3" id="analyze-status-bar">
        <StatusPill
          id="status-model-loading"
          active={modelStatus === 'loading'}
          tone={modelStatus === 'error' ? 'red' : 'amber'}
          icon={modelStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : modelStatus === 'error' ? <AlertTriangle className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
          label={modelStatus === 'error' ? 'Model Failed' : modelStatus === 'loading' ? 'Model Loading…' : 'Model Loaded'}
        />
        <StatusPill
          id="status-model-ready"
          active={modelStatus === 'ready'}
          tone="green"
          icon={<CheckCircle2 className="w-4 h-4" />}
          label={modelStatus === 'ready' ? `Model Ready${provider ? ` · ${provider.toUpperCase()}` : ''}` : 'Model Not Ready'}
        />
        <StatusPill
          id="status-processing"
          active={isProcessing || uploadProgress > 0}
          tone="indigo"
          icon={<Activity className={`w-4 h-4 ${(isProcessing && !waitingForModel) || uploadProgress > 0 ? 'animate-pulse' : ''}`} />}
          label={uploadProgress > 0 ? `Uploading... ${uploadProgress}%` : waitingForModel ? 'Waiting for model…' : isProcessing ? `Processing · ${fps} FPS` : hasVideo ? 'Paused' : 'Idle'}
        />
        <StatusPill
          id="status-incidents-created"
          active={metrics.created > 0}
          tone="rose"
          icon={<ShieldAlert className="w-4 h-4" />}
          label={`Incidents Created: ${metrics.created}${metrics.saved ? ` (${metrics.saved} saved)` : ''}`}
        />
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" id="analyze-error">
          {error}
        </div>
      )}
      {saveError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm" id="analyze-save-error">
          Detections are running, but incidents could not be saved: {saveError}
        </div>
      )}

      <div
        className="relative bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center min-h-[420px] border border-slate-200 shadow-xl"
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
          onEnded={handlePause}
          onLoadedMetadata={() => console.log('video.onloadedmetadata triggered')}
          onTimeUpdate={(e) => {
            if (frameCountRef.current % 30 === 0) {
              console.log('video.currentTime:', e.currentTarget.currentTime);
            }
          }}
          className={`max-h-[65vh] w-auto z-10 ${hasVideo ? '' : 'hidden'}`}
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
        {playBlocked && hasVideo && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="bg-slate-900/60 p-8 rounded-3xl border border-white/10 shadow-2xl flex flex-col items-center max-w-sm text-center transform transition-all">
              <div className="bg-indigo-500/20 p-4 rounded-full mb-5">
                <Play className="w-10 h-10 text-indigo-400 pl-1" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-3">Start AI Analysis</h2>
              <p className="text-slate-300 mb-8 text-sm leading-relaxed">
                Upload complete. Click below to begin video playback and initialize object detection.
              </p>
              <button
                onClick={() => {
                  videoRef.current?.play().then(() => setPlayBlocked(false));
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3.5 px-6 rounded-xl shadow-[0_0_30px_rgba(79,70,229,0.3)] transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Start Analysis
              </button>
            </div>
          </div>
        )}
        {!hasVideo && (
          <button
            type="button"
            id="analyze-dropzone"
            onClick={openFilePicker}
            className="absolute inset-4 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-700 hover:border-indigo-400 hover:bg-indigo-500/5 text-slate-300 transition-colors"
          >
            <div className="p-4 rounded-full bg-indigo-500/15">
              <Film className="w-10 h-10 text-indigo-400" />
            </div>
            <div className="text-lg font-semibold text-white">Upload an MP4 to start detection</div>
            <div className="text-sm text-slate-400">Click here or drag & drop a video file</div>
            <span className="inline-flex items-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg font-medium">
              <Upload className="w-4 h-4" /> Upload Video
            </span>
          </button>
        )}
      </div>

      {hasVideo && (
        <div className="mt-3 text-sm text-slate-500">Source: <span className="font-medium text-slate-700">{videoName}</span></div>
      )}

      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="FPS / Latency" value={<>{fps} <span className="text-lg text-slate-400">| {Math.round(inferenceTime)}ms</span></>} color="text-emerald-600" />
        <MetricCard label="Frames Processed" value={totalProcessedFrames.toLocaleString()} color="text-blue-600" />
        <MetricCard label="Detections Generated" value={metrics.generated.toLocaleString()} color="text-purple-600" />
        <MetricCard label="Incidents (Created / Suppressed)" value={<>{metrics.created.toLocaleString()} <span className="text-lg text-slate-400">/ {metrics.suppressed.toLocaleString()}</span></>} color="text-rose-600" />
      </div>

      {cameras.length > 0 && (
        <details className="mt-6 bg-white border border-slate-200 rounded-xl p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Advanced: analyze a configured camera source instead</summary>
          <select
            id="analyze-camera-select"
            className="mt-3 w-full bg-white border border-slate-300 text-slate-900 rounded-lg px-3 py-2 text-sm"
            value={selectedCameraId}
            onChange={(e) => setSelectedCameraId(e.target.value)}
          >
            <option value="">-- Choose a camera --</option>
            {cameras.map(cam => (
              <option key={cam.id} value={cam.id} disabled={!cam.source_url && !cam.stream_url}>
                {cam.name} {(!cam.source_url && !cam.stream_url) ? '(No URL)' : ''}
              </option>
            ))}
          </select>
        </details>
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
      className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${active ? TONES[tone] : 'bg-white text-slate-400 border-slate-200'}`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
      <div className="text-slate-500 text-sm mb-1">{label}</div>
      <div className={`text-3xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
