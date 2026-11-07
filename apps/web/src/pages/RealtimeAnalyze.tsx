import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Camera, Film, Play, RefreshCw, Radio, Upload, X } from 'lucide-react';
import { localAnalysisStorage } from '../services/localAnalysisStorage';
import { uploadManager, type ActiveUpload } from '../services/uploadManager';
import { uploadStorageProvider } from '../services/videoStorage';
import { activityLedger } from '../services/activityLedger';
import { streamCatalog, type StreamSource } from '../services/streamCatalog';
import { isStreamStalled, liveRetryDelay } from '../services/streamRecovery';
import Hls from 'hls.js';
import { useAuthStore } from '../store/auth';
import { advanceOpticalTracks, takeGrayFrame, type GrayFrame } from '../pipeline/tracker/opticalTracking';
import { reconcileVehicles, recoverBriefOpticalMisses, updateScreenSpeed, type PersistentTrack, type SpeedHistory } from '../pipeline/tracker/stableVehicles';
import {
  projectLiveTracks, type LiveTrack
} from '../pipeline/tracker/liveProjection';

const MODEL_PATH = '/models/yolo11s.onnx';
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
type StreamHealth = 'idle' | 'connecting' | 'playing' | 'buffering' | 'reconnecting' | 'error';
const MAX_STREAM_RETRIES = 3;
const STREAM_STALL_MS = 15_000;
const BROWSER_CAMERA_SOURCE = 'visionguard:browser-camera';

function readableTime(value: number) {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' +
    (seconds % 60).toString().padStart(2, '0');
}

type Observation = { time: number; tracks: LiveTrack[] };

export default function RealtimeAnalyze({ active = true }: { active?: boolean }) {
  const ownerId = useAuthStore(state => state.user?.id ?? null);
  const activeRunRef = useRef('');
  const currentFileRef = useRef<File | null>(null);
  const currentHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [saveVideo, setSaveVideo] = useState(false);
  const cloudUploadIdRef = useRef<string | null>(null);
  const cloudUnsubscribeRef = useRef<(() => void) | null>(null);
  const [cloudUpload, setCloudUpload] = useState<ActiveUpload | null>(null);
  const [cloudStarting, setCloudStarting] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [streams, setStreams] = useState<StreamSource[]>([]);
  const [streamSource, setStreamSource] = useState<StreamSource | null>(null);
  const streamSourceRef = useRef<StreamSource | null>(null);
  const [streamHealth, setStreamHealth] = useState<StreamHealth>('idle');
  const [streamReloadKey, setStreamReloadKey] = useState(0);
  const lastPresentedAtRef = useRef(0);
  const mediaReadyRef = useRef(false);
  const captureErrorRef = useRef(false);
  const streamRetryCountRef = useRef(0);
  const streamExhaustedRef = useRef(false);
  const lastStreamFailureRef = useRef(0);
  const [streamRetries, setStreamRetries] = useState(0);
  const webcamRef = useRef<MediaStream | null>(null);
  const [webcamActive, setWebcamActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [showStreamForm, setShowStreamForm] = useState(false);
  const [streamLabel, setStreamLabel] = useState('');
  const [streamUrlInput, setStreamUrlInput] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  const loadStartRef = useRef(0);
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
  const lastOpticalSampleRef = useRef(-Infinity);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const firstFrameResolveRef = useRef<(() => void) | null>(null);
  const paintCountRef = useRef(0);

  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [openedSeconds, setOpenedSeconds] = useState<number | null>(null);
  const [readyVideo, setReadyVideo] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [detector, setDetector] = useState<DetectorState>('idle');
  const [provider, setProvider] = useState('');
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [analyzedFrames, setAnalyzedFrames] = useState(0);
  const [detectionCount, setDetectionCount] = useState<number | null>(null);
  const [fallbackReason, setFallbackReason] = useState('');
  const [storage, setStorage] = useState<'idle' | 'saving' | 'saved' | 'error' | 'not-saved'>('idle');
  const [error, setError] = useState('');

  const clearInFlight = useCallback(() => {
    if (inFlightTimeoutRef.current !== null) clearTimeout(inFlightTimeoutRef.current);
    inFlightTimeoutRef.current = null;
    inFlightIdRef.current = null;
    busyRef.current = false;
  }, []);

  const resetTracks = useCallback(() => {
    generationRef.current += 1;
    latestRef.current = null;
    captureErrorRef.current = false;
    flowTracksRef.current = [];
    speedHistoryRef.current.clear();
    detectorToStableIdRef.current.clear();
    nextStableIdRef.current = 1;
    grayHistoryRef.current = [];
    lastOpticalSampleRef.current = -Infinity;
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
          flowTracksRef.current = [];
          latestRef.current = null;
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
        flowTracksRef.current = merged.tracks;
        latestRef.current = { time: latestTime, tracks: merged.tracks };
        const account = useAuthStore.getState().user?.id;
        if (account && activeRunRef.current) {
          activityLedger.observe(account, activeRunRef.current, latestTime, merged.tracks);
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
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const nextUrl = URL.createObjectURL(file);
    urlRef.current = nextUrl;
    loadStartRef.current = performance.now();
    restoreTimeRef.current = savedPosition;
    setFilename(name);
    setOpenedSeconds(null);
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

  const stopWebcam = () => {
    const active = webcamRef.current;
    webcamRef.current = null;
    if (videoRef.current?.srcObject === active) videoRef.current.srcObject = null;
    active?.getTracks().forEach(track => track.stop());
    setWebcamActive(false);
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
      if (request !== uploadGenerationRef.current || !activeRef.current) {
        // Camera permission can finish after navigating away; do not create
        // a hidden live capture in that case.
        camera.getTracks().forEach(track => track.stop());
        return;
      }
      videoRef.current?.pause();
      stopWebcam();
      resetTracks();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
      currentFileRef.current = null;
      currentHandleRef.current = null;
      streamSourceRef.current = null;
      setStreamSource(null);
      if (ownerId) streamCatalog.select(ownerId, null);
      webcamRef.current = camera;
      setWebcamActive(true);
      setUrl(BROWSER_CAMERA_SOURCE);
      setFilename('Browser camera · live');
      setReadyVideo(false);
      setPlaying(false);
      setOpenedSeconds(null);
      setStreamHealth('connecting');
      setStorage('not-saved');
      setDuration(0);
      setPosition(0);
      loadStartRef.current = performance.now();
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

  const chooseStream = (source: StreamSource) => {
    stopWebcam();
    videoRef.current?.pause();
    uploadGenerationRef.current += 1;
    resetTracks();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    currentFileRef.current = null;
    currentHandleRef.current = null;
    cloudUnsubscribeRef.current?.();
    cloudUnsubscribeRef.current = null;
    cloudUploadIdRef.current = null;
    setCloudUpload(null);
    setCloudError('');
    setReadyVideo(false);
    mediaReadyRef.current = false;
    setOpenedSeconds(null);
    setDuration(0);
    setPosition(0);
    setFilename(source.name);
    setUrl(source.url);
    streamSourceRef.current = source;
    setStreamSource(source);
    setStreamHealth('connecting');
    mediaReadyRef.current = false;
    lastPresentedAtRef.current = performance.now();
    streamRetryCountRef.current = 0;
    streamExhaustedRef.current = false;
    lastStreamFailureRef.current = 0;
    setStreamRetries(0);
    captureErrorRef.current = false;
    setStorage('not-saved');
    setError('');
    loadStartRef.current = performance.now();
    restoreTimeRef.current = 0;
    if (ownerId) {
      streamCatalog.select(ownerId, source.id);
      activeRunRef.current = 'stream:' + source.id + ':' + new Date().toISOString().slice(0,10);
      activityLedger.begin(ownerId, activeRunRef.current, source.name, 'live-stream');
    }
  };

  useEffect(() => {
    const preference = ownerId
      ? localStorage.getItem('visionguard:save-video:' + ownerId) === 'yes'
      : false;
    setSaveVideo(preference);
    if (!ownerId) { setStreams([]); return; }
    const known = streamCatalog.list(ownerId);
    setStreams(known);
    const activeId = streamCatalog.active(ownerId);
    const activeSource = known.find(source=>source.id===activeId);
    if (activeSource && !urlRef.current && !currentFileRef.current) {
      // The saved choice remains selected after refresh.
      chooseStream(activeSource);
    }
    const startedGeneration = uploadGenerationRef.current;
    let mounted = true;
    void streamCatalog.refresh(ownerId).then(remote => {
      if (!mounted) return;
      setStreams(remote);
      const selected = remote.find(source=>source.id===streamCatalog.active(ownerId));
      if (selected && !currentFileRef.current &&
          startedGeneration === uploadGenerationRef.current &&
          streamSourceRef.current?.id !== selected.id) chooseStream(selected);
    }).catch(error => {
      if (mounted) setError('Live sources available on this device; cloud sync unavailable: ' + String(error));
    });
    return () => { mounted = false; };
  }, [ownerId]);

  useEffect(() => {
    let alive = true;
    if (!ownerId || streamCatalog.active(ownerId) ||
        localStorage.getItem('visionguard:save-video:' + ownerId) !== 'yes') return;
    const generation = uploadGenerationRef.current;
    void Promise.all([
      localAnalysisStorage.loadVideo(ownerId ?? undefined),
      localAnalysisStorage.loadPosition(ownerId ?? undefined)
    ]).then(([saved, savedPosition]) => {
      if (!alive || generation !== uploadGenerationRef.current || !saved) return;
      const file = saved.file instanceof File
        ? saved.file
        : new File([saved.file], saved.name, { type: saved.file.type || 'video/mp4' });
      currentFileRef.current = file;
      const savedRunId = localStorage.getItem('visionguard:video-run:' + ownerId) || undefined;
      attachVideo(file, saved.name, savedPosition, savedRunId);
      setStorage('saved');
    }).catch(e => {
      if (alive && generation === uploadGenerationRef.current) {
        setError('Could not reopen the previously selected file. Choose it again: ' + String(e));
      }
    });
    return () => {
      alive = false;
      clearInFlight();
      workerRef.current?.terminate();
      workerRef.current = null;
      readyRef.current = false;
      firstFrameResolveRef.current?.();
      // Camera permissions must not leave a capture track running after
      // this persistent analysis component unmounts or the user signs out.
      webcamRef.current?.getTracks().forEach(track => track.stop());
      webcamRef.current = null;
      cloudUnsubscribeRef.current?.();
      cloudUnsubscribeRef.current = null;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [attachVideo, clearInFlight, ownerId]);

  const acceptFile = async (file: File, handle?: FileSystemFileHandle) => {
    if (!/\.(mp4|m4v|webm|mov|mkv)$/i.test(file.name) && !file.type.startsWith('video/')) {
      setError('Choose a valid video file. H.264 MP4 provides the broadest Edge compatibility.');
      return;
    }
    uploadGenerationRef.current += 1;
    streamSourceRef.current = null;
    stopWebcam();
    setStreamSource(null);
    setStreamHealth('idle');
    if (ownerId) streamCatalog.select(ownerId, null);
    currentFileRef.current = file;
    currentHandleRef.current = handle ?? null;
    cloudUnsubscribeRef.current?.();
    cloudUnsubscribeRef.current = null;
    cloudUploadIdRef.current = null;
    setCloudUpload(null);
    setCloudError('');
    setCloudStarting(false);
    const generation = uploadGenerationRef.current;
    const decoded = new Promise<void>(resolve => {
      firstFrameResolveRef.current?.();
      firstFrameResolveRef.current = resolve;
    });
    attachVideo(file, file.name);
    // Video is never retained unless the user explicitly opted in.
    const shouldSave = ownerId && localStorage.getItem('visionguard:save-video:' + ownerId) === 'yes';
    setStorage(shouldSave ? 'saving' : 'not-saved');
    persistenceQueueRef.current = persistenceQueueRef.current.catch(() => {}).then(async () => {
      if (generation !== uploadGenerationRef.current) return;
      if (!shouldSave) {
        await localAnalysisStorage.clearVideo(ownerId ?? undefined);
      } else if (handle) {
        await localAnalysisStorage.saveVideoHandle(handle, file.name, ownerId ?? undefined);
      } else {
        await decoded;
        if (generation !== uploadGenerationRef.current) return;
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
      setError('Local storage failed; this video can still play: ' + String(e));
    });
  };

  const addStream = () => {
    if (!ownerId) return;
    try {
      const source = streamCatalog.add(ownerId, streamLabel, streamUrlInput);
      setStreams(streamCatalog.list(ownerId));
      setShowStreamForm(false);
      setStreamLabel('');
      setStreamUrlInput('');
      chooseStream(source);
      void streamCatalog.saveRemote(ownerId, source).catch(error => {
        setError('Source saved locally, but cross-device sync failed: ' + String(error));
      });
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };

  const saveCurrentVideoToB2 = async () => {
    const file = currentFileRef.current;
    if (!file || !ownerId || streamSource || cloudStarting || cloudUploadIdRef.current) return;
    setCloudStarting(true);
    setCloudError('');
    try {
      if (uploadStorageProvider().id !== 'b2') {
        throw new Error('Cloud video saving is restricted to Backblaze B2.');
      }
      // The existing UploadManager writes a metadata row and uses the
      // authenticated B2 signing function. File bytes go directly to B2.
      // No upload occurs unless the user clicks this button.
      const { videoId } = await uploadManager.startUpload(file);
      cloudUploadIdRef.current = videoId;
      cloudUnsubscribeRef.current?.();
      cloudUnsubscribeRef.current = uploadManager.subscribe(videoId, upload => {
        setCloudUpload(upload);
        if (upload.status === 'failed') setCloudError(upload.error || 'B2 upload failed.');
      });
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : String(error));
    } finally {
      setCloudStarting(false);
    }
  };

  const chooseVideo = async () => {
    const picker = (window as Window & {
      showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
    }).showOpenFilePicker;
    if (!picker) { inputRef.current?.click(); return; }
    try {
      const [handle] = await picker.call(window, { multiple: false });
      if (handle) await acceptFile(await handle.getFile(), handle);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      inputRef.current?.click();
    }
  };

  const reopenSavedVideo = async () => {
    if (!ownerId) return;
    try {
      const [saved, savedPosition] = await Promise.all([
        localAnalysisStorage.loadVideo(ownerId),
        localAnalysisStorage.loadPosition(ownerId),
      ]);
      if (!saved) {
        setError('No retained video was found. Choose a file and enable “Keep this video on this device” first.');
        return;
      }
      videoRef.current?.pause();
      uploadGenerationRef.current += 1;
      stopWebcam();
      streamSourceRef.current = null;
      setStreamSource(null);
      setStreamHealth('idle');
      streamCatalog.select(ownerId, null);
      const file = saved.file instanceof File
        ? saved.file : new File([saved.file], saved.name, { type: saved.file.type || 'video/mp4' });
      currentFileRef.current = file;
      currentHandleRef.current = null;
      attachVideo(file, saved.name, savedPosition,
        localStorage.getItem('visionguard:video-run:' + ownerId) || undefined);
      setStorage('saved');
    } catch (error) {
      setError('Cannot reopen saved video: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  const removeVideo = () => {
    // Stopping a live stream/camera must NEVER delete an unrelated video
    // previously saved by the user on this device.
    const removingLocalFile = !!currentFileRef.current &&
      !streamSourceRef.current && !webcamRef.current;
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
    streamSourceRef.current = null;
    stopWebcam();
    setStreamSource(null);
    setStreamHealth('idle');
    if (ownerId) streamCatalog.select(ownerId, null);
    currentFileRef.current = null;
    currentHandleRef.current = null;
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

  const reconnectStream = () => {
    if (!streamSourceRef.current) return;
    resetTracks();
    setError('');
    setStreamHealth('connecting');
    lastPresentedAtRef.current = performance.now();
    streamRetryCountRef.current = 0;
    streamExhaustedRef.current = false;
    lastStreamFailureRef.current = 0;
    setStreamRetries(0);
    captureErrorRef.current = false;
    setStreamReloadKey(value => value + 1);
  };

  useEffect(() => {
    if (!webcamActive) return;
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
  }, [webcamActive, url]);

  useEffect(() => {
    if (!streamSource) return;
    const timeout = window.setTimeout(() => {
      if (streamSourceRef.current?.id !== streamSource.id || mediaReadyRef.current) return;
      setStreamHealth('error');
      setError('The stream has not produced a playable video frame. Check source availability, format and CORS; press Reconnect to retry.');
    }, 20_000);
    return () => window.clearTimeout(timeout);
  }, [streamSource, streamReloadKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamSource || streamSource.format !== 'hls') return;
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 20,
        maxBufferLength: 15,
      });
      let retryTimer: number | null = null;
      let closed = false;
      hls.attachMedia(video);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (!closed) hls.loadSource(streamSource.url);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (closed) return;
        setStreamHealth('connecting');
        void video.play().catch(() => {
          // Some browsers require the user to press Play, even while muted.
          setStreamHealth('buffering');
        });
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (closed || !data.fatal || streamExhaustedRef.current) return;
        const attempt = ++streamRetryCountRef.current;
        lastStreamFailureRef.current = performance.now();
        setStreamRetries(attempt);
        if (attempt > MAX_STREAM_RETRIES) {
          streamExhaustedRef.current = true;
          setStreamHealth('error');
          setError('Live stream stopped (' + data.details +
            '). Check its availability, codec and CORS settings, then press Reconnect.');
          hls.stopLoad();
          return;
        }
        setStreamHealth('reconnecting');
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          if (closed) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else hls.startLoad();
        }, liveRetryDelay(attempt));
      });
      return () => {
        closed = true;
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        hls.destroy();
      };
    }
    // Safari supports HLS natively and handles reconnection independently.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamSource.url;
      return;
    }
    setStreamHealth('error');
    setError('HLS is not supported by this browser. Use a compatible Edge/Chrome/Safari version.');
  }, [streamSource, streamReloadKey]);

  // Media can stall without emitting an HLS fatal error. Make the stalled
  // state visible instead of showing a misleading permanent LIVE badge.
  useEffect(() => {
    if (!streamSource || !active) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || streamExhaustedRef.current || !isStreamStalled(
        performance.now(), lastPresentedAtRef.current,
        { paused: video.paused, ended: video.ended, seeking: video.seeking },
        STREAM_STALL_MS
      )) return;
      if (streamSource.format !== 'hls') {
        setStreamHealth('buffering');
        return;
      }
      const attempts = ++streamRetryCountRef.current;
      lastStreamFailureRef.current = performance.now();
      setStreamRetries(attempts);
      if (attempts > MAX_STREAM_RETRIES) {
        streamExhaustedRef.current = true;
        setStreamHealth('error');
        setError('Live stream stopped producing video frames. Press Reconnect to try again.');
        return;
      }
      lastPresentedAtRef.current = performance.now();
      setStreamHealth('reconnecting');
      resetTracks();
      setStreamReloadKey(value => value + 1);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [streamSource, active, resetTracks]);

  useEffect(() => {
    if (active) return;
    const video = videoRef.current;
    video?.pause();
    if (webcamRef.current) {
      // Releasing the camera on navigation is a deliberate privacy safeguard.
      stopWebcam();
      setUrl('');
      setStreamHealth('idle');
      resetTracks();
    }
    if (video && !streamSourceRef.current && !webcamRef.current &&
        Number.isFinite(video.currentTime)) {
      void localAnalysisStorage.savePosition(video.currentTime, ownerId ?? undefined).catch(() => {});
    }
  }, [active]);

  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (document.hidden && video) {
        const account = useAuthStore.getState().user?.id;
        if (account) void activityLedger.flush(account).catch(console.warn);
        video.pause();
        if (webcamRef.current) {
          stopWebcam();
          setUrl('');
          setStreamHealth('idle');
          resetTracks();
        } else if (!streamSourceRef.current && account) {
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
    const handle = currentHandleRef.current;
    setStorage(checked && file ? 'saving' : 'not-saved');
    persistenceQueueRef.current = persistenceQueueRef.current.catch(() => {}).then(async () => {
      if (!checked || !file) {
        await localAnalysisStorage.clearVideo(ownerId ?? undefined);
        return;
      }
      if (handle) await localAnalysisStorage.saveVideoHandle(handle, file.name, ownerId ?? undefined);
      else await localAnalysisStorage.saveVideo(file, file.name, ownerId ?? undefined);
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
      if (streamSourceRef.current || webcamRef.current) {
        lastPresentedAtRef.current = performance.now();
        // Reset retry budget only after a sustained healthy run, not after a
        // one-frame recovery that fails again a moment later.
        if (lastStreamFailureRef.current > 0 &&
            performance.now() - lastStreamFailureRef.current > 30_000) {
          lastStreamFailureRef.current = 0;
          streamRetryCountRef.current = 0;
          setStreamRetries(0);
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
              for (const id of speedHistoryRef.current.keys()) {
                if (!activeIds.has(id)) speedHistoryRef.current.delete(id);
              }
              latestRef.current = { time: current.time, tracks: flowTracksRef.current };
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
          if (streamSourceRef.current) setStreamHealth('error');
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
        if (streamSourceRef.current) setStreamHealth('error');
      });
    };

    const schedule = () => {
      if (stopped) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        presentedId = video.requestVideoFrameCallback((_, metadata) => {
          maybeInfer(metadata.mediaTime);
          schedule();
        });
      } else {
        fallbackId = requestAnimationFrame(() => {
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
  }, [url, streamSource?.id, streamReloadKey, webcamActive, clearInFlight]);

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
        if (context) {
          context.clearRect(0, 0, canvas.width, canvas.height);
          const observation = latestRef.current;
          if (observation && video.videoWidth && video.videoHeight && !video.seeking && !video.ended) {
            const frameWidth = video.videoWidth;
            const frameHeight = video.videoHeight;
            const fit = Math.min(width / frameWidth, height / frameHeight);
            const offsetX = (width - frameWidth * fit) / 2;
            const offsetY = (height - frameHeight * fit) / 2;
            const tracks = projectLiveTracks(observation.tracks, observation.time, video.currentTime, frameWidth, frameHeight);
            context.save();
            context.scale(dpr, dpr);
            context.beginPath();
            context.rect(offsetX, offsetY, frameWidth * fit, frameHeight * fit);
            context.clip();
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
              const classLabel = stable.className.toUpperCase();
              // Speed is deliberately marked approximate: vehicle width is an
              // assumed reference, not a calibrated road-plane distance.
              const speed = stable.speedKmh === null
                ? '— km/h'
                : stable.speedKmh === 0 ? '0 km/h' : '≈' + Math.round(stable.speedKmh) + ' km/h';
              const label = '#' + stable.id + ' ' + classLabel + '  ' + speed;
              context.font = '600 11px system-ui,sans-serif';
              const labelW = context.measureText(label).width + 12;
              // Keep the ID, class and speed label at a FIXED offset inside the
              // vehicle box. Never use varying above/below placements.
              // Do not reposition the tag when it nears an edge. A shifting
              // clamp made labels visibly jump away from their vehicle.
              // The video clip rectangle already hides any off-screen portion.
              const labelX = x + 3;
              const labelY = y + 3;
              context.fillStyle = 'rgba(7,16,34,.90)';
              context.fillRect(labelX, labelY, labelW, 18);
              context.fillStyle = '#ccffeb';
              context.fillText(label, labelX + 6, labelY + 13);
            }
            context.restore();
          }
        }
        if (time - lastUI > 250) {
          lastUI = time;
          setPosition(video.currentTime);
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
    <div className="vg-page space-y-5">
      <header className="vg-page-header">
        <div>
          <h1>Live analysis</h1>
          <p>Video, stream, and camera detection</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          {(streamSource || webcamActive) && saveVideo && <button type="button"
            onClick={() => void reopenSavedVideo()}
            className="vg-secondary">
            <Film size={16}/> Saved video
          </button>}
          <button type="button" onClick={() => setShowStreamForm(v=>!v)}
            className="vg-secondary">
            {showStreamForm ? 'Close sources' : 'Live sources'}
          </button>
          {url && !webcamActive && <button type="button" aria-label="Close current source" onClick={removeVideo}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600 hover:bg-slate-50"><X size={18} /></button>}
        </div>
      </header>

      {(showStreamForm || streams.length > 0) && <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Radio size={16} className="text-indigo-500"/> Live stream sources
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Select one of your saved HLS (.m3u8) or direct video sources. Source names and URLs sync with your account.
            </p>
          </div>
          <span className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {streams.length} saved {streams.length === 1 ? 'source' : 'sources'}
          </span>
        </div>
        {streams.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {streams.map(source => {
            const selected = streamSource?.id === source.id;
            return <button key={source.id} type="button" onClick={() => chooseStream(source)}
              aria-pressed={selected}
              className={'flex min-w-0 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ' +
                (selected ? 'border-indigo-400 bg-indigo-50 text-indigo-950' :
                  'border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-300 hover:bg-white')}>
              <Radio size={17} className={selected ? 'shrink-0 text-indigo-600' : 'shrink-0 text-slate-400'}/>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{source.name}</span>
                <span className="block truncate text-[11px] text-slate-500">
                  {source.format === 'hls' ? 'HLS stream' : 'Video URL'}
                  {selected ? ' · Selected' : ''}
                </span>
              </span>
              {selected && <span className="h-2 w-2 shrink-0 rounded-full bg-indigo-500"/>}
            </button>;
          })}
        </div>}
        {showStreamForm && <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <input aria-label="Source name" placeholder="Camera A · Main road" value={streamLabel}
            onChange={e=>setStreamLabel(e.target.value)} maxLength={80}
            className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm"/>
          <input aria-label="Stream URL" placeholder="https://example.com/live/playlist.m3u8"
            value={streamUrlInput} onChange={e=>setStreamUrlInput(e.target.value)}
            className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-sm"/>
          <button type="button" onClick={addStream} disabled={!ownerId}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Save and select
          </button>
        </div>}
        {streamSource && <button type="button" onClick={()=>{
          if (!ownerId) return;
          const sourceId = streamSource.id;
          streamCatalog.remove(ownerId, sourceId);
          setStreams(streamCatalog.list(ownerId));
          removeVideo();
          void streamCatalog.removeRemote(ownerId, sourceId).catch(error => {
            setError('Stream removed here, but cloud removal is pending: ' + String(error));
          });
        }} className="text-xs font-medium text-red-600">Remove selected source</button>}
        <p className="text-xs leading-5 text-slate-500">
          Only one source is analyzed at a time, using the existing YOLO11s detector.
          Remote feeds must allow browser playback and cross-origin frame access (CORS).
          RTSP feeds need an authenticated HLS conversion service. Do not paste private camera passwords or secret-bearing URLs.
        </p>
      </section>}

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <AlertTriangle size={18} className="shrink-0" /><span>{error}</span>
      </div>}

      <section className="vg-panel overflow-hidden">
        <div className="relative aspect-video w-full overflow-hidden bg-[#080e20]">
          {url ? (
            <>
              <video key={webcamActive ? 'browser-camera' :
                  streamSource ? streamSource.id + ':' + streamReloadKey : 'uploaded-file'}
                ref={videoRef} src={webcamActive || streamSource?.format === 'hls' ? undefined : url}
                crossOrigin={streamSource ? 'anonymous' : undefined}
                controls autoPlay muted playsInline preload="auto"
                className="h-full w-full object-contain"
                onLoadedMetadata={event => {
                  setDuration(event.currentTarget.duration);
                  event.currentTarget.playbackRate = 1;
                }}
                onLoadedData={event => {
                  mediaReadyRef.current = true;
                  setReadyVideo(true);
                  setOpenedSeconds((performance.now() - loadStartRef.current) / 1000);
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
                  mediaReadyRef.current = true;
                  setPlaying(true);
                  if (streamSourceRef.current || webcamRef.current) {
                    setStreamHealth('playing');
                    streamExhaustedRef.current = false;
                    lastPresentedAtRef.current = performance.now();
                    setError(previous => previous.startsWith('Live stream stopped') ||
                      previous.startsWith('This stream cannot') ||
                      previous.startsWith('The stream has not produced') ? '' : previous);
                  }
                }}
                onWaiting={() => {
                  if (streamSourceRef.current || webcamRef.current) setStreamHealth('buffering');
                }}
                onStalled={() => {
                  if (streamSourceRef.current || webcamRef.current) setStreamHealth('buffering');
                }}
                onPause={event => {
                  setPlaying(false);
                  if (!streamSource && !webcamActive)
                    void localAnalysisStorage.savePosition(event.currentTarget.currentTime, ownerId ?? undefined).catch(() => {});
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
                  if (streamSourceRef.current || webcamRef.current) setStreamHealth('error');
                  firstFrameResolveRef.current?.();
                  firstFrameResolveRef.current = null;
                  setError(streamSource
                    ? 'This stream cannot be played. Check its URL, media codec, availability and CORS headers.'
                    : webcamRef.current ? 'The camera stream was interrupted.'
                    : 'The browser cannot decode this video. Try converting it to H.264 MP4.');
                }}
              />
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
              <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
                <span className="rounded-md bg-slate-950/80 px-2.5 py-1.5 text-xs font-semibold text-white">
                  {webcamActive ? (
                    streamHealth === 'playing' ? 'CAMERA LIVE' :
                    streamHealth === 'buffering' ? 'CAMERA BUFFERING' : 'STARTING CAMERA'
                  ) : streamSource ? (
                    streamHealth === 'playing' ? 'STREAM LIVE' :
                    streamHealth === 'reconnecting' ? 'RECONNECTING ' + streamRetries + '/' + MAX_STREAM_RETRIES :
                    streamHealth === 'buffering' ? 'BUFFERING' :
                    streamHealth === 'error' ? 'STREAM OFFLINE' : 'CONNECTING'
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
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-white">
              <Film size={42} className="text-indigo-300" />
              <div className="text-lg font-semibold">Select a traffic video</div>
              <p className="max-w-md text-sm text-slate-300">Playback starts right away. Detection runs alongside the video, not before it.</p>
              <button type="button" onClick={() => void chooseVideo()}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900">Open local video</button>
            </div>
          )}
        </div>
        {url && (
          <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{filename}</div>
              <div className="mt-1 text-xs text-slate-500">
                {webcamActive ? 'LIVE CAMERA' :
                  streamSource ? 'LIVE STREAM' : readableTime(position) + ' / ' + readableTime(duration)} · Playback at 1×
                {openedSeconds !== null ? ' · Opened in ' + openedSeconds.toFixed(2) + 's' : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {streamSource && <button type="button" onClick={reconnectStream}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">
                <RefreshCw size={14} /> Reconnect stream
              </button>}
              {detector === 'error' && <button type="button" onClick={startDetector}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">
                <RefreshCw size={14} /> Retry detector
              </button>}
              {!playing && <button type="button" onClick={() => void videoRef.current?.play().catch(e => setError(String(e)))}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">
                <Play size={14} /> Play
              </button>}
            </div>
          </div>
        )}
      </section>

      {!streamSource && !webcamActive && <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
        <input type="checkbox" checked={saveVideo} onChange={event => changeSaveVideo(event.target.checked)}
          disabled={!ownerId} className="h-4 w-4 accent-indigo-600" />
        <span className="flex-1"><strong>Keep this video on this device</strong>
          <span className="block text-xs text-slate-500">
            Optional. Off means no video file is retained; vehicle counts and analysis history still persist locally.
            {storage === 'saving' ? ' Saving…' : storage === 'saved' ? ' Video saved.' : ''}
          </span>
        </span>
      </label>}
      {!streamSource && !webcamActive && currentFileRef.current && (
        <div className="vg-panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">Backblaze B2 · optional cloud storage</div>
              <p className="mt-1 text-xs text-slate-500">This video stays local unless you explicitly save it.
                Cloud saving uploads the original video to B2, never Supabase Storage.
                Analysis statistics are stored separately.</p>
            </div>
            {!cloudUpload && (
              <button type="button" onClick={() => void saveCurrentVideoToB2()} disabled={cloudStarting}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {cloudStarting ? 'Preparing B2 upload…' : 'Save video to B2'}
              </button>
            )}
          </div>
          {cloudUpload && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{cloudUpload.status === 'uploaded' ? 'Saved in Backblaze B2' :
                  cloudUpload.status === 'failed' ? 'B2 upload failed' : 'Uploading to Backblaze B2'}</span>
                <span className="font-semibold tabular-nums">{cloudUpload.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-indigo-600 transition-[width]"
                  style={{ width: Math.max(0, Math.min(100, cloudUpload.progress)) + '%' }}/>
              </div>
              {cloudUpload.status === 'uploaded' && <a href="/app/archive-videos"
                className="inline-block text-xs font-semibold text-indigo-600 hover:underline">View cloud video archive</a>}
            </div>
          )}
          {cloudError && <p role="alert" className="mt-2 text-xs text-red-700">{cloudError}</p>}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><Activity size={14} /> Vehicles in frame</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{visibleCount}</div>
          <div className="text-xs text-slate-500">Stable tracks and high-confidence new vehicles</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">YOLO11s inference</div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
            {inferenceMs === null ? '—' : inferenceMs + ' ms'}
          </div>
          <div className="text-xs text-slate-500">{provider ? provider.toUpperCase() : 'Preparing'} · {analyzedFrames} sampled frames · {detectionCount ?? '—'} raw vehicles</div>
          {provider === 'wasm' && fallbackReason && <div className="mt-1 text-[11px] leading-4 text-amber-700" title={fallbackReason}>WebGPU unavailable; using slower CPU/WASM</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Vehicle speed · estimated km/h</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">≈ km/h · stationary = 0 km/h</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">Auto-estimate from vehicle image size and motion. Not measured speed: camera calibration is needed for reliable km/h.</div>
        </div>
      </div>

      <p className="vg-footnote">
        Speed values are uncalibrated visual estimates, not verified road speeds.
        {storage === 'saving' ? ' Saving locally…' : storage === 'saved' ? ' Local copy retained.' : ''}
      </p>
    </div>
  );
}
