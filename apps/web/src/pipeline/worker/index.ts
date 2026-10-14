import { env, InferenceSession, Tensor } from 'onnxruntime-web';
import { processOutput } from '../detector/postprocess';
import { ByteTracker } from '../tracker/bytetrack';
import { SpeedEstimator } from '../tracker/speed';
import { computeHomography } from '../tracker/homography';
import { RuleEngine } from '../violations/RuleEngine';
import { OverspeedRule } from '../violations/rules/OverspeedRule';
import { RedLightRule } from '../violations/rules/RedLightRule';
import { LaneRule } from '../violations/rules/LaneRule';
import { HelmetRule } from '../violations/rules/HelmetRule';
import { TripleRidingRule } from '../violations/rules/TripleRidingRule';
import { detectPlateRegion } from '../plate/detector';
import { generatePlateCrop } from '../plate/crop';
import { evaluateEvidence } from '../evidence/scoring';
import { addEvidenceCandidate, getBestEvidence, removeEvidence, clearEvidenceCollector } from '../evidence/collector';
import type { WorkerMessage, Point, TrackedObject } from '../types';
import type { PlateDetection } from '../plate/types';
// Dev: the visionguard-onnxruntime-wasm Vite plugin serves the runtime artifacts at the site root,
// straight from the installed onnxruntime-web package. Production: Vite emits the matching
// ort-wasm-simd-threaded.jsep.wasm as a hashed asset and ORT resolves it via import.meta.url.
if (import.meta.env.DEV) {
  env.wasm.wasmPaths = '/';
}


function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}

// Prefer WebGPU when the browser exposes an adapter; otherwise (or on failure) use the WASM backend.
async function createSession(modelPath: string): Promise<{ session: InferenceSession; provider: 'webgpu' | 'wasm'; fallbackReason: string | null }> {
  let fallbackReason: string | null = null;
  const gpu = (self.navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;

  if (!gpu) {
    fallbackReason = 'WebGPU is not available in this browser';
  } else {
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) {
        fallbackReason = 'No WebGPU adapter available';
      } else {
        const webgpuSession = await InferenceSession.create(modelPath, { executionProviders: ['webgpu'] });
        return { session: webgpuSession, provider: 'webgpu', fallbackReason: null };
      }
    } catch (err) {
      fallbackReason = `WebGPU initialization failed: ${errorMessage(err)}`;
      console.warn('[ONNX] WebGPU failed, falling back to WASM:', err);
    }
  }

  try {
    const wasmSession = await InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
    return { session: wasmSession, provider: 'wasm', fallbackReason };
  } catch (err) {
    throw new Error(`ONNX Runtime could not initialize any backend (${fallbackReason ?? 'WebGPU skipped'}; WASM: ${errorMessage(err)})`);
  }
}
let session: InferenceSession | null = null;
let provider: string = '';
const tracker = new ByteTracker();
let speedEstimator: SpeedEstimator | null = null;
let currentCalibrationHash = '';

const ruleEngine = new RuleEngine();
const overspeedRule = new OverspeedRule(false);
const redLightRule = new RedLightRule(false);
const laneRule = new LaneRule(false);
const helmetRule = new HelmetRule(false);
const tripleRidingRule = new TripleRidingRule(false);

ruleEngine.register(overspeedRule);
ruleEngine.register(redLightRule);
ruleEngine.register(laneRule);
ruleEngine.register(helmetRule);
ruleEngine.register(tripleRidingRule);

const MODEL_INPUT_SIZE = 640;
// One reusable model-input canvas. The GPU/browser rescales the frame into the 640x640 letterbox;
// reading back 640x640 (1.6 MB) instead of the full frame (8 MB at 1080p) and avoiding a per-source-
// pixel JS loop is what keeps worker latency low enough for overlays to stay fresh.
let modelCanvas: OffscreenCanvas | null = null;
let modelCtx: OffscreenCanvasRenderingContext2D | null = null;

interface LetterboxParams { ratio: number; padW: number; padH: number }

/**
 * Letterbox the frame into the model input.
 * Coordinate contract: model-space (x_m, y_m) maps back to source pixels with
 *   x_src = (x_m - padW) / ratio,   y_src = (y_m - padH) / ratio.
 * The same integer pad and scaled size are used for drawing and for the inverse mapping.
 */
function preprocess(bitmap: ImageBitmap, targetSize: number): { tensor: Tensor } & LetterboxParams {
  const width = bitmap.width;
  const height = bitmap.height;

  const ratio = Math.min(targetSize / width, targetSize / height);
  const scaledW = Math.max(1, Math.round(width * ratio));
  const scaledH = Math.max(1, Math.round(height * ratio));
  const padW = Math.round((targetSize - scaledW) / 2);
  const padH = Math.round((targetSize - scaledH) / 2);

  if (!modelCanvas) {
    modelCanvas = new OffscreenCanvas(targetSize, targetSize);
    modelCtx = modelCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!modelCtx) throw new Error('Failed to get model-input canvas context');

  modelCtx.fillStyle = 'rgb(114, 114, 114)'; // YOLO letterbox gray
  modelCtx.fillRect(0, 0, targetSize, targetSize);
  modelCtx.imageSmoothingEnabled = true;
  modelCtx.drawImage(bitmap, 0, 0, width, height, padW, padH, scaledW, scaledH);

  const { data } = modelCtx.getImageData(0, 0, targetSize, targetSize);
  const plane = targetSize * targetSize;
  const float32Data = new Float32Array(3 * plane);
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    float32Data[i] = data[p] / 255.0;
    float32Data[plane + i] = data[p + 1] / 255.0;
    float32Data[2 * plane + i] = data[p + 2] / 255.0;
  }

  return {
    tensor: new Tensor('float32', float32Data, [1, 3, targetSize, targetSize]),
    ratio,
    padW,
    padH
  };
}

let lastMediaTime: number | null = null;

interface EvidenceJob { track: TrackedObject; plate: PlateDetection | null; score: number }

/**
 * Vehicle/plate crop collection is JPEG encoding work. It runs AFTER the result has been posted so
 * it can never delay the overlay, and it owns (and finally closes) the bitmap.
 */
async function collectEvidence(
  bitmap: ImageBitmap,
  jobs: EvidenceJob[],
  platesEnabled: boolean
): Promise<void> {
  try {
    for (const { track, plate, score } of jobs) {
      try {
        // Vehicle crop in source-pixel coordinates (track.x/y are the box CENTER)
        const vw = Math.min(bitmap.width, Math.floor(track.w));
        const vh = Math.min(bitmap.height, Math.floor(track.h));
        if (vw <= 0 || vh <= 0) continue;
        const vx = Math.max(0, Math.floor(track.x - track.w / 2));
        const vy = Math.max(0, Math.floor(track.y - track.h / 2));

        const vCanvas = new OffscreenCanvas(vw, vh);
        const vCtx = vCanvas.getContext('2d');
        vCtx?.drawImage(bitmap, vx, vy, vw, vh, 0, 0, vw, vh);
        const vBlob = await vCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(vBlob);
        });

        let plateCropBase64 = '';
        if (plate && platesEnabled) {
          try {
            plateCropBase64 = await generatePlateCrop(bitmap, plate);
          } catch { /* plate crop is best effort */ }
        }

        addEvidenceCandidate(track.trackId, {
          id: track.trackId.toString(),
          type: 'vehicle_crop',
          base64Data,
          score,
          metadata: {
            track_id: track.trackId,
            timestamp: new Date().toISOString(),
            speed: track.speed,
            confidence: track.prob,
            plate_crop_path: plateCropBase64 // we hijack this field for in-memory plate crop
          }
        });
      } catch (e) {
        console.warn('Failed to collect evidence', e);
      }
    }
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      const result = await createSession(msg.modelPath);
      session = result.session;
      provider = result.provider;
      self.postMessage({ type: 'ready', provider, fallbackReason: result.fallbackReason });
    } catch (error) {
      console.error('Failed to load ONNX model:', error);
      self.postMessage({ type: 'error', phase: 'init', error: errorMessage(error) });
    }
  } else if (msg.type === 'inference') {
    // The bitmap is closed on every path: by collectEvidence on success, otherwise below.
    let bitmapHandedToEvidence = false;
    try {
      if (!session) {
        self.postMessage({ type: 'error', phase: 'inference', frameId: msg.frameId, sourceGeneration: msg.sourceGeneration, error: 'Model not initialized' });
        return;
      }

      const { bitmap, mediaTime, frameId, sourceGeneration, calibration, featureFlags } = msg;

      if (featureFlags) {
        overspeedRule.isEnabled = featureFlags.speed_detection;
        redLightRule.isEnabled = featureFlags.red_light_detection;
        laneRule.isEnabled = featureFlags.lane_detection;
        helmetRule.isEnabled = featureFlags.helmet_detection;
        tripleRidingRule.isEnabled = featureFlags.triple_riding_detection;
      }

      // Media-time delta between the previous *processed* frame and this one (dropped frames
      // included). Used only to express tracker displacement per second.
      const dt = lastMediaTime !== null ? mediaTime - lastMediaTime : 0;
      lastMediaTime = mediaTime;

      if (calibration) {
        const hash = JSON.stringify(calibration);
        if (hash !== currentCalibrationHash) {
          currentCalibrationHash = hash;
          speedEstimator = new SpeedEstimator(calibration.speedLimit, calibration.tolerance);

          if (calibration.calibrationArea && calibration.calibrationArea.length === 4) {
            const dst: Point[] = [
              { x: 0, y: 0 },
              { x: calibration.referenceWidth, y: 0 },
              { x: calibration.referenceWidth, y: calibration.referenceHeight },
              { x: 0, y: calibration.referenceHeight }
            ];
            const H = computeHomography(calibration.calibrationArea, dst);
            speedEstimator.setHomography(H);
          }
        }
      }

      const start = performance.now();
      const width = bitmap.width;
      const height = bitmap.height;

      const { tensor, ratio, padW, padH } = preprocess(bitmap, MODEL_INPUT_SIZE);

      const feeds: Record<string, Tensor> = {};
      feeds[session.inputNames[0]] = tensor;

      const results = await session.run(feeds);
      const output = results[session.outputNames[0]];

      const inferenceTime = performance.now() - start;

      const confidenceThreshold = typeof msg.confidenceThreshold === 'number' ? msg.confidenceThreshold : 0.20;
      const iouThreshold = typeof msg.iouThreshold === 'number' ? msg.iouThreshold : 0.45;
      tracker.trackThreshold = Math.min(0.25, Math.max(0.15, confidenceThreshold));
      let boxes = processOutput(output.data as Float32Array, confidenceThreshold, iouThreshold);

      // Filter for target classes (person, bicycle, car, motorcycle, bus, truck, traffic light)
      const allowedClasses = [0, 1, 2, 3, 5, 7, 9];
      boxes = boxes.filter(b => allowedClasses.includes(b.classId));

      // ByteTrack runs in MODEL space: boxes are CENTER-format (cx, cy, w, h) in 640x640 letterbox
      // pixels. It is updated exactly once per processed frame, here.
      const tracks = tracker.update(boxes);

      // Safe dt for velocity calculation (avoid divide by zero and overly long frames)
      const safeDt = dt > 0.01 && dt < 1.0 ? dt : 1 / 30;

      const evidenceJobs: EvidenceJob[] = [];
      const platesEnabled = featureFlags?.plate_detection ?? false;

      for (const track of tracks) {
        // Convert once from model space to ORIGINAL video pixels (still CENTER format).
        track.x = (track.x - padW) / ratio;
        track.y = (track.y - padH) / ratio;
        track.w = track.w / ratio;
        track.h = track.h / ratio;
        if (track.dx !== undefined) track.dx = (track.dx / ratio) / safeDt;
        if (track.dy !== undefined) track.dy = (track.dy / ratio) / safeDt;
        if (track.dw !== undefined) track.dw = (track.dw / ratio) / safeDt;
        if (track.dh !== undefined) track.dh = (track.dh / ratio) / safeDt;

        const isVehicle = track.className === 'car' || track.className === 'truck' || track.className === 'bus' || track.className === 'motorcycle' || track.className === 'bicycle';
        if (speedEstimator && isVehicle) {
          // Homography uses 0-1 normalized coordinates
          const normalizedBox = {
            x: track.x / width,
            y: track.y / height,
            w: track.w / width,
            h: track.h / height
          };
          const res = speedEstimator.update(track.trackId, normalizedBox, mediaTime);
          if (res) {
            track.speed = res.speed;
            track.velocity = res.velocity;
            track.isOverspeed = res.isOverspeed;
            track.isEstimatedSpeed = res.isEstimated;
          } else {
            track.speed = undefined;
            track.velocity = undefined;
            track.isOverspeed = false;
          }
        } else {
          track.speed = undefined;
          track.velocity = undefined;
          track.isOverspeed = false;
        }

        // Evidence scoring is cheap; the expensive crop/encode is deferred until after the post.
        const plate = detectPlateRegion(track);
        const score = evaluateEvidence({
          detectionConfidence: track.prob,
          visibleArea: (track.w * track.h) / (width * height),
          hasPlate: plate !== null
        });
        const currentBest = getBestEvidence(track.trackId);
        if (!currentBest || score > currentBest.score) {
          evidenceJobs.push({ track: { ...track }, plate, score });
        }
      }

      // Raw detections are reported in original video pixels (CENTER format) as well.
      for (const box of boxes) {
        box.x = (box.x - padW) / ratio;
        box.y = (box.y - padH) / ratio;
        box.w = box.w / ratio;
        box.h = box.h / ratio;
      }

      const violations = ruleEngine.evaluate(tracks, {
        mediaTime,
        fps: 30, // Passed or fixed for now
        calibration
      });

      // Handle plate detection for violations
      if (platesEnabled) {
        for (const candidate of violations) {
          const bestEvidence = getBestEvidence(candidate.metadata.track_id);

          if (bestEvidence) {
            candidate.metadata.evidence_metadata = { score: bestEvidence.score };
            candidate.snapshot_url = bestEvidence.base64Data; // Use the best vehicle crop as snapshot
            const plateCrop = (bestEvidence.metadata as { plate_crop_path?: string }).plate_crop_path;
            if (plateCrop) {
              candidate.metadata.plate_crop_path = plateCrop;
              candidate.metadata.ocr_status = 'pending';
            }
          }

          // Cleanup evidence for flagged violations so we don't leak memory
          removeEvidence(candidate.metadata.track_id);
        }
      }

      // Result first: the overlay must never wait on evidence encoding.
      self.postMessage({
        type: 'result',
        frameId,
        sourceGeneration,
        mediaTime,
        sourceWidth: width,
        sourceHeight: height,
        detectionCount: boxes.length,
        boxes,
        tracks,
        inferenceTime,
        provider,
        violations
      });

      if (evidenceJobs.length > 0) {
        bitmapHandedToEvidence = true;
        void collectEvidence(bitmap, evidenceJobs, platesEnabled);
      }
    } catch (error) {
      console.error('Inference error:', error);
      self.postMessage({ type: 'error', phase: 'inference', frameId: msg.frameId, sourceGeneration: msg.sourceGeneration, error: errorMessage(error) });
    } finally {
      if (!bitmapHandedToEvidence) {
        try { msg.bitmap.close(); } catch { /* already closed */ }
      }
    }
  } else if (msg.type === 'reset_tracker') {
    tracker.reset();
    lastMediaTime = null;
    speedEstimator?.reset();
    ruleEngine.reset();
    // Track IDs restart from 1, so evidence collected for the old IDs would be mis-attributed.
    clearEvidenceCollector();
  }
};
