/**
 * Timing policy shared by the Live Analysis coordinator and the overlay renderer.
 * Every value here is in MEDIA TIME seconds (the <video> element's own clock): result age is
 * `displayed frame media time - result frame media time`, never a wall-clock difference.
 */
export const MAX_OVERLAY_AGE_SECONDS = 0.18;
export const MAX_OVERLAY_FUTURE_SKEW_SECONDS = 0.025;
/** A single request outstanding this long means the worker is wedged: it is replaced. */
export const WORKER_STALL_RESTART_MS = 20000;
/** Consecutive per-frame inference exceptions tolerated before the run is stopped. */
export const MAX_CONSECUTIVE_INFERENCE_ERRORS = 5;

export function isOverlayAgeFresh(
  ageSeconds: number,
  maxAgeSeconds = MAX_OVERLAY_AGE_SECONDS,
  maxFutureSkewSeconds = MAX_OVERLAY_FUTURE_SKEW_SECONDS,
): boolean {
  return Number.isFinite(ageSeconds) && ageSeconds <= maxAgeSeconds && ageSeconds >= -maxFutureSkewSeconds;
}

/** Age (seconds, media time) of a result relative to the frame currently on screen. */
export function computeResultAge(displayedMediaTime: number, resultMediaTime: number): number {
  if (!Number.isFinite(displayedMediaTime) || !Number.isFinite(resultMediaTime)) return Number.NaN;
  return displayedMediaTime - resultMediaTime;
}

/**
 * True when a result is temporally close enough to the currently displayed frame
 * to draw without prediction. Negative age means the result belongs to the future
 * (usually after a seek), which is also a mismatch.
 */
export function isOverlayTimestampFresh(
  displayedMediaTime: number,
  resultMediaTime: number,
  maxAgeSeconds = MAX_OVERLAY_AGE_SECONDS,
  maxFutureSkewSeconds = MAX_OVERLAY_FUTURE_SKEW_SECONDS,
): boolean {
  return isOverlayAgeFresh(computeResultAge(displayedMediaTime, resultMediaTime), maxAgeSeconds, maxFutureSkewSeconds);
}

/** Result identity is independent of freshness: old IDs must never release a newer request lock. */
export function matchesFrameRequest(
  expectedFrameId: number | null | undefined,
  resultFrameId: number | null | undefined,
): boolean {
  return Number.isInteger(expectedFrameId) && Number.isInteger(resultFrameId) && expectedFrameId === resultFrameId;
}

/** Inference never pauses playback: a frame is submitted only when analyzing, playing, and idle. */
export function canSubmitContinuousFrame(
  isWorkerBusy: boolean,
  videoPaused: boolean,
  runState: string,
): boolean {
  return runState === 'ANALYZING' && !videoPaused && !isWorkerBusy;
}

/** Stop the run only after repeated consecutive failures; one bad frame must not end analysis. */
export function shouldStopAfterInferenceErrors(consecutiveErrors: number): boolean {
  return consecutiveErrors >= MAX_CONSECUTIVE_INFERENCE_ERRORS;
}

/** The worker has held one request longer than any plausible inference (shader compile included). */
export function isWorkerStalled(inflightAgeMs: number, thresholdMs = WORKER_STALL_RESTART_MS): boolean {
  return inflightAgeMs >= thresholdMs;
}

export interface PipelineDiagnosisInput {
  workerBusyMs: number;
  latencyMs: number;
  resultAgeSeconds: number;
  detectionCount: number;
  trackCount: number;
  renderedTracks: number;
  workerErrors: number;
}

/** Names the most likely reason an overlay is missing, for the periodic heartbeat log. */
export function diagnosePipeline(input: PipelineDiagnosisInput): string {
  if (isWorkerStalled(input.workerBusyMs)) return 'worker stalled';
  if (input.latencyMs / 1000 > MAX_OVERLAY_AGE_SECONDS / 2) return 'insufficient inference throughput';
  if (!isOverlayAgeFresh(input.resultAgeSeconds)) return 'overlay stale';
  if (input.detectionCount === 0 && input.trackCount === 0) return 'detector returned no objects';
  if (input.trackCount > 0 && input.renderedTracks === 0) return 'renderer/transform issue';
  return 'healthy';
}
