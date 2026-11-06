import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Film, Loader2, Pause, Play, RotateCcw, Upload, X } from 'lucide-react';
import { localAnalysisStorage, type LocalAnalysis, type LocalFrame, type LocalTrack } from '../services/localAnalysisStorage';

const MODEL = '/models/yolo11s.onnx';
const VIDEO_LOAD_TIMEOUT_MS = 10_000;
const STEP = 0.10; // 10 observed frames/second; interpolate each confirmed track during native-rate playback.
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'];

type WorkerReply =
  | { type: 'ready'; provider: string }
  | { type: 'result'; requestId: number; time: number; tracks: LocalTrack[]; detections: number }
  | { type: 'error'; requestId: number; message: string };

type Status = 'empty' | 'ready' | 'processing' | 'completed' | 'error';

function readableTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  return Math.floor(s / 60).toString().padStart(2, '0') + ':' + (s % 60).toString().padStart(2, '0');
}

function interpolate(a: LocalTrack, b: LocalTrack, factor: number): LocalTrack {
  const mix = (x: number, y: number) => x + (y - x) * factor;
  return { ...a, x: mix(a.x, b.x), y: mix(a.y, b.y), w: mix(a.w, b.w), h: mix(a.h, b.h) };
}

/** Only interpolate observations of the SAME tracked object across adjacent analyzed timestamps.
 * Avoid showing a stale box where no fresh detection exists. */
export function tracksAt(frames: LocalFrame[], time: number): LocalTrack[] {
  if (!frames.length || time < frames[0].time - STEP / 2) return [];
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].time <= time) lo = mid + 1;
    else hi = mid;
  }
  const previous = frames[Math.max(0, lo - 1)];
  const next = frames[lo];
  if (!previous) return [];
  const nearestDistance = Math.abs(time - previous.time);
  if (nearestDistance > STEP * 1.1) return [];
  if (!next || next.time - previous.time > STEP * 1.6) {
    return nearestDistance <= STEP * .55 ? previous.tracks : [];
  }
  const fraction = Math.max(0, Math.min(1, (time - previous.time) / (next.time - previous.time)));
  const byId = new Map(next.tracks.map(t => [t.id, t]));
  return previous.tracks.flatMap(track => {
    const match = byId.get(track.id);
    return match && match.className === track.className ? [interpolate(track, match, fraction)] : [];
  });
}

async function seek(video: HTMLVideoElement, time: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('Analysis cancelled');
  if (Math.abs(video.currentTime - time) <= 0.004 && video.readyState >= 2 && !video.seeking) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('Video decoder seek timed out')), 12000);
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onSeeked = () => finish();
    const onError = () => finish(new Error('Could not decode the selected video'));
    const onAbort = () => finish(new Error('Analysis cancelled'));
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    video.currentTime = time;
  });
}

export default function LocalAnalyze({ active = true }: { active?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const workerInitializationRef = useRef<Promise<void> | null>(null);
  const workerReadyRef = useRef(false);
  const loadTimeoutRef = useRef<number | null>(null);
  const selectedFileVersionRef = useRef(0);
  const storageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const replyRef = useRef<((reply: WorkerReply) => void) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const analysisRef = useRef<LocalAnalysis | null>(null);
  const loadedPositionRef = useRef(0);
  const requestIdRef = useRef(0);
  const progressRef = useRef(0);
  const playbackRef = useRef(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [name, setName] = useState('');
  const [status, setStatus] = useState<Status>('empty');
  const [modelStatus, setModelStatus] = useState('YOLO11s · loads when analysis starts');
  const [videoLoadStatus, setVideoLoadStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [storageStatus, setStorageStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [provider, setProvider] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [analysis, setAnalysis] = useState<LocalAnalysis | null>(null);

  const beginVideoLoad = useCallback(() => {
    if (loadTimeoutRef.current !== null) window.clearTimeout(loadTimeoutRef.current);
    setVideoLoadStatus('loading');
    loadTimeoutRef.current = window.setTimeout(() => {
      setVideoLoadStatus(current => current === 'loading' ? 'error' : current);
      setError(current => current || 'Video could not become ready within 10 seconds. Try an H.264 MP4 file or a smaller clip.');
      loadTimeoutRef.current = null;
    }, VIDEO_LOAD_TIMEOUT_MS);
  }, []);

  const attachVideo = useCallback((blob: Blob, label: string) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setVideoUrl(url);
    setName(label);
    setDuration(0);
    beginVideoLoad();
  }, [beginVideoLoad]);

  // The owner of this component is AppLayout, which remains mounted across dashboard navigation.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const generation = selectedFileVersionRef.current;
        const [saved, savedPosition] = await Promise.all([
          localAnalysisStorage.loadVideo(),
          localAnalysisStorage.loadPosition()
        ]);
        if (!alive || generation !== selectedFileVersionRef.current || !saved) return;
        loadedPositionRef.current = savedPosition;
        attachVideo(saved.file, saved.name);
        setStorageStatus('saved');
        setStatus('ready');
        // Restoring large inference results must never delay the first video frame.
        const result = await localAnalysisStorage.loadAnalysis();
        if (!alive || generation !== selectedFileVersionRef.current) return;
        if (result && result.name === saved.name) {
          setAnalysis(result);
          analysisRef.current = result;
          setStatus('completed');
        }
      } catch (e) {
        if (alive) setError('Local video restore failed: ' + String(e));
      }
    })();
    return () => {
      alive = false;
      abortRef.current?.abort();
      workerRef.current?.terminate();
      workerRef.current = null;
      workerReadyRef.current = false;
      if (loadTimeoutRef.current !== null) window.clearTimeout(loadTimeoutRef.current);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [attachVideo]);

  useEffect(() => {
    if (active || status === 'processing') return;
    const video = videoRef.current;
    if (video && !video.paused) video.pause();
    if (video && Number.isFinite(video.currentTime)) {
      void localAnalysisStorage.savePosition(video.currentTime).catch(() => {});
    }
  }, [active, status]);

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (!document.hidden) return;
      const video = videoRef.current;
      if (video && !video.paused) video.pause();
      if (video && Number.isFinite(video.currentTime)) {
        void localAnalysisStorage.savePosition(video.currentTime).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);

  const ensureWorkerReady = (): Promise<void> => {
    if (workerReadyRef.current) return Promise.resolve();
    if (workerInitializationRef.current) return workerInitializationRef.current;
    setModelStatus('Loading YOLO11s model...');
    const promise = new Promise<void>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('../workers/localTrafficWorker.ts', import.meta.url), { type: 'module' });
      } catch (error) {
        reject(error);
        return;
      }
      workerRef.current = worker;
      let settled = false;
      const timeout = window.setTimeout(() => {
        fail(new Error('YOLO11s initialization timed out. Check the model file and browser acceleration.'));
      }, 60_000);
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        workerReadyRef.current = false;
        setModelStatus('Model unavailable');
        reject(error);
      };
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data;
        if (reply.type === 'ready') {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          workerReadyRef.current = true;
          setModelStatus('YOLO11s ready');
          setProvider(reply.provider);
          resolve();
        } else if (reply.type === 'error' && reply.requestId === -1) {
          fail(new Error(reply.message));
        } else {
          replyRef.current?.(reply);
        }
      };
      worker.onerror = event => fail(new Error(event.message || 'YOLO11s worker failed'));
      worker.postMessage({ type: 'init', modelPath: MODEL });
    });
    workerInitializationRef.current = promise.finally(() => {
      workerInitializationRef.current = null;
    });
    return workerInitializationRef.current;
  };

  const onUpload = async (file?: File) => {
    if (!file || status === 'processing') return;
    if (!VIDEO_TYPES.includes(file.type) && !/\.(mp4|webm|mov|mkv)$/i.test(file.name)) {
      setError('Choose an MP4, WebM, MOV, or MKV video supported by your browser.');
      return;
    }
    selectedFileVersionRef.current += 1;
    setError('');
    setPlaying(false);
    videoRef.current?.pause();
    setAnalysis(null);
    analysisRef.current = null;
    setProgress(0);
    setPosition(0);
    loadedPositionRef.current = 0;
    attachVideo(file, file.name);
    setStatus('ready');
    setStorageStatus('saving');
    const generation = selectedFileVersionRef.current;
    // Give the video element a head start decoding its first frame before the
    // potentially large IndexedDB blob-copy starts. Never await this to open.
    storageQueueRef.current = storageQueueRef.current.catch(() => {}).then(async () => {
      await new Promise<void>(resolve => window.setTimeout(resolve, 750));
      if (generation !== selectedFileVersionRef.current) return;
      await localAnalysisStorage.saveVideo(file, file.name);
      if (generation !== selectedFileVersionRef.current) return;
      await localAnalysisStorage.clearAnalysis();
      await localAnalysisStorage.savePosition(0);
      if (generation === selectedFileVersionRef.current) setStorageStatus('saved');
    });
    void storageQueueRef.current.catch(e => {
      if (generation !== selectedFileVersionRef.current) return;
      setStorageStatus('error');
      setError('Local storage failed (possibly insufficient disk quota): ' + String(e));
    });
  };

  const infer = (bitmap: ImageBitmap, time: number): Promise<LocalTrack[]> => {
    const worker = workerRef.current;
    if (!worker) { bitmap.close(); return Promise.reject(new Error('Detector not available')); }
    const id = ++requestIdRef.current;
    return new Promise<LocalTrack[]>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        replyRef.current = null;
        reject(new Error('YOLO11s did not respond to the frame'));
      }, 30000);
      replyRef.current = reply => {
        if (!('requestId' in reply) || reply.requestId !== id) return;
        clearTimeout(timeout);
        replyRef.current = null;
        if (reply.type === 'result') resolve(reply.tracks);
        else reject(new Error(reply.type === 'error' ? reply.message : 'Unexpected worker reply'));
      };
      worker.postMessage({ type: 'frame', bitmap, time, width: bitmap.width, height: bitmap.height, requestId: id }, [bitmap]);
    });
  };

  const startAnalysis = async () => {
    const video = videoRef.current;
    if (!video || videoLoadStatus !== 'ready' || !videoUrl || status === 'processing') return;
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      setError('Video metadata is not ready or duration is invalid.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    video.pause();
    setPlaying(false);
    setError('');
    setProgress(0);
    setStatus('processing');
    analysisRef.current = null;
    setAnalysis(null);
    const frames: LocalFrame[] = [];
    const end = video.duration;
    const count = Math.ceil(end / STEP);
    try {
      await ensureWorkerReady();
      if (controller.signal.aborted) throw new Error('Analysis cancelled');
      workerRef.current?.postMessage({ type: 'reset' });
      for (let i = 0; i < count; i++) {
        if (controller.signal.aborted) throw new Error('Analysis cancelled');
        const time = Math.min(end - 0.001, i * STEP);
        await seek(video, time, controller.signal);
        if (controller.signal.aborted) throw new Error('Analysis cancelled');
        const bitmap = await createImageBitmap(video);
        const tracks = await infer(bitmap, time);
        frames.push({ time, tracks });
        progressRef.current = (i + 1) / count;
        if (i % 5 === 0 || i === count - 1) setProgress(Math.round(progressRef.current * 100));
      }
      const result: LocalAnalysis = {
        name, width: video.videoWidth, height: video.videoHeight, duration: end,
        model: 'YOLO11s', frames, completedAt: Date.now()
      };
      await localAnalysisStorage.saveAnalysis(result);
      analysisRef.current = result;
      setAnalysis(result);
      setStatus('completed');
      video.currentTime = 0;
      setPosition(0);
      await localAnalysisStorage.savePosition(0);
    } catch (e) {
      setStatus(controller.signal.aborted ? 'ready' : 'error');
      if (!controller.signal.aborted) setError('Analysis failed: ' + String(e));
    } finally {
      abortRef.current = null;
    }
  };

  // Paint matching tracked IDs over the actual video time, independent of native playback FPS.
  useEffect(() => {
    let animation = 0;
    let lastSaved = 0;
    let lastUpdated = 0;
    const paint = (stamp: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const result = analysisRef.current;
      if (video && canvas) {
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const pixelW = Math.round(width * dpr);
        const pixelH = Math.round(height * dpr);
        if (pixelW && pixelH && (canvas.width !== pixelW || canvas.height !== pixelH)) {
          canvas.width = pixelW;
          canvas.height = pixelH;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (result && !video.seeking && video.videoWidth > 0 && video.videoHeight > 0) {
            const fit = Math.min(width / video.videoWidth, height / video.videoHeight);
            const dx = (width - video.videoWidth * fit) / 2;
            const dy = (height - video.videoHeight * fit) / 2;
            ctx.save();
            ctx.scale(dpr, dpr);
            for (const track of tracksAt(result.frames, video.currentTime)) {
              if (track.confidence < .42) continue;
              const x = dx + (track.x - track.w / 2) * fit;
              const y = dy + (track.y - track.h / 2) * fit;
              const w = track.w * fit;
              const h = track.h * fit;
              if (w < 5 || h < 5) continue;
              ctx.strokeStyle = '#4ef2af';
              ctx.lineWidth = 2;
              ctx.strokeRect(x, y, w, h);
              const label = '#' + track.id + '  ' + track.className.toUpperCase();
              ctx.font = '600 12px system-ui, sans-serif';
              const lw = ctx.measureText(label).width + 14;
              const ly = Math.max(0, y - 23);
              ctx.fillStyle = '#0f172a';
              ctx.fillRect(Math.max(0, x), ly, lw, 20);
              ctx.fillStyle = '#d1fae5';
              ctx.fillText(label, Math.max(0, x) + 7, ly + 14);
            }
            ctx.restore();
          }
        }
        if (result && stamp - lastUpdated > 250) {
          lastUpdated = stamp;
          setPosition(video.currentTime);
        }
        if (result && stamp - lastSaved > 1500 && Number.isFinite(video.currentTime)) {
          lastSaved = stamp;
          void localAnalysisStorage.savePosition(video.currentTime).catch(() => {});
        }
      }
      animation = requestAnimationFrame(paint);
    };
    animation = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(animation);
  }, []);

  const removeVideo = async () => {
    if (status === 'processing') return;
    videoRef.current?.pause();
    setPlaying(false);
    selectedFileVersionRef.current += 1;
    setStatus('empty');
    setVideoLoadStatus('idle');
    setStorageStatus('idle');
    if (loadTimeoutRef.current !== null) window.clearTimeout(loadTimeoutRef.current);
    setAnalysis(null);
    analysisRef.current = null;
    setVideoUrl('');
    setName('');
    setPosition(0);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    try {
      await Promise.all([localAnalysisStorage.clearVideo(), localAnalysisStorage.clearAnalysis(), localAnalysisStorage.clearPosition()]);
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="min-h-full bg-[#f7f9fc] px-2 py-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Video analysis</h1>
            <p className="mt-1 text-sm text-slate-500">One local detector. Process footage first, then review at normal playback speed.</p>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="video/*,.mkv" className="hidden" onChange={e => {
              void onUpload(e.target.files?.[0]); e.target.value = '';
            }} />
            <button type="button" disabled={status === 'processing'} onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40">
              <Upload size={16} /> Upload video
            </button>
            {videoUrl && <button type="button" disabled={status === 'processing'} onClick={() => void removeVideo()}
              title="Remove saved local video" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600 disabled:opacity-40"><X size={17} /></button>}
          </div>
        </header>
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-600">
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">{modelStatus}</span>
          {provider && <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">Accelerator: {provider.toUpperCase()}</span>}
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5">{storageStatus === 'saving' ? 'Saving locally...' : storageStatus === 'saved' ? 'Saved on this device' : storageStatus === 'error' ? 'Local save failed' : 'Local-only · no upload'}</span>
        </div>
        {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error}</div>}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="relative aspect-video w-full overflow-hidden bg-[#080e20]">
            {videoUrl ? (
              <>
                <video ref={videoRef} src={videoUrl} preload="auto" playsInline
                  style={{ visibility: status === 'processing' ? 'hidden' : 'visible' }}
                  className="h-full w-full object-contain"
                  onLoadedMetadata={event => {
                    setDuration(event.currentTarget.duration);
                  }}
                  onLoadedData={event => {
                    if (loadTimeoutRef.current !== null) {
                      window.clearTimeout(loadTimeoutRef.current);
                      loadTimeoutRef.current = null;
                    }
                    setVideoLoadStatus('ready');
                    setError(current => current.startsWith('Video could not become ready within 10 seconds.') ? '' : current);
                    // Restore position after the first frame is available; early seeking
                    // forces decoding from a distant keyframe and delays initial load.
                    const savedPosition = loadedPositionRef.current;
                    loadedPositionRef.current = 0;
                    const video = event.currentTarget;
                    if (savedPosition > 0 && Number.isFinite(video.duration)) {
                      video.currentTime = Math.min(savedPosition, Math.max(0, video.duration - .05));
                      setPosition(video.currentTime);
                    }
                  }}
                  onPlay={() => { setPlaying(true); playbackRef.current = true; }}
                  onPause={() => { setPlaying(false); playbackRef.current = false; }}
                  onEnded={() => setPlaying(false)}
                  onError={() => {
                    if (loadTimeoutRef.current !== null) window.clearTimeout(loadTimeoutRef.current);
                    setVideoLoadStatus('error');
                    setError('Video could not be decoded by the browser. Try an H.264 MP4.');
                  }}
                />
                <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                {videoLoadStatus === 'loading' && status !== 'processing' && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b1225] text-white">
                    <Loader2 className="animate-spin text-indigo-300" size={28} />
                    <span className="text-sm">Opening video locally...</span>
                  </div>
                )}
                {videoLoadStatus === 'error' && status !== 'processing' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b1225] px-5 text-center text-white">
                    <p className="text-sm">This video did not open within 10 seconds.</p>
                    <button type="button" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900" onClick={() => {
                      setError('');
                      beginVideoLoad();
                      videoRef.current?.load();
                    }}>Retry opening video</button>
                  </div>
                )}
                {status === 'processing' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0b1225] px-6 text-center text-white">
                    <Loader2 className="animate-spin text-indigo-300" size={36} />
                    <div className="text-lg font-semibold">{workerReadyRef.current ? 'Analyzing vehicle movements' : 'Preparing YOLO11s detector'}</div>
                    <div className="max-w-sm text-sm text-slate-300">{modelStatus === 'YOLO11s ready' ? 'Processing original frames. Playback starts only after full analysis.' : 'First-time model initialization is separate from the video loading time.'}</div>
                    <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/20">
                      <div className="h-full rounded-full bg-indigo-400 transition-[width]" style={{ width: progress + '%' }} />
                    </div>
                    <strong>{progress}%</strong>
                    <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-lg border border-white/30 px-4 py-2 text-sm">Cancel analysis</button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-slate-300">
                <Film size={44} className="text-indigo-300" />
                <strong className="text-lg text-white">Your footage stays on this device</strong>
                <p className="max-w-md text-sm">Upload a traffic video to analyze it locally. The original and completed results are saved in this browser.</p>
                <button type="button" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900" onClick={() => fileRef.current?.click()}>Choose video</button>
              </div>
            )}
          </div>
          {videoUrl && (
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {status === 'completed' ? 'Analyzed · ' + (analysis?.frames.length || 0) + ' timestamps' :
                      status === 'processing' ? 'Analysis in progress' : 'Ready to analyze'}
                  </div>
                </div>
                {status === 'completed' ? <CheckCircle2 className="text-emerald-600" size={20} /> : null}
              </div>
              {status !== 'processing' && (
                <div className="flex flex-wrap items-center gap-3">
                  {status === 'completed' ? (
                    <button type="button" onClick={() => {
                      const video = videoRef.current; if (!video) return;
                      if (video.paused) void video.play().catch(e => setError(String(e)));
                      else video.pause();
                    }} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
                      {playing ? <Pause size={16} /> : <Play size={16} />} {playing ? 'Pause' : 'Play results'}
                    </button>
                  ) : (
                    <button type="button" disabled={videoLoadStatus !== 'ready' || !duration}
                      onClick={() => void startAnalysis()}
                      className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                      <Play size={16} /> Analyze video
                    </button>
                  )}
                  {status === 'completed' && <button type="button" onClick={() => void startAnalysis()}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700">
                    <RotateCcw size={15} /> Reanalyze
                  </button>}
                  <div className="ml-auto font-mono text-xs text-slate-500">{readableTime(position)} / {readableTime(duration)}</div>
                </div>
              )}
              {status === 'completed' && (
                <input type="range" aria-label="Video playback position" min={0} max={duration || 1} step=".01"
                  value={Math.min(position, duration || 1)} className="w-full accent-indigo-600"
                  onChange={e => {
                    const at = Number(e.target.value);
                    const video = videoRef.current; if (video) video.currentTime = at;
                    setPosition(at);
                    void localAnalysisStorage.savePosition(at).catch(() => {});
                  }} />
              )}
            </div>
          )}
        </section>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Playback and tracking</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Full analysis finishes before playback. The reviewed video runs at its original rate. Bounding boxes interpolate between consecutive detections sharing a tracked vehicle ID.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Vehicle speed</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">Accurate km/h cannot be recovered automatically from an arbitrary uncalibrated camera video. No fabricated speed labels are shown. Ground-plane scale or a verified sensor is required for physical speed.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
