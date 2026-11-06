import { env, InferenceSession, Tensor } from 'onnxruntime-web';
import { processOutput } from '../pipeline/detector/postprocess';
import { ByteTracker } from '../pipeline/tracker/bytetrack';
import type { LocalTrack } from '../services/localAnalysisStorage';

if (import.meta.env.DEV) env.wasm.wasmPaths = '/';

type InMessage =
  | { type: 'init'; modelPath: string }
  | { type: 'frame'; bitmap: ImageBitmap; time: number; width: number; height: number; requestId: number }
  | { type: 'reset' };

let session: InferenceSession | null = null;
let executionProvider = 'unknown';
const tracker = new ByteTracker();
tracker.trackThreshold = 0.45;
tracker.maxTimeLost = 8;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function initialize(path: string) {
  let gpuError = '';
  if ('gpu' in self.navigator) {
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

function preprocess(bitmap: ImageBitmap) {
  const size = 640;
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const sw = Math.max(1, Math.round(bitmap.width * scale));
  const sh = Math.max(1, Math.round(bitmap.height * scale));
  const left = Math.floor((size - sw) / 2);
  const top = Math.floor((size - sh) / 2);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No canvas context available for inference.');
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, left, top, sw, sh);
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const area = size * size;
  const data = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    const j = i * 4;
    data[i] = pixels[j] / 255;
    data[area + i] = pixels[j + 1] / 255;
    data[2 * area + i] = pixels[j + 2] / 255;
  }
  return {
    tensor: new Tensor('float32', data, [1, 3, size, size]),
    ratio: sw / bitmap.width,
    padW: left,
    padH: top
  };
}

async function processFrame(msg: Extract<InMessage, { type: 'frame' }>) {
  if (!session) throw new Error('YOLO11s model has not loaded.');
  const t0 = performance.now();
  const { tensor, ratio, padW, padH } = preprocess(msg.bitmap);
  const result = await session.run({ [session.inputNames[0]]: tensor });
  const output = result[session.outputNames[0]];
  const boxes = processOutput(output.data as Float32Array, 0.42, 0.45, ratio, padW, padH, msg.width, msg.height)
    .filter(box => [1, 2, 3, 5, 7].includes(box.classId));
  // Association is computed in original video coordinates, never display coordinates.
  const tracks = tracker.update(boxes)
    .filter(t => t.state === 'Confirmed' && t.observationType === 'detection' && t.prob >= 0.42)
    .map((t): LocalTrack => ({
      id: t.trackId, className: t.className, confidence: t.prob,
      x: t.x, y: t.y, w: t.w, h: t.h
    }));
  self.postMessage({
    type: 'result', requestId: msg.requestId, time: msg.time,
    tracks, detections: boxes.length, elapsed: performance.now() - t0
  });
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  if (msg.type === 'reset') { tracker.reset(); return; }
  if (msg.type === 'init') {
    try { await initialize(msg.modelPath); }
    catch (e) { self.postMessage({ type: 'error', requestId: -1, message: errorText(e) }); }
    return;
  }
  try { await processFrame(msg); }
  catch (e) { self.postMessage({ type: 'error', requestId: msg.requestId, message: errorText(e) }); }
  finally { msg.bitmap.close(); }
};
