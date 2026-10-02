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
import type { WorkerMessage, Point } from '../types';

env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

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

// Preprocess ImageBitmap via OffscreenCanvas
function preprocess(imageData: ImageData, targetSize: number): { tensor: Tensor; ratio: number; padW: number; padH: number } {
  const { width, height, data } = imageData;
  
  const ratio = Math.min(targetSize / width, targetSize / height);
  const newUnpadW = Math.round(width * ratio);
  const newUnpadH = Math.round(height * ratio);
  
  const padW = (targetSize - newUnpadW) / 2;
  const padH = (targetSize - newUnpadH) / 2;
  
  const float32Data = new Float32Array(3 * targetSize * targetSize);
  float32Data.fill(114.0 / 255.0); // gray padding
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      
      const dstX = Math.round(x * ratio + padW);
      const dstY = Math.round(y * ratio + padH);
      
      if (dstX >= 0 && dstX < targetSize && dstY >= 0 && dstY < targetSize) {
        float32Data[0 * targetSize * targetSize + dstY * targetSize + dstX] = data[srcIdx] / 255.0;
        float32Data[1 * targetSize * targetSize + dstY * targetSize + dstX] = data[srcIdx + 1] / 255.0;
        float32Data[2 * targetSize * targetSize + dstY * targetSize + dstX] = data[srcIdx + 2] / 255.0;
      }
    }
  }
  
  return {
    tensor: new Tensor('float32', float32Data, [1, 3, targetSize, targetSize]),
    ratio,
    padW,
    padH
  };
}

// We need an offscreen canvas to extract pixels from the transferred ImageBitmap
let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    try {
      try {
        session = await InferenceSession.create(msg.modelPath, { executionProviders: ['webgpu'] });
        provider = 'webgpu';
        console.log('ONNX Runtime initialized with WebGPU');
      } catch (err) {
        console.warn('WebGPU failed, falling back to WASM', err);
        session = await InferenceSession.create(msg.modelPath, { executionProviders: ['wasm'] });
        provider = 'wasm';
        console.log('ONNX Runtime initialized with WASM');
      }
      self.postMessage({ type: 'ready', provider });
    } catch (error) {
      console.error('Failed to load ONNX model:', error);
      self.postMessage({ type: 'error', error: String(error) });
    }
  } else if (msg.type === 'inference') {
    if (!session) {
      self.postMessage({ type: 'error', error: 'Model not initialized' });
      return;
    }

    try {
      const { bitmap, mediaTime, calibration, featureFlags } = msg;

      if (featureFlags) {
        overspeedRule.isEnabled = featureFlags.speed_detection;
        redLightRule.isEnabled = featureFlags.red_light_detection;
        laneRule.isEnabled = featureFlags.lane_detection;
        helmetRule.isEnabled = featureFlags.helmet_detection;
        tripleRidingRule.isEnabled = featureFlags.triple_riding_detection;
      }

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

      if (!offscreenCanvas || offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
        offscreenCanvas = new OffscreenCanvas(width, height);
        offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
      }

      if (!offscreenCtx) {
        throw new Error('Failed to get offscreen canvas context');
      }

      offscreenCtx.drawImage(bitmap, 0, 0);
      const imageData = offscreenCtx.getImageData(0, 0, width, height);
      
      // Close the bitmap to free memory immediately
      bitmap.close();
      
      const targetSize = 640;
      const { tensor, ratio, padW, padH } = preprocess(imageData, targetSize);
      
      const feeds: Record<string, Tensor> = {};
      feeds[session.inputNames[0]] = tensor;
      
      const results = await session.run(feeds);
      const output = results[session.outputNames[0]];
      
      const inferenceTime = performance.now() - start;
      
      const confidenceThreshold = 0.35;
      const iouThreshold = 0.5;
      let boxes = processOutput(output.data as Float32Array, confidenceThreshold, iouThreshold);
      
      // Filter for target classes (person, car, motorcycle, bus, truck, traffic light)
      const allowedClasses = [0, 2, 3, 5, 7, 9];
      boxes = boxes.filter(b => allowedClasses.includes(b.classId));
      
      const tracks = tracker.update(boxes);
      
      for (const track of tracks) {
        // Normalize coordinates to 0-1 for speed tracking (homography expects normalized)
        track.x = (track.x - padW) / ratio;
        track.y = (track.y - padH) / ratio;
        track.w = track.w / ratio;
        track.h = track.h / ratio;

        if (speedEstimator) {
          const res = speedEstimator.update(track.trackId, track, mediaTime);
          if (res) {
            track.speed = res.speed;
            track.isOverspeed = res.isOverspeed;
          }
        }
      }
      
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
      
      self.postMessage({
        type: 'result',
        boxes,
        tracks,
        inferenceTime,
        provider,
        violations
      });
      
    } catch (error) {
      console.error('Inference error:', error);
      self.postMessage({ type: 'error', error: String(error) });
    }
  } else if (msg.type === 'reset_tracker') {
    tracker.reset();
    speedEstimator?.reset();
    ruleEngine.reset();
  }
};
