import type { InferenceSession, Tensor } from 'onnxruntime-web';
import {
  decodeTrafficVehicles, matchesYoloTensor, trafficLetterbox,
  YOLO_INPUT_SHAPE, YOLO_INPUT_SIZE, YOLO_OUTPUT_SHAPE
} from '../pipeline/detector/liveVehicles';
import { ByteTracker } from '../pipeline/tracker/bytetrack';
import { calculateMotion, type LiveTrack } from '../pipeline/tracker/liveProjection';
import { TwoWheelerAssociator } from '../pipeline/tracker/twoWheelerAssociator';
import { disposeInferenceResources } from '../services/inferenceResources';
import type { DetectorEvent, DetectorFrame, DetectorRequest } from '../pipeline/worker/detectorProtocol';
import { openTrafficSession } from './trafficInferenceSession';

let runtime: Awaited<ReturnType<typeof openTrafficSession>> | null = null;
let initializing = false;
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

let reusableInput: Tensor | null = null;
let previousContentSize = '';

function send(event: DetectorEvent) { self.postMessage(event); }
function errorText(e: unknown) { return e instanceof Error ? e.message : String(e); }

async function initialize(message: Extract<DetectorRequest, { type: 'init' }>) {
  if (runtime || initializing) return;
  initializing = true;
  try {
    let lastNotified = 0;
    runtime = await openTrafficSession(message.modelPath, message.provider ?? 'auto',
      stage => send({ type: 'loading', stage }),
      (receivedBytes, totalBytes) => {
        // 1 MiB increments keep cross-thread telemetry light while exposing
        // genuine download activity instead of an endless spinner.
        if (receivedBytes - lastNotified >= 1024 * 1024 ||
            (totalBytes !== null && receivedBytes >= totalBytes)) {
          lastNotified = receivedBytes;
          send({ type: 'progress', receivedBytes, totalBytes });
        }
      });
    const { provider, startup, fallbackReason } = runtime;
    send({ type: 'ready', provider, startup, fallbackReason });
  } catch (error) {
    send({ type: 'error', requestId: -1, generation: -1, message: errorText(error) });
  } finally {
    initializing = false;
  }
}

function preprocess(bitmap: ImageBitmap, sourceWidth: number, sourceHeight: number) {
  if (!canvas) {
    canvas = new OffscreenCanvas(SIZE, SIZE);
    context = canvas.getContext('2d', { willReadFrequently: true });
    floatBuffer = new Float32Array(3 * SIZE * SIZE);
  }
  if (!context || !floatBuffer || !runtime) throw new Error('Unable to initialize inference canvas');
  const transform = trafficLetterbox(sourceWidth, sourceHeight);
  const { left, top, width, height } = transform;
  // Only copy actual video pixels back to the CPU. Padding is constant.
  context.drawImage(bitmap, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const area = SIZE * SIZE;
  const dest = floatBuffer;
  const contentSize = width + 'x' + height;
  if (contentSize !== previousContentSize) {
    dest.fill(114 / 255);
    previousContentSize = contentSize;
  }
  let src = 0;
  for (let row = 0; row < height; row++) {
    const rowStart = (top + row) * SIZE + left;
    for (let col = 0; col < width; col++, src += 4) {
      const pixel = rowStart + col;
      dest[pixel] = rgba[src] / 255;
      dest[area + pixel] = rgba[src + 1] / 255;
      dest[2 * area + pixel] = rgba[src + 2] / 255;
    }
  }
  reusableInput ??= new runtime.Tensor('float32', dest, YOLO_INPUT_SHAPE);
  return { tensor: reusableInput, transform };
}

async function handleFrame(message: DetectorFrame) {
  if (working || !runtime) {
    message.bitmap.close();
    send({ type: 'error', requestId: message.requestId, generation: message.generation, message: 'Detector is busy or uninitialized' });
    return;
  }
  working = true;
  const thisEpoch = epoch;
  const { session, provider } = runtime;
  const start = performance.now();
  let outputTensors: Awaited<ReturnType<InferenceSession['run']>> | null = null;
  try {
    const processed = preprocess(message.bitmap, message.sourceWidth, message.sourceHeight);
    const preprocessMs = performance.now() - start;
    const feeds = { [session.inputNames[0]]: processed.tensor };
    const modelStarted = performance.now();
    outputTensors = await session.run(feeds);
    const modelRunMs = performance.now() - modelStarted;
    const postprocessStarted = performance.now();
    const output = outputTensors;
    if (thisEpoch !== epoch) {
      send({
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
    if (message.preview) {
      send({
        type: 'result', requestId: message.requestId, generation: message.generation, mediaTime: message.mediaTime,
        tracks: [], detections: boxes, detectionCount: boxes.length, provider, preprocessMs, modelRunMs,
        postprocessMs: performance.now() - postprocessStarted, inferenceMs: performance.now() - start
      });
      return;
    }
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
    send({
      type: 'result', requestId: message.requestId, generation: message.generation,
      mediaTime: message.mediaTime, tracks: [...tracks, ...motorTracks],
      detectionCount: boxes.length,
      ...(message.diagnostics ? { detections: boxes } : {}),
      provider, preprocessMs, modelRunMs, postprocessMs: performance.now() - postprocessStarted,
      inferenceMs: performance.now() - start
    });
  } catch (e) {
    send({
      type: 'error', requestId: message.requestId, generation: message.generation,
      message: errorText(e)
    });
  } finally {
    // ONNX Runtime may own GPU buffers for each output tensor. Release the
    // output only after decoding it. The CPU input buffer and tensor
    // remain owned by this single-flight worker and are reused.
    disposeInferenceResources(null, outputTensors, error => {
      console.warn('[YOLO11s] Failed to release inference tensor:', error);
    });
    message.bitmap.close();
    working = false;
  }
}

self.onmessage = (event: MessageEvent<DetectorRequest>) => {
  const message = event.data;
  if (message.type === 'reset') {
    epoch += 1;
    tracker.reset();
    twoWheelers.reset();
    observations.clear();
  } else if (message.type === 'init') {
    void initialize(message);
  } else {
    void handleFrame(message);
  }
};
