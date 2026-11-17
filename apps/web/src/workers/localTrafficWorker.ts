import { env, InferenceSession, Tensor } from 'onnxruntime-web/webgpu';
import {
  decodeTrafficVehicles, matchesYoloTensor, trafficLetterbox,
  YOLO_INPUT_SHAPE, YOLO_INPUT_SIZE, YOLO_OUTPUT_SHAPE
} from '../pipeline/detector/liveVehicles';
import { ByteTracker } from '../pipeline/tracker/bytetrack';
import { calculateMotion, type LiveTrack } from '../pipeline/tracker/liveProjection';
import { TwoWheelerAssociator } from '../pipeline/tracker/twoWheelerAssociator';
import { ortWasmAssetsPath } from '../services/ortWasmPaths';
import { disposeInferenceResources } from '../services/inferenceResources';
import { verifyOnnxModelUrl } from '../services/modelProbe';

env.wasm.wasmPaths = ortWasmAssetsPath(import.meta.env.DEV);

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
const twoWheelers = new TwoWheelerAssociator();
tracker.trackThreshold = 0.45;
tracker.maxTimeLost = 3;
const observations = new Map<number, {
  x: number; y: number; h: number; time: number; vx: number; vy: number
}>();

const SIZE = YOLO_INPUT_SIZE;
let canvas: OffscreenCanvas | null = null;
let context: OffscreenCanvasRenderingContext2D | null = null;
let floatBuffer: Float32Array | null = null;

function errorText(e: unknown) { return e instanceof Error ? e.message : String(e); }

async function initialize(path: string) {
  if (session) {
    self.postMessage({ type: 'ready', provider: executionProvider });
    return;
  }
  await verifyOnnxModelUrl(path);
  let gpuError = '';
  type Adapter = typeof env.webgpu.adapter & { info?: { isFallbackAdapter?: boolean } };
  const gpu = (navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<Adapter | null> }
  }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter || adapter.info?.isFallbackAdapter) {
        gpuError = adapter ? 'The browser reported a software adapter.' : 'No hardware adapter was available.';
      } else {
        env.webgpu.adapter = adapter;
        session = await InferenceSession.create(path, { executionProviders: ['webgpu'] });
        executionProvider = 'webgpu';
      }
    } catch (error) { gpuError = errorText(error); }
  }
  if (!session) {
    session = await InferenceSession.create(path, { executionProviders: ['wasm'] });
    executionProvider = 'wasm';
  }
  const [input] = session.inputMetadata;
  const [output] = session.outputMetadata;
  if (session.inputMetadata.length !== 1 || session.outputMetadata.length !== 1 ||
      !matchesYoloTensor(input, YOLO_INPUT_SHAPE) || !matchesYoloTensor(output, YOLO_OUTPUT_SHAPE)) {
    const incompatible = session;
    session = null;
    await incompatible.release();
    throw new Error('Incompatible model. Supply a float32 YOLO11 COCO ONNX export with input [1,3,640,640] and output [1,84,8400].');
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
  const transform = trafficLetterbox(sourceWidth, sourceHeight);
  const { left, top, width, height } = transform;
  context.fillStyle = 'rgb(114,114,114)';
  context.fillRect(0, 0, SIZE, SIZE);
  context.drawImage(bitmap, left, top, width, height);
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
    tensor: new Tensor('float32', dest, YOLO_INPUT_SHAPE), transform
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
  let inputTensor: Tensor | null = null;
  let outputTensors: Awaited<ReturnType<InferenceSession['run']>> | null = null;
  try {
    const processed = preprocess(message.bitmap, message.sourceWidth, message.sourceHeight);
    inputTensor = processed.tensor;
    const feeds = { [session.inputNames[0]]: processed.tensor };
    outputTensors = await session.run(feeds);
    const output = outputTensors;
    if (thisEpoch !== epoch) {
      self.postMessage({
        type: 'skipped', requestId: message.requestId, generation: message.generation
      });
      return;
    }
    const result = output[session.outputNames[0]];
    if (!matchesYoloTensor({ isTensor: true, type: result.type, shape: result.dims }, YOLO_OUTPUT_SHAPE) ||
        !(result.data instanceof Float32Array)) {
      throw new Error('The detector returned an incompatible output tensor.');
    }
    const boxes = decodeTrafficVehicles(result.data, processed.transform);
    // Let motorcycle/bicycle detections bypass the car tracker's .45/.60
    // confidence gates. A separate, conservative two-wheeler tracker runs
    // only on class 1 and class 3, leaving all other vehicle paths unchanged.
    const motorTracks = twoWheelers.update(boxes, message.mediaTime);
    const fourWheelBoxes = boxes.filter(box => box.classId !== 1 && box.classId !== 3);
    // With slow WASM inference vehicles often move too far between detections
    // for 2-hit confirmation. Display high-confidence NEW detections directly;
    // continue assigning stable IDs once matching succeeds.
    const observedTracks = tracker.update(fourWheelBoxes)
      .filter(track => track.observationType === 'detection');
    const tracks: LiveTrack[] = observedTracks.map(track => {
      const previous = observations.get(track.trackId);
      const velocity = calculateMotion(previous, track, message.mediaTime);
      observations.set(track.trackId, {
        x: track.x, y: track.y, h: track.h, time: message.mediaTime,
        vx: velocity.vx, vy: velocity.vy
      });
      return {
        id: track.trackId,
        className: track.className,
        classScores: track.classScores,
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
      mediaTime: message.mediaTime, tracks: [...tracks, ...motorTracks],
      detectionCount: boxes.length,
      provider: executionProvider,
      inferenceMs: performance.now() - start
    });
  } catch (e) {
    self.postMessage({
      type: 'error', requestId: message.requestId, generation: message.generation,
      message: errorText(e)
    });
  } finally {
    // ONNX Runtime may own GPU buffers for each output tensor. Release the
    // output only AFTER decoding it; otherwise long video sessions can retain
    // GPU memory until GC (or beyond). Also release the CPU input tensor.
    disposeInferenceResources(inputTensor, outputTensors, error => {
      console.warn('[YOLO11s] Failed to release inference tensor:', error);
    });
    message.bitmap.close();
    working = false;
  }
}

self.onmessage = (event: MessageEvent<Incoming>) => {
  const message = event.data;
  if (message.type === 'reset') {
    epoch += 1;
    tracker.reset();
    twoWheelers.reset();
    observations.clear();
  } else if (message.type === 'init') {
    void initialize(message.modelPath).catch(error =>
      self.postMessage({ type: 'error', requestId: -1, generation: -1, message: errorText(error) })
    );
  } else {
    void handleFrame(message);
  }
};
