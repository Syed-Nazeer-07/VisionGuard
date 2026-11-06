import { env, InferenceSession, Tensor } from 'onnxruntime-web';
import { decodeTrafficVehicles } from '../pipeline/detector/liveVehicles';
import { ByteTracker } from '../pipeline/tracker/bytetrack';
import { calculateMotion, type LiveTrack } from '../pipeline/tracker/liveProjection';

if (import.meta.env.DEV) env.wasm.wasmPaths = '/';

type Incoming =
  | { type: 'init'; modelPath: string }
  | { type: 'reset' }
  | {
      type: 'frame'; bitmap: ImageBitmap; mediaTime: number; generation: number;
      sourceWidth: number; sourceHeight: number; requestId: number
    };

let session: InferenceSession | null = null;
let executionProvider = '';
let working = false;
let epoch = 0;
const tracker = new ByteTracker();
tracker.trackThreshold = 0.45;
tracker.maxTimeLost = 3;
const observations = new Map<number, {
  x: number; y: number; h: number; time: number; vx: number; vy: number
}>();

const SIZE = 640;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let floatBuffer: Float32Array | null = null;

function errorText(e: unknown) { return e instanceof Error ? e.message : String(e); }

async function initialize(path: string) {
  if (session) {
    self.postMessage({ type: 'ready', provider: executionProvider });
    return;
  }
  let gpuError = '';
  if ('gpu' in navigator) {
    try {
      session = await InferenceSession.create(path, { executionProviders: ['webgpu'] });
      executionProvider = 'webgpu';
    } catch (e) { gpuError = errorText(e); }
  }
  if (!session) {
    session = await InferenceSession.create(path, { executionProviders: ['wasm'] });
    executionProvider = 'wasm';
  }
  self.postMessage({ type: 'ready', provider: executionProvider, fallbackReason: gpuError });
}

function preprocess(bitmap: ImageBitmap, sourceWidth: number, sourceHeight: number) {
  if (!canvas) {
    canvas = new OffscreenCanvas(SIZE, SIZE);
    context = canvas.getContext('2d', { willReadFrequently: true });
    floatBuffer = new Float32Array(3 * SIZE * SIZE);
  }
  if (!context || !floatBuffer) throw new Error('Unable to initialize inference canvas');
  const scale = Math.min(SIZE / sourceWidth, SIZE / sourceHeight);
  const sw = Math.max(1, Math.round(sourceWidth * scale));
  const sh = Math.max(1, Math.round(sourceHeight * scale));
  const left = Math.floor((SIZE - sw) / 2);
  const top = Math.floor((SIZE - sh) / 2);
  context.fillStyle = 'rgb(114,114,114)';
  context.fillRect(0, 0, SIZE, SIZE);
  context.drawImage(bitmap, left, top, sw, sh);
  const rgba = context.getImageData(0, 0, SIZE, SIZE).data;
  const area = SIZE * SIZE;
  const dest = floatBuffer;
  for (let i = 0; i < area; i++) {
    const px = 4 * i;
    dest[i] = rgba[px] / 255;
    dest[area + i] = rgba[px + 1] / 255;
    dest[2 * area + i] = rgba[px + 2] / 255;
  }
  // Derived from actual rounded letterbox dimensions, not the ImageBitmap
  // dimensions (which may have been scaled down for transfer efficiency).
  return {
    tensor: new Tensor('float32', dest, [1, 3, SIZE, SIZE]),
    ratio: sw / sourceWidth, padW: left, padH: top
  };
}

async function handleFrame(message: Extract<Incoming, { type: 'frame' }>) {
  if (working || !session) {
    message.bitmap.close();
    self.postMessage({ type: 'error', requestId: message.requestId, generation: message.generation, message: 'Detector is busy or uninitialized' });
    return;
  }
  working = true;
  const thisEpoch = epoch;
  const start = performance.now();
  try {
    const processed = preprocess(message.bitmap, message.sourceWidth, message.sourceHeight);
    const feeds = { [session.inputNames[0]]: processed.tensor };
    const output = await session.run(feeds);
    if (thisEpoch !== epoch) {
      self.postMessage({
        type: 'skipped', requestId: message.requestId, generation: message.generation
      });
      return;
    }
    const boxes = decodeTrafficVehicles(
      output[session.outputNames[0]].data as Float32Array,
      message.sourceWidth, message.sourceHeight,
      processed.ratio, processed.padW, processed.padH
    );
    // With slow WASM inference vehicles often move too far between detections
    // for 2-hit confirmation. Display high-confidence NEW detections directly;
    // continue assigning stable IDs once matching succeeds.
    const observedTracks = tracker.update(boxes)
      .filter(track => track.timeSinceUpdate === 0 &&
        (track.state === 'Confirmed' || track.hitCount >= 2 || track.prob >= 0.58));
    const tracks: LiveTrack[] = observedTracks.map(track => {
      const previous = observations.get(track.trackId);
      const velocity = calculateMotion(previous, track, message.mediaTime);
      observations.set(track.trackId, {
        x: track.x, y: track.y, h: track.h, time: message.mediaTime,
        vx: velocity.vx, vy: velocity.vy
      });
      return {
        id: track.trackId, className: track.className,
        confidence: track.prob,
        x: track.x, y: track.y, w: track.w, h: track.h,
        vx: velocity.vx, vy: velocity.vy,
        motionPxPerSec: velocity.motionPxPerSec
      };
    });
    for (const [id, o] of observations) {
      if (message.mediaTime - o.time > 2) observations.delete(id);
    }
    self.postMessage({
      type: 'result', requestId: message.requestId, generation: message.generation,
      mediaTime: message.mediaTime, tracks, detectionCount: boxes.length,
      provider: executionProvider,
      inferenceMs: performance.now() - start
    });
  } catch (e) {
    self.postMessage({
      type: 'error', requestId: message.requestId, generation: message.generation,
      message: errorText(e)
    });
  } finally {
    message.bitmap.close();
    working = false;
  }
}

self.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'reset') {
    epoch += 1;
    tracker.reset();
    observations.clear();
  } else if (message.type === 'init') {
    void initialize(message.modelPath).catch(error =>
      self.postMessage({ type: 'error', requestId: -1, generation: -1, message: errorText(error) })
    );
  } else {
    void handleFrame(message);
  }
};
