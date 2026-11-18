/**
 * Recorded-video analysis can trade playback speed for additional detector
 * observations when browser inference is slower than the video clock.
 *
 * Never change a camera or shared-tab capture clock. This helper only
 * recommends a playback rate for a local/archived <video>.
 *
 * Target <= 200ms of MEDIA time between completed detector observations.
 * A slow CPU may still be too slow at the minimum supported 0.1x rate:
 * callers must not treat this as an accuracy guarantee.
 */
export const INITIAL_SYNC_PLAYBACK_RATE = 0.1;
export const MIN_SYNC_PLAYBACK_RATE = 0.1;
export const SYNC_MEDIA_STEP_SECONDS = 0.2;

export function recommendedSyncPlaybackRate(
  inferenceMs: number,
  currentRate: number,
): number {
  if (!Number.isFinite(inferenceMs) || inferenceMs <= 0) {
    return Number.isFinite(currentRate) && currentRate > 0
      ? Math.min(1, Math.max(MIN_SYNC_PLAYBACK_RATE, currentRate))
      : INITIAL_SYNC_PLAYBACK_RATE;
  }

  // Include a small buffer for capture and worker-message scheduling.
  const elapsedSec = (inferenceMs + 120) / 1000;
  const target = Math.min(1, Math.max(
    MIN_SYNC_PLAYBACK_RATE,
    SYNC_MEDIA_STEP_SECONDS / elapsedSec
  ));
  const previous = Number.isFinite(currentRate) && currentRate >= MIN_SYNC_PLAYBACK_RATE
    ? Math.min(1, currentRate) : INITIAL_SYNC_PLAYBACK_RATE;

  // Avoid playback-rate oscillation on noisy per-frame inference latency.
  const smoothed = previous * 0.35 + target * 0.65;
  return Math.min(1, Math.max(MIN_SYNC_PLAYBACK_RATE, Math.round(smoothed * 100) / 100));
}

/** Hold only recorded Sync playback during a cold ONNX model startup. */
export function shouldHoldRecordedPlayback(
  syncedPlayback: boolean,
  detectorReady: boolean,
  liveCapture: boolean,
): boolean {
  return syncedPlayback && !detectorReady && !liveCapture;
}
