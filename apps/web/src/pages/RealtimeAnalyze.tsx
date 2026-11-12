import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAnalysisFocus } from '../components/analysis/useAnalysisFocus';
import { Activity, AlertTriangle, Camera, ChevronDown, Cloud, Cpu, ExternalLink, Film, Gauge, HardDrive, Info, Maximize2, Minimize2, MonitorPlay, Play, RefreshCw, ScanLine, Upload, X } from 'lucide-react';
import { hiddenPagePolicy, shouldResumeSharedTab, keepCaptureAcrossPages } from '../services/captureVisibility';
import { ExpiredLocalVideoPermissionError, localAnalysisStorage } from '../services/localAnalysisStorage';
import { describeCloudVideoFailure } from '../services/cloudVideoFeedback';
import { savedLocalMatchesArchive } from '../services/localVideoRecovery';
import { placeLiveLabel } from '../pipeline/rendering/liveLabelPlacement';
import { vehicleOverlayLabels } from '../pipeline/rendering/vehicleOverlayLabels';
import { displayedVideoMediaTime } from '../pipeline/worker/frameSync';
import { canReanalyzeStoredVideo } from '../lib/videoAssets';
import { uploadManager, type ActiveUpload } from '../services/uploadManager';
import { isB2UploadConfigured, storageProviderFor, uploadStorageProvider } from '../services/videoStorage';
import { supabase } from '../lib/supabase';
import { activityLedger } from '../services/activityLedger';
import { fastestVisibleEstimate } from '../services/analysisMetrics';
import { appendQualityFrame, serializeQualityTrace, type QualityFrame } from '../services/qualityTrace';
import { AutomaticIncidentDetector } from '../services/automaticIncidentDetector';
import { resolveDeployedModelUrl } from '../services/modelUrl';
import { hasAdvancedVideoFrame, isLiveFrameDiscontinuity, isStreamStalled, shouldPaintLiveOverlay } from '../services/streamRecovery';
import { useAuthStore } from '../store/auth';
import { advanceOpticalTracks, takeGrayFrame, type GrayFrame } from '../pipeline/tracker/opticalTracking';
import { reconcileVehicles, recoverBriefOpticalMisses, updateScreenSpeed, type PersistentTrack, type SpeedHistory } from '../pipeline/tracker/stableVehicles';
import {
  projectLiveTracks, type LiveTrack
} from '../pipeline/tracker/liveProjection';

// A separate, public HTTPS model host (for example R2) avoids Pages' 25 MiB
// per-asset limit. A local model remains convenient during development.
const MODEL_PATH = resolveDeployedModelUrl(import.meta.env.VITE_YOLO_MODEL_URL, import.meta.env.PROD);
const MIN_CAPTURE_INTERVAL = 0.12;
const OPTICAL_INTERVAL = 0.085;
const HISTORY_WINDOW = 3.5;
const MAX_CAPTURE_WIDTH = 640;
const WORKER_TIMEOUT_MS = 20_000;

type WorkerEvent =
  | { type: 'ready'; provider: string; fallbackReason?: string }
  | { type: 'result'; requestId: number; generation: number; mediaTime: number; tracks: LiveTrack[]; detectionCount: number; inferenceMs: number; provider: string }
  | { type: 'skipped'; requestId: number; generation: number }
  | { type: 'error'; requestId: number; generation: number; message: string };

type DetectorState = 'idle' | 'loading' | 'ready' | 'error';
type StreamHealth = 'idle' | 'connecting' | 'playing' | 'buffering' | 'reconnecting' | 'ended' | 'error';
const STREAM_STALL_MS = 15_000;
const BROWSER_CAMERA_SOURCE = 'visionguard:browser-camera';
const BROWSER_TAB_SOURCE = 'visionguard:shared-browser-tab';

function readableTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' +
    (seconds % 60).toString().padStart(2, '0');
}

type Observation = { time: number; tracks: LiveTrack[] };

export default function RealtimeAnalyze({ active = true }: { active?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const qualityEnabled = new URLSearchParams(location.search).get('quality') === '1';
  const qualityEnabledRef = useRef(false);
  qualityEnabledRef.current = qualityEnabled;
  const qualityFramesRef = useRef<QualityFrame[]>([]);
  const ownerId = useAuthStore(state => state.user?.id ?? null);
  const activeRunRef = useRef('');
  const currentFileRef = useRef<File | null>(null);
  const [saveVideo, setSaveVideo] = useState(false);
  const cloudUploadIdRef = useRef<string | null>(null);
  const cloudUnsubscribeRef = useRef<(() => void) | null>(null);
  const [cloudUpload, setCloudUpload] = useState<ActiveUpload | null>(null);
  const [cloudStarting, setCloudStarting] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [cloudUnavailable, setCloudUnavailable] = useState(false);
  const [cloudAvailability, setCloudAvailability] = useState<'checking' | 'configured' | 'unconfigured' | 'error'>('checking');
  const [streamHealth, setStreamHealth] = useState<StreamHealth>('idle');
  const [keepTabConnected, setKeepTabConnected] = useState(false);
  const lastPresentedAtRef = useRef(0);
  // The playback clock may be ahead of the last decoded image on screen.
  const presentedMediaTimeRef = useRef<number | null>(null);
  const lastDecodedMediaTimeRef = useRef<number | null>(null);
  const captureErrorRef = useRef(false);
  const captureStalledRef = useRef(false);
  const webcamRef = useRef<MediaStream | null>(null);
  const captureKindRef = useRef<'camera' | 'tab' | null>(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [tabCaptureActive, setTabCaptureActive] = useState(false);
  const stopCaptureActionRef = useRef<() => void>(() => {});
  const [tabCaptureStarting, setTabCaptureStarting] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { focusMode, setFocusMode } = useAnalysisFocus(active);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  const restoreTimeRef = useRef(0);
  const uploadGenerationRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const busyRef = useRef(false);
  const inFlightIdRef = useRef<number | null>(null);
  const inFlightTimeoutRef = useRef<number | null>(null);
  const messageIdRef = useRef(0);
  const generationRef = useRef(0);
  const lastCapturedTimeRef = useRef(-Infinity);
  const latestRef = useRef<Observation | null>(null);
  const grayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const grayHistoryRef = useRef<GrayFrame[]>([]);
  const flowTracksRef = useRef<PersistentTrack[]>([]);
  const nextStableIdRef = useRef(1);
  const detectorToStableIdRef = useRef<Map<number, number>>(new Map());
  const speedHistoryRef = useRef<Map<number, SpeedHistory>>(new Map());
  const autoIncidentDetectorRef = useRef(new AutomaticIncidentDetector());
  const lastOpticalSampleRef = useRef(-Infinity);
  const lastEstimateSaveAtRef = useRef(-Infinity);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const firstFrameResolveRef = useRef<(() => void) | null>(null);
  const paintCountRef = useRef(0);
  // One anchor/label format per persistent vehicle ID. No per-frame
  // candidate reshuffling, disappearing speed text or floating labels.
  const labelAnchorsRef = useRef(new Map<number, {
    slot: number; variant: number; lastSeenMs: number;
  }>());

  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [readyVideo, setReadyVideo] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [detector, setDetector] = useState<DetectorState>('idle');
  const [provider, setProvider] = useState('');
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [liveMaxSpeed, setLiveMaxSpeed] = useState<number | null>(null);
  const [analyzedFrames, setAnalyzedFrames] = useState(0);
  const [detectionCount, setDetectionCount] = useState<number | null>(null);
  const [fallbackReason, setFallbackReason] = useState('');
  const [storage, setStorage] = useState<'idle' | 'saving' | 'saved' | 'error' | 'not-saved'>('idle');
  const [cloudPlaybackActive, setCloudPlaybackActive] = useState(false);
  const [cloudPlaybackLoading, setCloudPlaybackLoading] = useState(false);
  const [unavailableOriginal, setUnavailableOriginal] = useState<string | null>(null);
  const [error, setError] = useState('');

  const downloadQualityTrace = () => {
    const frames = qualityFramesRef.current;
    if (!frames.length || !currentFileRef.current) return;
    const blob = new Blob([serializeQualityTrace(frames)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'visionguard-browser-tracking-unannotated.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 3000);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (playerRef.current) {
        if (!document.fullscreenEnabled || !playerRef.current.requestFullscreen) {
          setError('Fullscreen is unavailable in this browser. Open VisionGuard directly in Edge or Chrome, outside an embedded preview.');
          return;
        }
        // Fullscreen the composite player, NEVER just <video>; otherwise
        // the native fullscreen control hides all vehicle-box overlays.
        await playerRef.current.requestFullscreen();
      }
    } catch (error) {
      setError('Could not enter fullscreen: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === playerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const clearInFlight = useCallback(() => {
    if (inFlightTimeoutRef.current !== null) clearTimeout(inFlightTimeoutRef.current);
    inFlightTimeoutRef.current = null;
    inFlightIdRef.current = null;
    busyRef.current = false;
  }, []);

  const resetTracks = useCallback(() => {
    generationRef.current += 1;
    lastDecodedMediaTimeRef.current = null;
    presentedMediaTimeRef.current = null;
    lastPresentedAtRef.current = 0;
    captureStalledRef.current = false;
    latestRef.current = null;
    captureErrorRef.current = false;
    flowTracksRef.current = [];
    labelAnchorsRef.current.clear();
    speedHistoryRef.current.clear();
    autoIncidentDetectorRef.current.reset();
    qualityFramesRef.current = []; // A seek/source change invalidates timestamp alignment.
    detectorToStableIdRef.current.clear();
    // Preserve increasing stable IDs within this run. A seek/reconnect must
    // not reuse #1 for an entirely different vehicle in the saved ledger.
    grayHistoryRef.current = [];
    lastOpticalSampleRef.current = -Infinity;
    lastEstimateSaveAtRef.current = -Infinity;
    lastCapturedTimeRef.current = -Infinity;
    setVisibleCount(0);
    // Do not release an in-flight request here. It must finish or time out;
    // otherwise two GPU sessions could infer concurrently on different frames.
    workerRef.current?.postMessage({ type: 'reset' });
  }, []);

  const startDetector = useCallback(() => {
    if (workerRef.current) return;
    setDetector('loading');
    setError('');
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/localTrafficWorker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      setDetector('error');
      setError('Unable to create YOLO detection worker: ' + String(e));
      return;
    }
    workerRef.current = worker;
    const initTimeout = window.setTimeout(() => {
      if (readyRef.current || workerRef.current !== worker) return;
      worker.terminate();
      workerRef.current = null;
      clearInFlight();
      setDetector('error');
      setError('YOLO11s initialization timed out. Video playback remains available; retry detector.');
    }, 45_000);

    worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
      if (workerRef.current !== worker) return;
      const message = event.data;
      if (message.type === 'ready') {
        clearTimeout(initTimeout);
        readyRef.current = true;
        setDetector('ready');
        setProvider(message.provider);
        setFallbackReason(message.fallbackReason || '');
        return;
      }
      if (message.type === 'error' && message.requestId === -1) {
        clearTimeout(initTimeout);
        worker.terminate();
        workerRef.current = null;
        readyRef.current = false;
        clearInFlight();
        setDetector('error');
        setError('YOLO11s could not start: ' + message.message);
        return;
      }
      if (!('requestId' in message)) return;
      if (message.requestId === inFlightIdRef.current) clearInFlight();
      if (message.generation !== generationRef.current) return;
      if (message.type === 'result') {
        const video = videoRef.current;
        if (!video || video.seeking || !activeRef.current) return;
        // Results belong to the exact original media time, not wall-clock time.
        setInferenceMs(Math.round(message.inferenceMs));
        setDetectionCount(message.detectionCount);
        setAnalyzedFrames(count => count + 1);

        // The detection corresponds to a PAST decoded frame. Replaying cheap
        // optical tracking over cached displayed frames catches those boxes up
        // to the video that the user is seeing NOW. We never paint a raw
        // 900ms-old detection onto a later video frame.
        const history = grayHistoryRef.current;
        let anchor = -1;
        let closestDistance = Infinity;
        for (let i = 0; i < history.length; i++) {
          const distance = Math.abs(history[i].time - message.mediaTime);
          if (distance < closestDistance) {
            anchor = i;
            closestDistance = distance;
          }
        }
        if (anchor < 0 || closestDistance > 0.14) {
          // One late inference result must not erase newer optically matched
          // vehicles. Expire genuinely stale overlays as before.
          // Do not clear a currently visible, image-confirmed track merely
          // because an unrelated YOLO result arrived after its history anchor
          // expired. Reuse the SAME age, velocity and edge guards as canvas
          // rendering, so there is no extra ghost-retention policy here.
          const latest = latestRef.current;
          const displayedTime = displayedVideoMediaTime(
            video.currentTime, presentedMediaTimeRef.current, video.paused, video.seeking
          );
          const hasProjectableEvidence = latest !== null &&
            projectLiveTracks(
              latest.tracks, latest.time, displayedTime,
              video.videoWidth, video.videoHeight
            ).length > 0;
          if (!hasProjectableEvidence) {
            flowTracksRef.current = [];
            latestRef.current = null;
          }
          return;
        }
        // Catch delayed YOLO results up to the present video frame. One weak
        // optical sample must not delete the entire vehicle trajectory.
        let corrected: PersistentTrack[] = message.tracks.map(t => ({
          ...t, lastDetectedAt: message.mediaTime, lastOpticalAt: message.mediaTime,
          speedKmh: null, speedIsEstimate: true
        }));
        for (let i = anchor + 1; i < history.length && corrected.length; i++) {
          const advanced = advanceOpticalTracks(corrected, history[i - 1], history[i]);
          corrected = recoverBriefOpticalMisses(
            corrected, advanced, history[i - 1].time, history[i].time,
            history[i].sourceWidth, history[i].sourceHeight
          );
        }
        const latestTime = history[history.length - 1].time;
        const merged = reconcileVehicles(
          flowTracksRef.current, corrected, latestTime, nextStableIdRef.current,
          detectorToStableIdRef.current
        );
        nextStableIdRef.current = merged.nextId;
        for (const [sourceId, stableId] of merged.sourceAssignments) {
          detectorToStableIdRef.current.set(sourceId, stableId);
        }
        // Real detector-corrected positions also refresh optical speed.
        // Do not derive speed from a prediction-only bridge.
        const updatedIds = new Set(merged.sourceAssignments.values());
        const enriched = merged.tracks.map(track => {
          // An unmatched old track was merely retained; do not pretend YOLO
          // just measured that vehicle's position at the new timestamp.
          if (track.isPredicted || !updatedIds.has(track.id)) return track;
          const previousSpeed = speedHistoryRef.current.get(track.id) ?? {
            points: [], smoothedKmh: null
          };
          const estimate = updateScreenSpeed(previousSpeed, track, latestTime);
          speedHistoryRef.current.set(track.id, estimate.history);
          return { ...track, speedKmh: estimate.kmh ?? track.speedKmh, speedIsEstimate: true };
        });
        flowTracksRef.current = enriched;
        latestRef.current = { time: latestTime, tracks: enriched };
        const account = useAuthStore.getState().user?.id;
        if (account && activeRunRef.current) {
          // Predicted-only bridges are not confirmed vehicle observations.
          activityLedger.observe(account, activeRunRef.current, latestTime,
            enriched.filter(track => !track.isPredicted));
        }
      } else if (message.type === 'error') {
        setError('Frame inference error: ' + message.message);
      }
    };
    worker.onerror = event => {
      clearTimeout(initTimeout);
      if (workerRef.current !== worker) return;
      worker.terminate();
      workerRef.current = null;
      readyRef.current = false;
      clearInFlight();
      setDetector('error');
      setError('Detector worker crashed: ' + (event.message || 'unknown error'));
    };
    worker.postMessage({ type: 'init', modelPath: MODEL_PATH });
  }, [clearInFlight]);

  const attachVideo = useCallback((
    file: Blob, name: string, savedPosition = 0, restoredRunId?: string
  ) => {
    resetTracks();
    setCloudPlaybackActive(false);
    const accountForRestore = useAuthStore.getState().user?.id;
    if (restoredRunId && accountForRestore) {
      const restored = activityLedger.snapshot(accountForRestore).records
        .find(run => run.id === restoredRunId);
      nextStableIdRef.current = restored
        ? Math.max(0, ...Object.keys(restored.vehicles).map(Number).filter(Number.isFinite)) + 1
        : 1;
    } else nextStableIdRef.current = 1;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const nextUrl = URL.createObjectURL(file);
    urlRef.current = nextUrl;
    restoreTimeRef.current = savedPosition;
    setFilename(name);
    setReadyVideo(false);
    setDuration(0);
    setPosition(0);
    setError('');
    setAnalyzedFrames(0);
    setDetectionCount(null);
    setInferenceMs(null);
    setUrl(nextUrl);
    const account = useAuthStore.getState().user?.id;
    if (account) {
      // A newly selected file starts its own session, even if the user
      // previously analyzed a file with the same name/size. Reloading a
      // saved video resumes the *same* session using the stored run ID.
      const runId = restoredRunId || 'video:' + crypto.randomUUID();
      activeRunRef.current = runId;
      localStorage.setItem('visionguard:video-run:' + account, runId);
      activityLedger.begin(account, runId, name, 'uploaded-video');
    } else activeRunRef.current = '';
  }, [resetTracks]);

  // Both the camera and tab capture are permission-based MediaStreams.
  // Releasing the current stream must stop all captured tracks, not just
  // disconnect the preview element.
  const stopWebcam = () => {
    const active = webcamRef.current;
    webcamRef.current = null;
    captureKindRef.current = null;
    if (active && videoRef.current?.srcObject === active) videoRef.current.srcObject = null;
    active?.getTracks().forEach(track => track.stop());
    setWebcamActive(false);
    setTabCaptureActive(false);
  };

  const startTabCapture = async () => {
    if (tabCaptureStarting) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Browser tab capture requires Edge/Chrome on localhost or HTTPS.');
      return;
    }
    // Must be invoked directly from the button click. No network calls or
    // async work can precede the browser's capture-permission prompt.
    setTabCaptureStarting(true);
    setError('');
    const request = ++uploadGenerationRef.current;
    try {
      // Chrome/Edge can otherwise focus the captured tab when sharing starts.
      // Keep VisionGuard in focus when CaptureController is available; the
      // underlying video stream must survive either focus choice.
      const Controller = (window as unknown as {
        CaptureController?: new () => { setFocusBehavior?: (value: 'no-focus-change') => void }
      }).CaptureController;
      const controller = Controller ? new Controller() : undefined;
      const options = {
        video: { frameRate: { ideal: 24, max: 30 } },
        audio: false,
        // Chromium hints favour a YouTube tab and allow swapping tabs without
        // stopping the active capture; they are not a security guarantee.
        monitorTypeSurfaces: 'exclude',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        ...(controller ? { controller } : {}),
      } as DisplayMediaStreamOptions;
      const capture = await navigator.mediaDevices.getDisplayMedia(options);
      try { controller?.setFocusBehavior?.('no-focus-change'); } catch { /* not supported on all platforms */ }
      if (request !== uploadGenerationRef.current || !activeRef.current) {
        // Switching to the selected YouTube tab is NORMAL for getDisplayMedia.
        // A hidden VisionGuard tab is not a reason to discard permission.
        capture.getTracks().forEach(track => track.stop());
        return;
      }
      const surface = capture.getVideoTracks()[0]?.getSettings().displaySurface;
      if (surface && surface !== 'browser') {
        capture.getTracks().forEach(track => track.stop());
        setError('Choose Microsoft Edge Tab / Chrome Tab, NOT Entire Screen or Window. Screen sharing would show VisionGuard instead of YouTube after you switch back.');
        return;
      }
      videoRef.current?.pause();
      stopWebcam();
      resetTracks();
      setCloudPlaybackActive(false);
      nextStableIdRef.current = 1;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      currentFileRef.current = null;
      webcamRef.current = capture;
      captureKindRef.current = 'tab';
      setTabCaptureActive(true);
      setWebcamActive(false);
      setUrl(BROWSER_TAB_SOURCE);
      setFilename('Shared browser tab · live');
      setReadyVideo(false);
      setPlaying(false);
        setStreamHealth('connecting');
      setStorage('not-saved');
      setDuration(0);
      setPosition(0);
        if (ownerId) {
        activeRunRef.current = 'tab:' + crypto.randomUUID();
        activityLedger.begin(ownerId, activeRunRef.current, 'Shared browser tab', 'live-stream');
      } else activeRunRef.current = '';
      for (const track of capture.getVideoTracks()) {
        track.onmute = () => {
          if (webcamRef.current === capture) {
            captureStalledRef.current = true;
            setStreamHealth('buffering');
          }
        };
        track.onunmute = () => {
          if (webcamRef.current === capture) {
            // Don't show LIVE until a real frame has advanced.
            captureStalledRef.current = true;
            // Do not label the feed fresh until the next decoded frame.
            setStreamHealth('buffering');
          }
        };
        track.onended = () => {
          if (webcamRef.current !== capture) return;
          stopWebcam();
          resetTracks();
          setUrl('');
          setStreamHealth('idle');
          setError('Tab sharing ended. Click Analyze tab and choose the video tab again.');
          if (ownerId) void activityLedger.flush(ownerId).catch(console.warn);
        };
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setError('Tab sharing was cancelled. Choose the video tab when you are ready.');
      } else {
        setError('Could not capture tab: ' + (error instanceof Error ? error.message : String(error)));
      }
    } finally {
      setTabCaptureStarting(false);
    }
  };

  const startWebcam = async () => {
    if (cameraStarting) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access requires a supported browser on HTTPS or localhost.');
      return;
    }
    setCameraStarting(true);
    setError('');
    // Invalidate any file/stream restoration that may still be in flight.
    const request = ++uploadGenerationRef.current;
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (request !== uploadGenerationRef.current || !activeRef.current ||
          document.hidden) {
        // Camera permission can finish after navigating away or hiding
        // the tab; never start a background capture from a late response.
        camera.getTracks().forEach(track => track.stop());
        return;
      }
      videoRef.current?.pause();
      stopWebcam();
      resetTracks();
      setCloudPlaybackActive(false);
      nextStableIdRef.current = 1;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      currentFileRef.current = null;
      webcamRef.current = camera;
      captureKindRef.current = 'camera';
      setWebcamActive(true);
      setUrl(BROWSER_CAMERA_SOURCE);
      setFilename('Browser camera · live');
      setReadyVideo(false);
      setPlaying(false);
        setStreamHealth('connecting');
      setStorage('not-saved');
      setDuration(0);
      setPosition(0);
        if (ownerId) {
        activeRunRef.current = 'camera:' + new Date().toISOString() + ':' + request;
        activityLedger.begin(ownerId, activeRunRef.current, 'Browser camera', 'live-stream');
      } else activeRunRef.current = '';
      // If permission is revoked, stop retaining the stream in the background.
      for (const track of camera.getVideoTracks()) {
        track.onended = () => {
          if (webcamRef.current !== camera) return;
          setError('Camera disconnected or permission revoked. Select Camera to reconnect.');
          stopWebcam();
          resetTracks();
          setUrl('');
          setStreamHealth('error');
        };
      }
    } catch (error) {
      setError('Could not open camera: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setCameraStarting(false);
    }
  };

  useEffect(() => {
    setSaveVideo(ownerId ? localStorage.getItem('visionguard:save-video:' + ownerId) === 'yes' : false);
    setKeepTabConnected(ownerId
      ? localStorage.getItem('visionguard:keep-tab-on-navigation:' + ownerId) === 'yes' : false);
  }, [ownerId]);

  useEffect(() => {
    let alive = true;
    // A request for a specific cloud archive ID takes precedence over the
    // generic most-recent local video. Otherwise unrelated footage can appear
    // behind the archive failure and look like a successful recovery.
    if (!ownerId || new URLSearchParams(location.search).has('video') ||
        currentFileRef.current || urlRef.current ||
        localStorage.getItem('visionguard:save-video:' + ownerId) !== 'yes') return;
    const generation = uploadGenerationRef.current;
    void Promise.all([
      localAnalysisStorage.loadVideo(ownerId ?? undefined),
      localAnalysisStorage.loadPosition(ownerId ?? undefined)
    ]).then(async ([saved, savedPosition]) => {
      if (!alive || generation !== uploadGenerationRef.current || !saved) return;
      await activityLedger.load(ownerId);
      if (!alive || generation !== uploadGenerationRef.current) return;
      const file = saved.file instanceof File
        ? saved.file
        : new File([saved.file], saved.name, { type: saved.file.type || 'video/mp4' });
      currentFileRef.current = file;
      const savedRunId = localStorage.getItem('visionguard:video-run:' + ownerId) || undefined;
      attachVideo(file, saved.name, savedPosition, savedRunId);
      setStorage('saved');
    }).catch(e => {
      if (alive && generation === uploadGenerationRef.current) {
        setError(e instanceof ExpiredLocalVideoPermissionError ? e.message :
          'Could not restore your retained video. Choose the original again: ' + String(e));
      }
    });
    return () => { alive = false; };
  }, [attachVideo, ownerId, location.search]);

  // Deep links from the B2 archive must really open the stored video,
  // not silently discard ?video=<id> and show the previous local clip.
  useEffect(() => {
    const videoId = new URLSearchParams(location.search).get('video');
    if (!active || !ownerId || !videoId) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(videoId)) {
      setError('The saved-video link is invalid.');
      return;
    }
    let alive = true;
    const request = ++uploadGenerationRef.current;
    setCloudPlaybackLoading(true);
    setUnavailableOriginal(null);
    setError('');
    void (async () => {
      const { data, error: queryError } = await supabase.from('video_assets')
        .select('id,filename,file_size,metadata,storage_path,storage_provider,uploaded_by')
        .eq('id',videoId).eq('uploaded_by',ownerId).maybeSingle();
      if (queryError) throw queryError;
      if (!data) throw Error('Saved video not found in your account.');

      if (!canReanalyzeStoredVideo(data)) {
        // Analysis metadata does not contain video pixels. The only automatic
        // recovery permitted is an opted-in local original matching both its
        // filename and exact byte length. Never play a different local file.
        let retained: Awaited<ReturnType<typeof localAnalysisStorage.loadVideo>>;
        try {
          if (localStorage.getItem('visionguard:save-video:' + ownerId) === 'yes') {
            retained = await localAnalysisStorage.loadVideo(ownerId);
          }
        } catch (error) {
          console.warn('Retained video is inaccessible; choose the original file:', error);
        }
        if (!alive || request !== uploadGenerationRef.current || !activeRef.current) return;
        if (retained && savedLocalMatchesArchive(data, retained)) {
          const file = retained.file instanceof File ? retained.file :
            new File([retained.file], retained.name, {
              type: retained.file.type || 'video/mp4',
            });
          videoRef.current?.pause();
          stopWebcam();
          currentFileRef.current = file;
          attachVideo(file, retained.name);
          setStorage('saved');
          setUnavailableOriginal(null);
          setError('The cloud original was not uploaded. Opened the matching video retained on this device instead.');
          setCloudPlaybackLoading(false);
          // The cloud query no longer represents the source being played.
          // Remove it so a re-render cannot retry the missing B2 object.
          navigate({
            pathname: location.pathname,
            search: qualityEnabled ? '?quality=1' : '',
          }, { replace: true });
          return;
        }
        // Do not leave an unrelated previously opened video visible behind
        // a "cloud original missing" notice. Preserve retained files in
        // IndexedDB; clear only the currently displayed media source.
        videoRef.current?.pause();
        stopWebcam();
        resetTracks();
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
        currentFileRef.current = null;
        setUrl('');
        setReadyVideo(false);
        setPlaying(false);
        setCloudPlaybackActive(false);
        setFilename(data.filename);
        setUnavailableOriginal(data.filename);
        // Show a usable file-picker action, not a dead-end backend exception.
        setError('');
        return;
      }
      const videoUrl = await storageProviderFor(data).getVideoUrl({
        id:data.id, storage_path:data.storage_path
      });
      if (!alive || request !== uploadGenerationRef.current || !activeRef.current) return;
      videoRef.current?.pause();
      stopWebcam();
      resetTracks();
      nextStableIdRef.current = 1;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      currentFileRef.current = null;
      setCloudPlaybackActive(true);
      setUnavailableOriginal(null);
      setStorage('not-saved');
      setFilename(data.filename);
        setReadyVideo(false);
      setPlaying(false);
      setDuration(0);
      setPosition(0);
      setAnalyzedFrames(0);
      setDetectionCount(null);
        setUrl(videoUrl);
      activeRunRef.current = 'b2:' + crypto.randomUUID();
      activityLedger.begin(ownerId, activeRunRef.current, data.filename, 'uploaded-video');
    })().catch(error => {
      if (alive && request === uploadGenerationRef.current) {
        setUnavailableOriginal(null);
        setError('Could not open the cloud video. The signed link or storage connection may be unavailable: ' +
          (error instanceof Error ? error.message : String(error)) +
          '. You can choose the original file above and analyze it locally.');
      }
    }).finally(() => {
      if (alive) setCloudPlaybackLoading(false);
    });
    return () => { alive = false; };
  }, [location.search, location.pathname, active, ownerId, resetTracks, attachVideo, navigate, qualityEnabled]);

  // This cleanup must be unconditional. The saved-video restoration effect
  // above can return early when local retention is disabled or a stream is
  // selected; previously that skipped camera/worker teardown on unmount.
  useEffect(() => () => {
    uploadGenerationRef.current += 1;
    clearInFlight();
    workerRef.current?.terminate();
    workerRef.current = null;
    readyRef.current = false;
    firstFrameResolveRef.current?.();
    firstFrameResolveRef.current = null;
    webcamRef.current?.getTracks().forEach(track => track.stop());
    webcamRef.current = null;
    cloudUnsubscribeRef.current?.();
    cloudUnsubscribeRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, [clearInFlight]);

  const acceptFile = async (file: File) => {
    if (!/\.(mp4|m4v|webm|mov|mkv)$/i.test(file.name) && !file.type.startsWith('video/')) {
      setError('Choose a valid video file. H.264 MP4 provides the broadest Edge compatibility.');
      return;
    }
    uploadGenerationRef.current += 1;
    setUnavailableOriginal(null);
    // A file deliberately chosen in response to an archive-recovery link is
    // a NEW local analysis, not a remotely stored video or the old session.
    if (new URLSearchParams(location.search).has('video')) {
      navigate({
        pathname: location.pathname,
        search: qualityEnabled ? '?quality=1' : '',
      }, { replace: true });
    }
    stopWebcam();
    setStreamHealth('idle');
    currentFileRef.current = file;
    cloudUnsubscribeRef.current?.();
    cloudUnsubscribeRef.current = null;
    cloudUploadIdRef.current = null;
    setCloudUpload(null);
    setCloudError('');
    setCloudStarting(false);
    const generation = uploadGenerationRef.current;
    attachVideo(file, file.name);
    // Video is never retained unless the user explicitly opted in.
    const shouldSave = ownerId && localStorage.getItem('visionguard:save-video:' + ownerId) === 'yes';
    setStorage(shouldSave ? 'saving' : 'not-saved');
    persistenceQueueRef.current = persistenceQueueRef.current.catch(() => {}).then(async () => {
      if (generation !== uploadGenerationRef.current) return;
      if (!shouldSave) {
        await localAnalysisStorage.clearVideo(ownerId ?? undefined);
      } else {
        // Real opt-in file snapshot, not a revocable Edge file-system handle.
        await localAnalysisStorage.saveVideo(file, file.name, ownerId ?? undefined);
      }
      if (generation !== uploadGenerationRef.current) return;
      await localAnalysisStorage.clearAnalysis(ownerId ?? undefined);
      await localAnalysisStorage.savePosition(0, ownerId ?? undefined);
      setStorage(shouldSave ? 'saved' : 'not-saved');
    });
    void persistenceQueueRef.current.catch(e => {
      if (generation !== uploadGenerationRef.current) return;
      setStorage('error');
      setError('Local video retention failed (check available browser storage). The video can still play: ' + String(e));
    });
  };

  useEffect(() => {
    if (!ownerId) {
      setCloudAvailability('unconfigured');
      return;
    }
    let cancelled = false;
    setCloudAvailability('checking');
    void isB2UploadConfigured()
      .then(configured => {
        if (cancelled) return;
        setCloudAvailability(configured ? 'configured' : 'unconfigured');
        if (!configured) setCloudUnavailable(true);
      })
      .catch(error => {
        if (cancelled) return;
        console.warn('Cloud backup preflight failed:', error);
        setCloudAvailability('error');
      });
    return () => { cancelled = true; };
  }, [ownerId]);

  const reportCloudUploadFailure = (error: unknown) => {
    const failure = describeCloudVideoFailure(error);
    setCloudError(failure.message);
    if (failure.kind === 'not_configured') {
      setCloudUnavailable(true);
      setCloudAvailability('unconfigured');
    }
  };

  const saveCurrentVideoToB2 = async () => {
    const file = currentFileRef.current;
    if (!file || !ownerId || cloudStarting || cloudUnavailable ||
        cloudAvailability !== 'configured' || cloudUploadIdRef.current) return;
    setCloudStarting(true);
    setCloudError('');
    try {
      if (uploadStorageProvider().id !== 'b2') {
        throw new Error('Cloud video saving is restricted to Backblaze B2.');
      }
      // Recheck before creating a video_assets row: server configuration
      // might have changed since this page was opened.
      if (!await isB2UploadConfigured()) {
        setCloudAvailability('unconfigured');
        throw new Error('Video storage is not configured on the server.');
      }
      // The existing UploadManager writes a metadata row and uses the
      // authenticated B2 signing function. File bytes go directly to B2.
      // No upload occurs unless the user clicks this button.
      const { videoId } = await uploadManager.startUpload(file, undefined, { keepPreview: false });
      cloudUploadIdRef.current = videoId;
      cloudUnsubscribeRef.current?.();
      cloudUnsubscribeRef.current = uploadManager.subscribe(videoId, upload => {
        setCloudUpload(upload);
        if (upload.status === 'failed') reportCloudUploadFailure(upload.error || 'B2 upload failed.');
      });
    } catch (error) {
      reportCloudUploadFailure(error);
    } finally {
      setCloudStarting(false);
    }
  };

  const chooseVideo = () => {
    // Do not depend on revocable FileSystemFileHandle permissions.
    // A user-picked File can be copied to IndexedDB only when opted in.
    inputRef.current?.click();
  };

  const reopenSavedVideo = async () => {
    if (!ownerId) return;
    try {
      const [saved, savedPosition] = await Promise.all([
        localAnalysisStorage.loadVideo(ownerId),
        localAnalysisStorage.loadPosition(ownerId),
      ]);
      if (!saved) {
        setError('The previous file cannot be reopened automatically. Choose the original again; with local retention enabled, VisionGuard now stores a real file copy instead of an expiring file permission.');
        return;
      }
      await activityLedger.load(ownerId);
      videoRef.current?.pause();
      uploadGenerationRef.current += 1;
      stopWebcam();
      setStreamHealth('idle');
      const file = saved.file instanceof File
        ? saved.file : new File([saved.file], saved.name, { type: saved.file.type || 'video/mp4' });
      currentFileRef.current = file;
      attachVideo(file, saved.name, savedPosition,
        localStorage.getItem('visionguard:video-run:' + ownerId) || undefined);
      setStorage('saved');
    } catch (error) {
      setError(error instanceof ExpiredLocalVideoPermissionError ? error.message :
        'Cannot reopen saved video. Choose the original file again: ' +
          (error instanceof Error ? error.message : String(error)));
    }
  };

  const removeVideo = () => {
    // Stopping a live stream/camera must NEVER delete an unrelated video
    // previously saved by the user on this device.
    const removingLocalFile = !!currentFileRef.current && !webcamRef.current;
    videoRef.current?.pause();
    uploadGenerationRef.current += 1;
    resetTracks();
    firstFrameResolveRef.current?.();
    firstFrameResolveRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setUrl('');
    setFilename('');
    setReadyVideo(false);
    setPlaying(false);
    setCloudPlaybackActive(false);
    stopWebcam();
    setStreamHealth('idle');
    currentFileRef.current = null;
    cloudUnsubscribeRef.current?.();
    cloudUnsubscribeRef.current = null;
    cloudUploadIdRef.current = null;
    setCloudUpload(null);
    setCloudError('');
    activeRunRef.current = '';
    if (ownerId && removingLocalFile) localStorage.removeItem('visionguard:video-run:' + ownerId);
    setStorage('idle');
    setPosition(0);
    setDuration(0);
    setError('');
    if (removingLocalFile) {
      // Explicitly removing a selected local video also clears its retained
      // file; closing a remote stream or a camera never touches that file.
      persistenceQueueRef.current = persistenceQueueRef.current.catch(() => {}).then(async () => {
        await localAnalysisStorage.clearVideo(ownerId ?? undefined);
        await localAnalysisStorage.clearPosition(ownerId ?? undefined);
        await localAnalysisStorage.clearAnalysis(ownerId ?? undefined);
      });
      void persistenceQueueRef.current.catch(e => setError('Could not clear local video: ' + String(e)));
    }
  };

  // The app shell remains visible while Live Analysis is hidden. Keep a
  // persistent, accessible stop-sharing button whenever tab capture is live.
  stopCaptureActionRef.current = () => {
    if (captureKindRef.current === 'tab') removeVideo();
  };
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('visionguard:tab-capture-status', {
      detail: { active: tabCaptureActive }
    }));
    return () => {
      window.dispatchEvent(new CustomEvent('visionguard:tab-capture-status', {
        detail: { active: false }
      }));
    };
  }, [tabCaptureActive]);
  useEffect(() => {
    const stop = () => stopCaptureActionRef.current();
    window.addEventListener('visionguard:stop-tab-capture', stop);
    return () => window.removeEventListener('visionguard:stop-tab-capture', stop);
  }, []);

  useEffect(() => {
    if (!webcamActive && !tabCaptureActive) return;
    const camera = webcamRef.current;
    const video = videoRef.current;
    if (!camera || !video) return;
    video.srcObject = camera;
    void video.play().catch(() => {
      setError('Camera is ready, but playback was blocked. Press Play to start analysis.');
    });
    return () => {
      if (video.srcObject === camera) video.srcObject = null;
    };
  }, [webcamActive, tabCaptureActive, url]);

  useEffect(() => {
    if (!tabCaptureActive || readyVideo || !active) return;
    const timeout = window.setTimeout(() => {
      const video = videoRef.current;
      if (captureKindRef.current !== 'tab' || !webcamRef.current ||
          (video && video.readyState >= 2)) return;
      setStreamHealth('buffering');
      setError('Sharing is approved, but no video frames have arrived. Confirm the YouTube video is playing in the selected tab; if necessary, stop and share the tab again.');
    }, 12_000);
    return () => window.clearTimeout(timeout);
  }, [tabCaptureActive, readyVideo, active]);

  useEffect(() => {
    if (!(tabCaptureActive || webcamActive) || !active) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (video && isStreamStalled(
        performance.now(), lastPresentedAtRef.current,
        { paused: video.paused, ended: video.ended, seeking: video.seeking },
        STREAM_STALL_MS
      )) {
        captureStalledRef.current = true;
        setStreamHealth('buffering');
      }
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [tabCaptureActive, webcamActive, active]);

  useEffect(() => {
    if (active) {
      if (captureKindRef.current === 'tab' && webcamRef.current && videoRef.current?.paused) {
        void videoRef.current.play().catch(() => {});
      }
      return;
    }
    const video = videoRef.current;
    const wasCapturing = !!webcamRef.current;
    if (wasCapturing && keepCaptureAcrossPages(captureKindRef.current, keepTabConnected)) {
      // Capture stays connected, but AI inference is suspended off this route.
      if (ownerId) void activityLedger.flush(ownerId).catch(console.warn);
      return;
    }
    video?.pause();
    if (wasCapturing) {
      // Camera and user-approved tab capture are released on navigation.
      stopWebcam();
      setUrl('');
      setStreamHealth('idle');
      resetTracks();
    }
    // Never overwrite a saved file's position with a now-closed camera or
    // YouTube tab capture timestamp.
    if (video && !wasCapturing && !cloudPlaybackActive && ownerId &&
        Number.isFinite(video.currentTime)) {
      void localAnalysisStorage.savePosition(video.currentTime, ownerId).catch(() => {});
    }
  }, [active, keepTabConnected, ownerId, cloudPlaybackActive]);

  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!document.hidden && video && captureKindRef.current === 'tab' && webcamRef.current) {
        // Some browsers suspend the muted local preview while another tab is
        // focused. Sharing permission remains intact; resume the preview
        // when the user returns rather than leaving an empty analysis panel.
        // Returning to the tab is not evidence that the shared video
        // delivered a fresh decoded frame. Keep overlays hidden until it does.
        if (shouldResumeSharedTab(captureKindRef.current, document.hidden, video.paused)) {
          void video.play().catch(() => {
            setError('Tab sharing is still active, but playback was paused by the browser. Press Play to resume detection.');
          });
        }
        return;
      }
      if (document.hidden && video) {
        const account = useAuthStore.getState().user?.id;
        if (account) void activityLedger.flush(account).catch(console.warn);
        const policy = hiddenPagePolicy(captureKindRef.current);
        // The browser often focuses YouTube after sharing. Tab captures must
        // remain active; only device cameras are stopped when the app hides.
        if (!policy.pauseMedia) return;
        video.pause();
        if (policy.releaseCapture && webcamRef.current) {
          // Unlike a shared tab, the device camera is released on hide.
          stopWebcam();
          setUrl('');
          setStreamHealth('idle');
          resetTracks();
        } else if (account && !!urlRef.current) {
          // Cloud B2 playback should not overwrite the saved position of a
          // different video retained locally for this account.
          void localAnalysisStorage.savePosition(video.currentTime, account).catch(() => {});
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const changeSaveVideo = (checked: boolean) => {
    if (!ownerId) return;
    setSaveVideo(checked);
    localStorage.setItem('visionguard:save-video:' + ownerId, checked ? 'yes' : 'no');
    const file = currentFileRef.current;
    setStorage(checked && file ? 'saving' : 'not-saved');
    persistenceQueueRef.current = persistenceQueueRef.current.catch(() => {}).then(async () => {
      if (!checked || !file) {
        await localAnalysisStorage.clearVideo(ownerId ?? undefined);
        return;
      }
      await localAnalysisStorage.saveVideo(file, file.name, ownerId ?? undefined);
    });
    void persistenceQueueRef.current.then(() => setStorage(checked && file ? 'saved' : 'not-saved'))
      .catch(e => { setStorage('error'); setError('Could not save video locally: ' + String(e)); });
  };

  // Video advances at native speed. Grayscale visual tracking updates between
  // sparse YOLO observations, so slow WASM results are applied to the CURRENT
  // image instead of disappearing before they can be rendered.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    let stopped = false;
    let presentedId: number | null = null;
    let fallbackId: number | null = null;

    const maybeInfer = (mediaTime: number) => {
      if (stopped || !activeRef.current) return;
      if (webcamRef.current && !video.paused && !video.ended && video.readyState >= 2) {
        const now = performance.now();
        const discontinuity = isLiveFrameDiscontinuity(
          lastDecodedMediaTimeRef.current, mediaTime, lastPresentedAtRef.current, now
        );
        if (discontinuity) {
          // Lost frames or a restarted stream clock: discard stale optical
          // trajectories, previous speed estimates and incident streaks.
          // Preserve the session and monotonically assigned vehicle IDs.
          generationRef.current += 1;
          latestRef.current = null;
          flowTracksRef.current = [];
          grayHistoryRef.current = [];
          speedHistoryRef.current.clear();
          autoIncidentDetectorRef.current.reset();
          detectorToStableIdRef.current.clear();
          lastOpticalSampleRef.current = -Infinity;
          lastEstimateSaveAtRef.current = -Infinity;
          // A rebased media clock may start back at 0. Do not make inference
          // wait until the previous stream's high timestamp is reached.
          lastCapturedTimeRef.current = -Infinity;
          workerRef.current?.postMessage({ type: 'reset' });
        }
        if (discontinuity || hasAdvancedVideoFrame(lastDecodedMediaTimeRef.current, mediaTime)) {
          lastDecodedMediaTimeRef.current = mediaTime;
          lastPresentedAtRef.current = now;
          captureStalledRef.current = false;
          setStreamHealth('playing');
        }
      }
      if (captureErrorRef.current) return;
      if (stopped || !activeRef.current ||
          !video.videoWidth || !video.videoHeight || video.paused || video.seeking ||
          video.ended || video.readyState < 2 || !Number.isFinite(mediaTime)) return;

      // Optical tracking uses tiny grayscale thumbnails (~320x180), keeping
      // moving boxes aligned while YOLO11s/WASM is taking ~1s per inference.
      if (mediaTime - lastOpticalSampleRef.current >= OPTICAL_INTERVAL) {
        lastOpticalSampleRef.current = mediaTime;
        if (!grayCanvasRef.current) grayCanvasRef.current = document.createElement('canvas');
        try {
          const current = takeGrayFrame(video, mediaTime, grayCanvasRef.current);
          if (current) {
            const history = grayHistoryRef.current;
            const previous = history[history.length - 1];
            if (previous && flowTracksRef.current.length) {
              const advanced = advanceOpticalTracks(flowTracksRef.current, previous, current);
              const continuous = recoverBriefOpticalMisses(
                flowTracksRef.current, advanced, previous.time, current.time,
                current.sourceWidth, current.sourceHeight
              );
              flowTracksRef.current = continuous.map(track => {
                // Predicted positions are display-only; don't generate artificial
                // km/h readings from movement we haven't observed.
                if (track.isPredicted) return track;
                const previousSpeed = speedHistoryRef.current.get(track.id) ?? {
                  points: [], smoothedKmh: null
                };
                const speed = updateScreenSpeed(previousSpeed, track, current.time);
                speedHistoryRef.current.set(track.id, speed.history);
                return { ...track, speedKmh: speed.kmh, speedIsEstimate: true };
              });
              const activeIds = new Set(flowTracksRef.current.map(t => t.id));
              // A one-frame feature miss must not erase a vehicle's velocity
              // window. Retire history only after sustained absence.
              for (const [id, history] of speedHistoryRef.current) {
                const lastPoint = history.points[history.points.length - 1];
                if (!activeIds.has(id) &&
                    (!lastPoint || current.time - lastPoint.time > 2.5)) {
                  speedHistoryRef.current.delete(id);
                }
              }
              latestRef.current = { time: current.time, tracks: flowTracksRef.current };
              const account = useAuthStore.getState().user?.id;
              if (account && activeRunRef.current) {
                // Only optically confirmed, repeated observations qualify.
                // Deterministic event IDs prevent duplicates on replay/reload.
                for (const incident of autoIncidentDetectorRef.current.ingest(flowTracksRef.current, current.time)) {
                  activityLedger.addReviewedViolation(account, activeRunRef.current, {
                    id: 'auto:' + incident.type + ':' + incident.trackId,
                    trackId: incident.trackId,
                    type: incident.type,
                    observedAt: Date.now(),
                    status: 'pending_review',
                    evidenceNote: incident.evidenceNote
                  });
                }
              }
              // Save the estimates seen on screen, not just the first sparse
              // YOLO result (which may have no optical speed yet). Rate limit
              // to keep IndexedDB/cloud history efficient.
              if (current.time - lastEstimateSaveAtRef.current >= 1) {
                lastEstimateSaveAtRef.current = current.time;
                const account = useAuthStore.getState().user?.id;
                if (account && activeRunRef.current) {
                  activityLedger.updateSpeedEstimates(
                    account, activeRunRef.current, flowTracksRef.current
                  );
                }
              }
            }
            history.push(current);
            while (history.length && mediaTime - history[0].time > HISTORY_WINDOW) history.shift();
          }
        } catch (e) {
          // Cross-origin cameras without CORS can play visibly, but cannot
          // expose image pixels for AI. Report once; avoid a render storm.
          captureErrorRef.current = true;
          setError('Video playback works, but the browser cannot read frames for detection. ' +
            'The stream must allow cross-origin image access (CORS). Details: ' + String(e));
          if (webcamRef.current) setStreamHealth('error');
        }
      }

      if (!readyRef.current || busyRef.current) return;
      if (mediaTime - lastCapturedTimeRef.current < MIN_CAPTURE_INTERVAL) return;
      lastCapturedTimeRef.current = mediaTime;
      const worker = workerRef.current;
      if (!worker) return;
      busyRef.current = true;
      const generation = generationRef.current;
      const requestId = ++messageIdRef.current;
      inFlightIdRef.current = requestId;
      const ratio = Math.min(1, MAX_CAPTURE_WIDTH / Math.max(video.videoWidth, video.videoHeight));
      const resizeWidth = Math.max(1, Math.round(video.videoWidth * ratio));
      const resizeHeight = Math.max(1, Math.round(video.videoHeight * ratio));
      void createImageBitmap(video, {
        resizeWidth, resizeHeight, resizeQuality: 'medium'
      }).then(bitmap => {
        if (stopped || generation !== generationRef.current || video.seeking ||
            !activeRef.current || video.paused || workerRef.current !== worker) {
          bitmap.close();
          if (inFlightIdRef.current === requestId) clearInFlight();
          return;
        }
        inFlightTimeoutRef.current = window.setTimeout(() => {
          if (inFlightIdRef.current !== requestId) return;
          clearInFlight();
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          readyRef.current = false;
          setDetector('error');
          latestRef.current = null;
          setError('Detector stalled for 20 seconds. Playback continues; use Retry detector.');
        }, WORKER_TIMEOUT_MS);
        worker.postMessage({
          type: 'frame', bitmap, requestId, generation, mediaTime,
          sourceWidth: video.videoWidth, sourceHeight: video.videoHeight
        }, [bitmap]);
      }).catch(error => {
        if (inFlightIdRef.current === requestId) clearInFlight();
        captureErrorRef.current = true;
        setError('Could not capture a decoded video frame for AI: ' + String(error));
        if (webcamRef.current) setStreamHealth('error');
      });
    };

    const schedule = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        presentedId = video.requestVideoFrameCallback((_, metadata) => {
          presentedMediaTimeRef.current = metadata.mediaTime;
          maybeInfer(metadata.mediaTime);
          schedule();
        });
      } else {
        fallbackId = requestAnimationFrame(() => {
          presentedMediaTimeRef.current = video.currentTime;
          maybeInfer(video.currentTime);
          schedule();
        });
      }
    };
    schedule();
    return () => {
      stopped = true;
      if (presentedId !== null) video.cancelVideoFrameCallback(presentedId);
      if (fallbackId !== null) cancelAnimationFrame(fallbackId);
    };
  // Rebind callbacks when the media element is recreated for a HLS retry or
  // a different saved source with the same URL. Otherwise AI continues
  // sampling an orphaned video node while the new video plays untracked.
  }, [url, webcamActive, tabCaptureActive, clearInFlight]);

  // Paint each display frame using optical positions from the most recent
  // decoded video frame; hide boxes immediately when tracking loses them.
  useEffect(() => {
    let animation = 0;
    let lastUI = 0;
    let lastSaved = 0;
    const render = (time: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && activeRef.current) {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const imageWidth = Math.round(width * dpr);
        const imageHeight = Math.round(height * dpr);
        if (imageWidth && imageHeight && (canvas.width !== imageWidth || canvas.height !== imageHeight)) {
          canvas.width = imageWidth;
          canvas.height = imageHeight;
        }
        const context = canvas.getContext('2d');
        let visible = 0;
        const visibleTracks: PersistentTrack[] = [];
        if (context) {
          context.clearRect(0, 0, canvas.width, canvas.height);
          const observation = latestRef.current;
          if (observation && video.videoWidth && video.videoHeight &&
              !video.seeking && !video.ended &&
              shouldPaintLiveOverlay(
                captureKindRef.current, time, lastPresentedAtRef.current,
                { paused: video.paused, ended: video.ended, seeking: video.seeking },
                captureStalledRef.current
              )) {
            const frameWidth = video.videoWidth;
            const frameHeight = video.videoHeight;
            const fit = Math.min(width / frameWidth, height / frameHeight);
            const offsetX = (width - frameWidth * fit) / 2;
            const offsetY = (height - frameHeight * fit) / 2;
            const displayedTime = displayedVideoMediaTime(
              video.currentTime, presentedMediaTimeRef.current, video.paused, video.seeking
            );
            const tracks = projectLiveTracks(
              observation.tracks, observation.time, displayedTime, frameWidth, frameHeight
            );
            context.save();
            context.scale(dpr, dpr);
            context.beginPath();
            context.rect(offsetX, offsetY, frameWidth * fit, frameHeight * fit);
            context.clip();
            const renderedBoxes: Array<{
              track: PersistentTrack;
              x: number; y: number; w: number; h: number;
            }> = [];
            for (const track of tracks) {
              const x = offsetX + (track.x - track.w / 2) * fit;
              const y = offsetY + (track.y - track.h / 2) * fit;
              const w = track.w * fit;
              const h = track.h * fit;
              if (!Number.isFinite(x + y + w + h) || w < 4 || h < 4) continue;
              visible += 1;
              context.strokeStyle = '#51f6b5';
              context.lineWidth = 2;
              context.strokeRect(x, y, w, h);
              const stable = track as PersistentTrack;
              visibleTracks.push(stable);
              renderedBoxes.push({ track: stable, x, y, w, h });
            }

            // Existing vehicle labels keep their chosen anchor. Returning
            // detections or nearby newcomers must not rearrange or erase them.
            // No detection or tracking state is changed by label rendering.
            const occupiedLabels: Array<{ x: number; y: number; w: number; h: number }> = [];
            const anchorMap = labelAnchorsRef.current;
            renderedBoxes.sort((a, b) => {
              const hasA = anchorMap.has(a.track.id);
              const hasB = anchorMap.has(b.track.id);
              if (hasA !== hasB) return hasA ? -1 : 1;
              return (b.w * b.h - a.w * a.h) || (a.track.id - b.track.id);
            });
            context.font = '600 11px system-ui,sans-serif';
            for (const box of renderedBoxes) {
              const stable = box.track;
              // Both full and compact labels must retain the recognized
              // vehicle class (CAR/TRUCK/BUS/etc), ID and estimated speed.
              const labels = vehicleOverlayLabels(stable);
              const widths = labels.map(label => context.measureText(label).width + 12);
              const previous = anchorMap.get(stable.id);
              const placement = placeLiveLabel(
                box, { x: offsetX, y: offsetY, w: frameWidth * fit, h: frameHeight * fit },
                widths, occupiedLabels, previous
              );
              if (!placement) continue;
              anchorMap.set(stable.id, {
                slot: placement.slot, variant: placement.variant, lastSeenMs: time,
              });
              occupiedLabels.push(placement.rect);
              context.fillStyle = 'rgba(7,16,34,.90)';
              context.fillRect(placement.rect.x, placement.rect.y, placement.rect.w, placement.rect.h);
              context.fillStyle = '#ccffeb';
              context.fillText(labels[placement.variant], placement.rect.x + 6, placement.rect.y + 13);
            }
            // A departed vehicle must not reserve an anchor indefinitely.
            for (const [id, last] of anchorMap) {
              if (time - last.lastSeenMs > 1500) anchorMap.delete(id);
            }
            context.restore();
          }
        }
        // Include empty video frames as well as tracked ones: these are vital
        // for measuring false positives and ghost boxes after scene exits.
        if (qualityEnabledRef.current && currentFileRef.current && readyRef.current &&
            video.videoWidth > 0 && video.videoHeight > 0 &&
            !video.paused && !video.ended && !video.seeking) {
          appendQualityFrame(qualityFramesRef.current,
            presentedMediaTimeRef.current ?? video.currentTime,
            video.videoWidth, video.videoHeight, visibleTracks);
        }
        if (time - lastUI > 250) {
          lastUI = time;
          setPosition(video.currentTime);
          const latestSpeed = fastestVisibleEstimate(visibleTracks);
          setLiveMaxSpeed(previous => previous === latestSpeed ? previous : latestSpeed);
          if (paintCountRef.current !== visible) {
            paintCountRef.current = visible;
            setVisibleCount(visible);
          }
        }
        if (urlRef.current && time - lastSaved > 2000 && !video.paused && Number.isFinite(video.currentTime)) {
          lastSaved = time;
          const account = useAuthStore.getState().user?.id;
          if (account) void localAnalysisStorage.savePosition(video.currentTime, account).catch(() => {});
        }
      }
      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animation);
  }, []);

  return (
    <div className={'vg-page vg-analyze-page space-y-5' + (focusMode ? ' vg-analyze-focus' : '')}>
      <header className="vg-page-header vg-analysis-header">
        {focusMode && <div className="vg-focus-banner">
          <span className="vg-focus-banner-dot" aria-hidden="true"/>
          <span>Focus view</span>
          <small>Press Esc to exit</small>
        </div>}
        <div className="vg-analysis-heading">
          <span className="vg-page-kicker">VIDEO INTELLIGENCE / WORKSPACE</span>
          <h1>Live analysis</h1>
          <p>Inspect footage using on-device detection and visual tracking.</p>
        </div>
        <div className="vg-analysis-actions flex flex-wrap gap-2">
          <input ref={inputRef} type="file" accept="video/*,.mp4,.webm,.mov,.mkv" className="hidden"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void acceptFile(file);
              event.target.value = '';
            }} />
          <button type="button" onClick={() => void chooseVideo()}
            className="vg-primary">
            <Upload size={16} /> Choose video
          </button>
          <button type="button" onClick={() => webcamActive ? removeVideo() : void startWebcam()}
            disabled={cameraStarting}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <Camera size={16} /> {cameraStarting ? 'Opening camera…' : webcamActive ? 'Stop camera' : 'Use camera'}
          </button>
          <button type="button"
            onClick={() => tabCaptureActive ? removeVideo() : void startTabCapture()}
            disabled={tabCaptureStarting}
            className="vg-secondary"
            title="Choose the already-open YouTube or video tab in your browser's Share dialog">
            <MonitorPlay size={16}/>
            {tabCaptureStarting ? 'Choose a tab…' : tabCaptureActive ? 'Stop tab capture' : 'Analyze tab'}
          </button>
          {(webcamActive || tabCaptureActive) && saveVideo && <button type="button"
            onClick={() => void reopenSavedVideo()}
            className="vg-secondary">
            <Film size={16}/> Saved video
          </button>}
          <a href="https://www.youtube.com/" target="_blank" rel="noopener noreferrer"
            title="Optional: browse YouTube in a separate tab. Open a video, then select Analyze tab."
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-slate-500 transition-colors hover:text-[#bd5035]">
            Open YouTube <ExternalLink size={13}/>
          </a>
          {qualityEnabled && !!currentFileRef.current && !!qualityFramesRef.current.length &&
            <button type="button" onClick={downloadQualityTrace}
              title="Download local-only predictions; human annotation is required"
              className="vg-secondary">
              Download QA trace ({qualityFramesRef.current.length})
            </button>}
          {url && !webcamActive && !tabCaptureActive && <button type="button" aria-label="Close current source" onClick={removeVideo}
            className="vg-secondary" title="Close current video"><X size={18} /></button>}
          <button type="button" onClick={() => setFocusMode(value => !value)}
            aria-pressed={focusMode}
            aria-controls="vg-analysis-player vg-analysis-telemetry vg-analysis-details"
            aria-keyshortcuts="Escape"
            className={'vg-analysis-focus-toggle ' + (focusMode ? 'vg-analysis-focus-active' : '')}
            title={focusMode ? 'Exit focus view (Esc)' : 'Enlarge video and telemetry; hide other workspace controls'}>
            {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {focusMode ? 'Exit focus' : 'Focus view'}
          </button>
        </div>
      </header>

      {tabCaptureActive && <div className="vg-panel flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-800">Browser tab connected</p>
          <p className="mt-1 text-xs text-slate-500">Capture is user-approved. No video is recorded or uploaded.</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={keepTabConnected} onChange={event => {
            const enabled = event.target.checked;
            setKeepTabConnected(enabled);
            if (ownerId) localStorage.setItem('visionguard:keep-tab-on-navigation:' + ownerId, enabled ? 'yes' : 'no');
          }} className="h-4 w-4 accent-[#bd5035]"/>
          Keep sharing on other VisionGuard pages
        </label>
      </div>}

      {cloudPlaybackLoading && <p role="status" className="vg-panel px-4 py-3 text-sm text-slate-600">
        Checking the saved video…
      </p>}
      {unavailableOriginal && !cloudPlaybackLoading && <div role="status"
        className="vg-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">Original video not saved to cloud</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            {unavailableOriginal} · Analysis history is saved, but footage was not uploaded.
            Choose the original file on this device to analyze it again.
          </p>
        </div>
        <button type="button" onClick={() => void chooseVideo()}
          className="vg-primary"><Upload size={15}/> Choose original video</button>
      </div>}
      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle size={18} className="shrink-0" /><span>{error}</span>
      </div>}

      <section id="vg-analysis-player" className="vg-panel vg-analysis-player-card overflow-hidden" aria-label="Video analysis player">
        <div className="vg-analysis-stage-head">
          <span><ScanLine size={15} aria-hidden="true" /> ANALYSIS VIEWPORT</span>
          <span className="vg-analysis-engine-state">
            <i aria-hidden="true" data-state={detector} />
            {detector === 'ready' ? 'Detector ready' :
              detector === 'loading' ? 'Loading YOLO11s' :
              detector === 'error' ? 'Detector unavailable' : 'Awaiting inference'}
          </span>
        </div>
        <div ref={playerRef} className="vg-player-frame relative aspect-video w-full overflow-hidden bg-[#080e20]">
          {url ? (
            <>
              <video key={tabCaptureActive ? 'shared-browser-tab' : webcamActive ? 'browser-camera' : 'uploaded-file'}
                ref={videoRef} src={tabCaptureActive || webcamActive ? undefined : url}
                crossOrigin={cloudPlaybackActive ? 'anonymous' : undefined}
                controls autoPlay muted playsInline preload="auto"
                className="h-full w-full object-contain"
                onLoadedMetadata={event => {
                  setDuration(event.currentTarget.duration);
                  event.currentTarget.playbackRate = 1;
                }}
                onLoadedData={event => {
                  setReadyVideo(true);
                  setError(previous => previous.startsWith('Sharing is approved, but no video frames')
                    ? '' : previous);
                  firstFrameResolveRef.current?.();
                  firstFrameResolveRef.current = null;
                  if (restoreTimeRef.current > 0) {
                    const t = restoreTimeRef.current;
                    restoreTimeRef.current = 0;
                    const v = event.currentTarget;
                    if (Number.isFinite(v.duration)) v.currentTime = Math.min(t, Math.max(0, v.duration - 0.05));
                  }
                  startDetector();
                }}
                onPlay={() => {
                  setPlaying(true);
                  startDetector();
                }}
                onPlaying={() => {
                  setPlaying(true);
                  if (webcamRef.current) {
                    // onPlaying fires before actual pixels arrive; only
                    // maybeInfer may mark this live feed as playing.
                    setStreamHealth('buffering');
                  }
                }}
                onWaiting={() => {
                  if (webcamRef.current) {
                    captureStalledRef.current = true;
                    setStreamHealth('buffering');
                  }
                }}
                onStalled={() => {
                  if (webcamRef.current) {
                    captureStalledRef.current = true;
                    setStreamHealth('buffering');
                  }
                }}
                onPause={event => {
                  setPlaying(false);
                  if (!webcamActive && !tabCaptureActive && !cloudPlaybackActive && ownerId)
                    void localAnalysisStorage.savePosition(event.currentTarget.currentTime, ownerId).catch(() => {});
                  if (ownerId) void activityLedger.flush(ownerId).catch(console.warn);
                }}
                onSeeking={resetTracks}
                onEnded={() => {
                  setPlaying(false);
                  latestRef.current = null;
                  setVisibleCount(0);
                  if (ownerId) void activityLedger.flush(ownerId).catch(console.warn);
                }}
                onError={() => {
                  if (webcamRef.current) setStreamHealth('error');
                  firstFrameResolveRef.current?.();
                  firstFrameResolveRef.current = null;
                  setError(webcamRef.current ? 'The shared camera or browser tab was interrupted.'
                    : cloudPlaybackActive
                      ? 'This saved video could not be played in the browser. Check the B2 object, signed URL and cross-origin GET permissions.'
                      : 'The browser cannot decode this video. Try converting it to H.264 MP4.');
                }}
              />
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
              <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
                <span className="rounded-md bg-slate-950/80 px-2.5 py-1.5 text-xs font-semibold text-white">
                  {tabCaptureActive ? (
                    streamHealth === 'playing' ? 'TAB LIVE' :
                    streamHealth === 'buffering' ? 'TAB BUFFERING' : 'CONNECTING TAB'
                  ) : webcamActive ? (
                    streamHealth === 'playing' ? 'CAMERA LIVE' :
                    streamHealth === 'buffering' ? 'CAMERA BUFFERING' : 'STARTING CAMERA'
                  ) : readyVideo ? (playing ? 'PLAYING VIDEO' : 'PAUSED') : 'OPENING VIDEO'}
                </span>
                <span className="rounded-md bg-slate-950/80 px-2.5 py-1.5 text-xs font-medium text-white">
                  {detector === 'ready' ? (visibleCount ? 'Tracking ' + visibleCount + ' vehicles'
                      : detectionCount === null ? 'Scanning vehicles...' :
                        detectionCount > 0 ? 'YOLO sees ' + detectionCount + ' candidates' : 'No vehicles detected') :
                    detector === 'loading' ? 'Preparing YOLO11s...' :
                    detector === 'error' ? 'Detector unavailable' : 'Detector starting'}
                </span>
              </div>
              <button type="button" onClick={() => void toggleFullscreen()}
                title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen with tracking boxes'}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen with detections'}
                className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-slate-950/75 text-white shadow-sm transition-colors hover:bg-slate-900/95">
                {isFullscreen ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}
              </button>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-white">
              <Film size={42} className="text-[#f2a27e]" />
              <div className="text-lg font-semibold">Select an analysis source</div>
              <p className="max-w-md text-sm text-slate-300">Choose video, camera, or tab above.</p>
              <p className="max-w-md text-xs leading-5 text-slate-400">YouTube: play it in another tab → Analyze tab → Share that tab.</p>
            </div>
          )}
        </div>
        {url && (
          <div className="vg-analysis-player-footer flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="vg-analysis-source-title truncate">{filename}</div>
              <div className="vg-analysis-source-meta">
                {tabCaptureActive ? 'Live browser tab' :
                  webcamActive ? 'Live camera' : readableTime(position) + ' / ' + readableTime(duration)} · 1× playback
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void toggleFullscreen()}
                className="vg-analysis-player-button" aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
                {isFullscreen ? <Minimize2 size={15}/> : <Maximize2 size={15}/>}
                {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              </button>
              {detector === 'error' && <button type="button" onClick={startDetector}
                className="vg-analysis-player-button">
                <RefreshCw size={14} /> Retry detector
              </button>}
              {!playing && <button type="button" onClick={() => void videoRef.current?.play().catch(e => setError(String(e)))}
                className="vg-analysis-player-button">
                <Play size={14} /> Play
              </button>}
            </div>
          </div>
        )}
      </section>

      <section id="vg-analysis-telemetry" className="vg-monitor" aria-label="Live analysis telemetry">
        <div className="vg-monitor-heading">
          <div className="vg-monitor-heading-title">
            <span className="vg-monitor-overline">LIVE TELEMETRY</span>
            <h2>At a glance</h2>
          </div>
          <span className="vg-monitor-state" data-state={detector}>
            <span aria-hidden="true" className="vg-monitor-state-dot" />
            {detector === 'ready' ? 'Detector ready' :
              detector === 'loading' ? 'Starting detection' :
              detector === 'error' ? 'Detector unavailable' : 'Awaiting video'}
          </span>
        </div>
        <div className="vg-analysis-telemetry">
          <div className="vg-analysis-telemetry-card">
            <div className="vg-telemetry-title">
              <span className="vg-telemetry-icon"><Activity size={17} aria-hidden="true" /></span>
              <span>Vehicles in frame</span>
            </div>
            <div className="vg-telemetry-value tabular-nums">{visibleCount}</div>
            <p className="vg-telemetry-detail">Currently visible tracks</p>
          </div>
          <div className="vg-analysis-telemetry-card">
            <div className="vg-telemetry-title">
              <span className="vg-telemetry-icon"><Cpu size={17} aria-hidden="true" /></span>
              <span>Processing time</span>
            </div>
            <div className="vg-telemetry-value tabular-nums">
              {inferenceMs === null ? '—' : inferenceMs}
              {inferenceMs !== null && <span className="vg-telemetry-unit">ms</span>}
            </div>
            <p className="vg-telemetry-detail">{provider ? provider.toUpperCase() : 'Waiting for model'} · {analyzedFrames} analyzed frames</p>
            {provider === 'wasm' && fallbackReason && <p className="vg-telemetry-warning" title={fallbackReason}>Using CPU fallback</p>}
          </div>
          <div className="vg-analysis-telemetry-card">
            <div className="vg-telemetry-title">
              <span className="vg-telemetry-icon"><Gauge size={17} aria-hidden="true" /></span>
              <span>Speed estimate</span>
            </div>
            <div className="vg-telemetry-value tabular-nums">
              {liveMaxSpeed === null ? '—' : liveMaxSpeed === 0 ? '0' : '≈' + Math.round(liveMaxSpeed)}
              <span className="vg-telemetry-unit">km/h</span>
            </div>
            <p className="vg-telemetry-detail">Optical estimate · not calibrated</p>
          </div>
        </div>
      </section>

      <details id="vg-analysis-details" className="vg-analysis-details vg-storage-disclosure">
        <summary className="vg-storage-summary">
          <span className="vg-storage-summary-lead">
            <span className="vg-storage-summary-icon"><HardDrive size={18} aria-hidden="true"/></span>
            <span className="vg-storage-summary-copy">
              <strong>Storage &amp; privacy</strong>
              <span>Original footage, retention and backups</span>
            </span>
          </span>
          <span className="vg-storage-summary-meta">
            {!webcamActive && !tabCaptureActive && !cloudPlaybackActive &&
              <span className="vg-storage-mini-status">{saveVideo ? 'Local retention on' : 'Local retention off'}</span>}
            {cloudError && <span className="vg-storage-mini-status vg-storage-mini-error" role="alert">Cloud upload issue</span>}
            <span className="vg-storage-manage">Manage <ChevronDown size={16} aria-hidden="true"/></span>
          </span>
        </summary>
        <div className="vg-storage-content">
          <div className="vg-storage-intro">Analysis history and original video files are stored separately. You choose whether to retain the original.</div>
          <div className="vg-storage-grid">
            {!webcamActive && !tabCaptureActive && !cloudPlaybackActive &&
              <label className="vg-storage-tile vg-storage-device">
                <span className="vg-storage-tile-icon"><HardDrive size={19} aria-hidden="true"/></span>
                <span className="vg-storage-tile-text">
                  <strong>Save on this device</strong>
                  <span>Keep the latest original video for later replay.</span>
                  <span className="vg-storage-tile-status" role="status">
                    {storage === 'saving' ? 'Saving original…' :
                      storage === 'saved' ? 'Original saved locally' :
                      storage === 'error' ? 'Unable to save locally' :
                      saveVideo ? 'Local retention enabled' : 'Local retention disabled'}
                  </span>
                </span>
                <input type="checkbox" checked={saveVideo}
                  onChange={event => changeSaveVideo(event.target.checked)}
                  disabled={!ownerId} className="vg-storage-switch"
                  aria-label="Keep this video on this device" />
              </label>}
            {!webcamActive && !tabCaptureActive && currentFileRef.current && (
              <div className="vg-storage-tile vg-storage-cloud">
                <span className="vg-storage-tile-icon"><Cloud size={19} aria-hidden="true"/></span>
                <div className="vg-storage-tile-text">
                  <div className="vg-storage-cloud-title">
                    <strong>Cloud backup</strong>
                    <span className="vg-storage-cloud-badge" data-status={
                      cloudUnavailable || cloudAvailability === 'unconfigured' ? 'unavailable' :
                      cloudAvailability === 'configured' ? 'ready' : 'pending'
                    }>
                      {cloudUnavailable || cloudAvailability === 'unconfigured' ? 'Unavailable' :
                        cloudAvailability === 'configured' ? 'Available' :
                        cloudAvailability === 'checking' ? 'Checking' : 'Status unknown'}
                    </span>
                  </div>
                  <span>
                    {cloudAvailability === 'unconfigured' || cloudUnavailable ?
                      'Backblaze B2 is not configured. No file was uploaded.' :
                      cloudAvailability === 'error' ?
                      'Cloud availability could not be verified. Uploads are disabled.' :
                      cloudAvailability === 'checking' ?
                      'Checking secure cloud storage…' :
                      'Optional cloud copy. Upload only when you choose to.'}
                  </span>
                  {!cloudUpload && !cloudUnavailable && cloudAvailability === 'configured' &&
                    <button type="button" onClick={() => void saveCurrentVideoToB2()}
                      disabled={cloudStarting} className="vg-storage-upload">
                      <Upload size={15} aria-hidden="true"/>
                      {cloudStarting ? 'Preparing upload…' : 'Upload original to B2'}
                    </button>}
                  {cloudUpload && <div className="vg-storage-progress">
                    <div className="vg-storage-progress-head">
                      <span>{cloudUpload.status === 'uploaded' ? 'Saved to Backblaze B2' :
                        cloudUpload.status === 'failed' ? 'Cloud upload failed' : 'Uploading…'}</span>
                      {cloudUpload.status !== 'failed' && <span>{cloudUpload.progress}%</span>}
                    </div>
                    {cloudUpload.status !== 'failed' && <div className="vg-storage-progress-track">
                      <div style={{ width: Math.max(0, Math.min(100, cloudUpload.progress)) + '%' }} />
                    </div>}
                    {cloudUpload.status === 'uploaded' &&
                      <a href="/app/archive-videos" className="vg-storage-archive">View cloud archive</a>}
                  </div>}
                  {cloudError && <div className="vg-storage-error" role="alert">
                    <p>{cloudError}</p>
                    {(!saveVideo || storage === 'error') && <button type="button"
                      disabled={storage === 'saving'} onClick={() => changeSaveVideo(true)}
                      className="vg-storage-upload"><HardDrive size={15}/> Keep locally instead</button>}
                  </div>}
                </div>
              </div>
            )}
          </div>
          <div className="vg-storage-notice">
            <Info size={17} aria-hidden="true" />
            <p><strong>About detection accuracy</strong>
              Speed values are uncalibrated visual estimates—not measured road speeds.
              Potential high-speed and stationary-vehicle events require human review.
              Crash, helmet and signal violations cannot be verified by this vehicle model.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
