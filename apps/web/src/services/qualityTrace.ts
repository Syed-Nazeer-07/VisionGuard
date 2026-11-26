import type { LiveTrack } from '../pipeline/tracker/liveProjection';

export const QA_MAX_FRAMES = 1200;
export const QA_MIN_FRAME_INTERVAL_SEC = 0.10;
export const QA_MAX_INFERENCES = 1200;

export type QualityInference = {
  mediaTime: number;
  inferenceMs: number;
  resultAgeMs: number | null;
  provider: string;
  detectionCount: number;
  replayAnchorAvailable: boolean;
};

/** Captures the worker's actual timing and replay eligibility, not estimated FPS. */
export function appendQualityInference(samples: QualityInference[], sample: QualityInference): boolean {
  if (samples.length >= QA_MAX_INFERENCES ||
      !Number.isFinite(sample.mediaTime) || sample.mediaTime < 0 ||
      !Number.isFinite(sample.inferenceMs) || sample.inferenceMs < 0 ||
      !Number.isSafeInteger(sample.detectionCount) || sample.detectionCount < 0) return false;
  samples.push({
    mediaTime: sample.mediaTime, inferenceMs: sample.inferenceMs,
    resultAgeMs: sample.resultAgeMs !== null && Number.isFinite(sample.resultAgeMs) &&
      sample.resultAgeMs >= 0 ? sample.resultAgeMs : null,
    provider: sample.provider === 'webgpu' || sample.provider === 'wasm' ? sample.provider : 'unknown',
    detectionCount: sample.detectionCount, replayAnchorAvailable: sample.replayAnchorAvailable
  });
  return true;
}

function percentiles(values: number[]) {
  const sorted = values.filter(value => Number.isFinite(value) && value >= 0).sort((a,b) => a-b);
  const pick = (fraction: number) => sorted.length ? sorted[Math.ceil(sorted.length * fraction)-1] : null;
  return { samples: sorted.length, p50: pick(.5), p95: pick(.95) };
}

export function summarizeQualityPerformance(frames: readonly QualityFrame[], inferences: readonly QualityInference[]) {
  return {
    workerLatencyMs: percentiles(inferences.map(sample => sample.inferenceMs)),
    resultAgeMs: percentiles(inferences.flatMap(sample => sample.resultAgeMs === null ? [] : [sample.resultAgeMs])),
    overlayAgeMs: percentiles(frames.flatMap(frame => typeof frame.overlayAgeMs === 'number' ? [frame.overlayAgeMs] : [])),
    replayAnchorMisses: inferences.filter(sample => !sample.replayAnchorAvailable).length,
    inferenceSamples: inferences.length,
    overlayFrames: frames.length,
    framesWithPredictions: frames.filter(frame => frame.predictions.length > 0).length,
    providers: [...new Set(inferences.map(sample => sample.provider))]
  };
}
export type QualityFrame = {
  time: number;
  width: number;
  height: number;
  overlayAgeMs?: number | null;
  // Deliberately null until a human labels the same frame.
  // The evaluator REJECTS unannotated exports to prevent false accuracy.
  groundTruth: null;
  exitedIds: null;
  predictions: Array<{
    id: number; className: string; confidence: number; isPredicted: boolean;
    box: { x: number; y: number; w: number; h: number };
  }>;
};

/** Captures the displayed overlay in source-video coordinates.
 * Never stores pixel data, credentials, footage, or identities of users. */
export function appendQualityFrame(
  frames: QualityFrame[],
  time: number,
  width: number,
  height: number,
  tracks: readonly LiveTrack[],
  overlayAgeMs?: number | null,
  overlayEnabled = true,
): boolean {
  if (!overlayEnabled || frames.length >= QA_MAX_FRAMES ||
      ![time, width, height].every(Number.isFinite) ||
      time < 0 || width <= 0 || height <= 0) return false;
  const previous = frames[frames.length - 1];
  if (previous && time - previous.time < QA_MIN_FRAME_INTERVAL_SEC) return false;
  if (previous && time <= previous.time) return false;
  frames.push({
    time, width, height, overlayAgeMs, groundTruth: null, exitedIds: null,
    predictions: tracks.filter(t =>
      [t.x, t.y, t.w, t.h, t.confidence].every(Number.isFinite) &&
      t.w > 0 && t.h > 0 && t.className.trim() !== ''
    ).map(t => ({
      id: t.id, className: t.className, confidence: t.confidence,
      isPredicted: !!t.isPredicted,
      box: { x: t.x, y: t.y, w: t.w, h: t.h },
    })),
  });
  return true;
}
export function serializeQualityTrace(frames: readonly QualityFrame[], inferences: readonly QualityInference[] = [], playbackRate = 1): string {
  return JSON.stringify({
    format: 'visionguard-tracking-eval/v1',
    annotationStatus: 'NOT ANNOTATED - fill groundTruth and exitedIds before scoring',
    note: 'Browser-overlay predictions only; no model accuracy is implied',
    playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : null,
    performance: summarizeQualityPerformance(frames, inferences),
    inferences,
    frames,
  }, null, 2) + '\n';
}
