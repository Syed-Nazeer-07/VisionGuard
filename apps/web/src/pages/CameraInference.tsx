import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, AlertTriangle, ArrowLeft, Camera, Loader2, Play, Square, VideoOff } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CameraStream } from '../components/cameras/CameraStream';
import { getCameraPlaybackSource, type CameraSourceRecord } from '../services/cameraSources';
import { CAMERA_INFERENCE_FLAGS, CAMERA_MODEL_PATH, cameraFrameDecision, liveModelPreflightResponse } from '../services/cameraInferencePolicy';
import { InferenceCoordinator } from '../pipeline/worker/inferenceCoordinator';
import { WORKER_STALL_RESTART_MS, shouldStopAfterInferenceErrors } from '../pipeline/worker/frameSync';
import { drawBoundingBoxes } from '../pipeline/rendering/overlay';
import type { ResultMessage, WorkerOutputMessage, WorkerMessage } from '../pipeline/types';

type CameraRecord = CameraSourceRecord & {
  id: string;
  name: string;
  location?: string | null;
  is_deleted?: boolean | null;
};

interface CameraInferenceStats {
  processed: number;
  dropped: number;
  detections: number;
  tracks: number;
  latencyMs: number;
}
const EMPTY_STATS: CameraInferenceStats = {
  processed: 0, dropped: 0, detections: 0, tracks: 0, latencyMs: 0
};
const VEHICLE_CLASSES = new Set(['car', 'bus', 'truck', 'motorcycle', 'bicycle']);

/** Video presentation timestamps use the monotonic browser performance clock.
 * HLS mediaTime can jump backwards after discontinuities; the worker receives
 * presentation time instead. Camera speeds, rule violations and evidence
 * recording are deliberately disabled until real calibration + authorization.
 */
function CameraInferencePlayer({ camera }: { camera: CameraRecord }) {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [streamState, setStreamState] = useState<'connecting' | 'playing' | 'error'>('connecting');
  const [running, setRunning] = useState(false);
  const [modelState, setModelState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [provider, setProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<CameraInferenceStats>(EMPTY_STATS);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const onElement = useCallback((element: HTMLVideoElement | null) => {
    setVideoElement(element);
  }, []);

  useEffect(() => {
    if (!running || !videoElement) return;
    const coordinator = new InferenceCoordinator<void>();
    let disposed = false;
    let worker: Worker | null = null;
    let modelReady = false;
    let lastSubmittedTime = Number.NEGATIVE_INFINITY;
    let lastFallbackMediaTime = Number.NEGATIVE_INFINITY;
    let capturePending = false;
    let result: ResultMessage | null = null;
    let videoFrameHandle: number | null = null;
    let fallbackHandle: number | null = null;
    let renderHandle: number | null = null;
    let stallHandle: number | null = null;

    setModelState('loading');
    setError(null);
    setProvider(null);
    setStats(EMPTY_STATS);

    const stopWithError = (message: string) => {
      if (disposed) return;
      setError(message);
      setModelState('error');
      setRunning(false);
    };

    const draw = () => {
      if (disposed) return;
      const canvas = overlayRef.current;
      const ctx = canvas?.getContext('2d');
      if (canvas && ctx) {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        if (!result || videoElement.paused || videoElement.readyState < 2) {
          ctx.clearRect(0, 0, width, height);
        } else {
          drawBoundingBoxes(
            ctx, result.tracks, width, height,
            result.sourceWidth, result.sourceHeight,
            false, Math.max(0, performance.now() / 1000 - result.mediaTime)
          );
        }
      }
      renderHandle = requestAnimationFrame(draw);
    };

    const submit = async (presentationTimeSeconds: number) => {
      if (disposed || !worker) return;
      const decision = cameraFrameDecision({
        running: true, modelReady,
        playing: !videoElement.paused && !videoElement.ended,
        hasFrame: videoElement.readyState >= 2 && videoElement.videoWidth > 0 && videoElement.videoHeight > 0,
        workerBusy: coordinator.busy || capturePending,
        timestampSeconds: presentationTimeSeconds,
        lastSubmittedTimeSeconds: lastSubmittedTime
      });
      if (decision === 'skip') return;
      if (decision === 'drop') {
        coordinator.noteDropped();
        return;
      }
      const request = coordinator.tryBegin(presentationTimeSeconds, undefined, performance.now());
      if (!request) return;
      capturePending = true;
      let bitmap: ImageBitmap | null = null;
      try {
        // createImageBitmap rejects tainted/unauthorized cross-origin streams.
        // Do not silently continue with fabricated detection results on CORS errors.
        bitmap = await createImageBitmap(videoElement);
        if (disposed) { bitmap.close(); coordinator.cancel(request.frameId); return; }
        const message: WorkerMessage = {
          type: 'inference', bitmap,
          mediaTime: request.mediaTime,
          frameId: request.frameId,
          sourceGeneration: request.sourceGeneration,
          sourceWidth: bitmap.width, sourceHeight: bitmap.height,
          featureFlags: { ...CAMERA_INFERENCE_FLAGS },
          confidenceThreshold: 0.35, iouThreshold: 0.45,
          collectEvidence: false
        };
        worker.postMessage(message, [bitmap]);
        bitmap = null; // ownership transferred to worker
        lastSubmittedTime = request.mediaTime;
      } catch (e) {
        bitmap?.close();
        coordinator.cancel(request.frameId);
        const detail = e instanceof Error ? e.message : String(e);
        stopWithError(`Could not capture a camera frame for AI inference. Check HLS segment CORS and video codec support. ${detail}`);
      } finally {
        capturePending = false;
      }
    };

    // requestVideoFrameCallback means each submitted bitmap represents a newly
    // decoded frame. Fallback checks changing mediaTime to avoid repeated frames.
    const scheduleFrames = () => {
      if (disposed) return;
      if ('requestVideoFrameCallback' in videoElement) {
        videoFrameHandle = videoElement.requestVideoFrameCallback((_now, metadata) => {
          if (disposed) return;
          void submit(metadata.presentationTime / 1000);
          scheduleFrames();
        });
      } else {
        fallbackHandle = window.setInterval(() => {
          if (disposed || videoElement.paused || videoElement.readyState < 2) return;
          if (!Number.isFinite(videoElement.currentTime) || videoElement.currentTime === lastFallbackMediaTime) return;
          lastFallbackMediaTime = videoElement.currentTime;
          void submit(performance.now() / 1000);
        }, 100);
      }
    };

    const prepareModel = async () => {
      try {
        const response = await fetch(CAMERA_MODEL_PATH, { method: 'HEAD', cache: 'no-store' });
        const unavailable = liveModelPreflightResponse(response.ok, response.headers.get('content-type'), response.status);
        if (unavailable) { stopWithError(unavailable); return; }
        if (disposed) return;
        worker = new Worker(new URL('../pipeline/worker/index.ts', import.meta.url), { type: 'module' });
        worker.onerror = event => stopWithError(`YOLO worker error: ${event.message || 'Worker crashed'}`);
        worker.onmessage = (event: MessageEvent<WorkerOutputMessage>) => {
          if (disposed) return;
          const msg = event.data;
          if (msg.type === 'ready') {
            modelReady = true;
            setModelState('ready');
            setProvider(msg.provider);
            return;
          }
          if (msg.type === 'error') {
            if (msg.phase === 'init') {
              stopWithError(`Failed to initialize YOLO model: ${msg.error}`);
            } else {
              const failure = coordinator.fail(msg.frameId);
              if (failure.released && shouldStopAfterInferenceErrors(coordinator.counters.consecutiveErrors)) {
                stopWithError(`Camera inference stopped after repeated errors: ${msg.error}`);
              }
            }
            return;
          }
          const accepted = coordinator.accept(msg, true);
          if (accepted.status !== 'accepted') return;
          result = msg;
          setStats({
            processed: coordinator.counters.accepted,
            dropped: coordinator.counters.dropped,
            detections: msg.detectionCount,
            tracks: msg.tracks.filter(t => VEHICLE_CLASSES.has(t.className)).length,
            latencyMs: msg.inferenceTime
          });
        };
        worker.postMessage({ type: 'init', modelPath: CAMERA_MODEL_PATH } satisfies WorkerMessage);
      } catch (e) {
        stopWithError(`Camera AI could not start: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    renderHandle = requestAnimationFrame(draw);
    scheduleFrames();
    stallHandle = window.setInterval(() => {
      if (coordinator.busy && coordinator.inflightAgeMs(performance.now()) > WORKER_STALL_RESTART_MS) {
        stopWithError('The YOLO worker stopped responding. Stop and restart camera detection.');
      }
    }, 2000);
    void prepareModel();

    return () => {
      disposed = true;
      coordinator.invalidate();
      if (videoFrameHandle !== null && 'cancelVideoFrameCallback' in videoElement) {
        videoElement.cancelVideoFrameCallback(videoFrameHandle);
      }
      if (fallbackHandle !== null) clearInterval(fallbackHandle);
      if (renderHandle !== null) cancelAnimationFrame(renderHandle);
      if (stallHandle !== null) clearInterval(stallHandle);
      worker?.terminate();
      const canvas = overlayRef.current;
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [running, videoElement]);

  return (
    <div className="space-y-4">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950 border border-slate-800">
        <CameraStream camera={camera} controls onVideoElement={onElement}
          onPlayback={(state, reason) => {
            setStreamState(state === 'playing' ? 'playing' : 'error');
            if (state === 'error') {
              setError(reason || 'Camera playback is unavailable.');
              setRunning(false);
            }
          }} />
        <canvas ref={overlayRef} aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none z-10" />
        <div className="absolute top-3 left-3 z-20 bg-slate-950/90 text-white px-3 py-1 rounded text-xs">
          {running && modelState === 'ready' ? 'Live AI detection · browser only' : 'Camera preview'}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {!running ? (
          <button type="button" onClick={() => { setError(null); setRunning(true); }}
            disabled={streamState !== 'playing' || !videoElement}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 font-semibold text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
            <Play className="w-4 h-4" /> Start AI Detection
          </button>
        ) : (
          <button type="button" onClick={() => { setRunning(false); setModelState('idle'); }}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 font-semibold text-sm text-white bg-slate-900 hover:bg-slate-800">
            <Square className="w-4 h-4" /> Stop Detection
          </button>
        )}
        <span className="text-xs text-slate-600">
          Stream: {streamState} · Model: {modelState}{provider ? ` (${provider})` : ''}
        </span>
      </div>
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {([
          ['Frames analyzed', stats.processed],
          ['Latest detections', stats.detections],
          ['Active vehicles', stats.tracks],
          ['Dropped frames', stats.dropped],
          ['Inference latency', `${stats.latencyMs.toFixed(0)} ms`]
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-[11px] text-slate-500">{label}</div>
            <div className="text-lg font-bold text-slate-900 mt-1">{value}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-600">
        Preview-only detection. No speed estimates, penalties, OCR, snapshots, database incidents,
        or historical recordings are created. Camera scene calibration is not yet applied to these results.
      </p>
    </div>
  );
}

export default function CameraInference() {
  const { id } = useParams<{ id: string }>();
  const [camera, setCamera] = useState<CameraRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setCamera(null);
    if (!id) { setError('No camera ID selected.'); setLoading(false); return; }
    void (async () => {
      const { data, error: dbError } = await supabase.from('cameras')
        .select('*').eq('id', id).eq('is_deleted', false).maybeSingle();
      if (cancelled) return;
      if (dbError || !data) setError(dbError?.message || 'Camera not found or access denied.');
      else setCamera(data as CameraRecord);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  const source = getCameraPlaybackSource(camera);
  return (
    <div className="space-y-5 max-w-6xl mx-auto pb-8">
      <Link to="/app/monitor" className="inline-flex items-center gap-2 text-sm text-blue-700 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Camera Monitor
      </Link>
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Activity className="w-6 h-6 text-blue-600" /> Camera AI Detection
        </h1>
        <p className="text-slate-600 text-sm mt-1">
          Browser YOLO + ByteTrack experiment for one HLS source. No data is written to Supabase.
        </p>
      </header>
      {loading ? (
        <div className="min-h-64 flex items-center justify-center gap-2 text-slate-600">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading selected camera…
        </div>
      ) : error ? (
        <div role="alert" className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 p-4">{error}</div>
      ) : !source.playable ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-2">
          <VideoOff className="text-amber-700 w-7 h-7" />
          <h2 className="font-bold text-amber-950">{camera?.name || 'Camera'} cannot be analyzed in this browser</h2>
          <p className="text-sm text-amber-900">{source.reason}</p>
          <p className="text-sm text-amber-800">Convert the feed to an authorized, CORS-enabled HLS stream first.</p>
        </div>
      ) : camera ? (
        <>
          <div className="flex gap-2 text-sm items-center text-slate-700">
            <Camera className="w-4 h-4" /> <strong>{camera.name}</strong>
            {camera.location ? <span>· {camera.location}</span> : null}
          </div>
          <CameraInferencePlayer key={camera.id} camera={camera} />
        </>
      ) : null}
    </div>
  );
}
