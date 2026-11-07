/**
 * Pure guard used by the live player to distinguish a genuinely frozen feed
 * from a paused video, a seek or a background tab.
 */
export function isStreamStalled(
  nowMs: number,
  lastPresentedAtMs: number,
  state: { paused: boolean; ended: boolean; seeking: boolean },
  thresholdMs = 15_000
): boolean {
  return Number.isFinite(nowMs) && Number.isFinite(lastPresentedAtMs) &&
    lastPresentedAtMs > 0 && thresholdMs > 0 &&
    !state.paused && !state.ended && !state.seeking &&
    nowMs - lastPresentedAtMs >= thresholdMs;
}

export function liveRetryDelay(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 1) return 0;
  return Math.min(7_500, 1_500 * Math.floor(attempt));
}

/**
 * requestVideoFrameCallback reports real decoded frames. For the RAF fallback,
 * do not treat repeated reads of a frozen video.currentTime as fresh frames.
 * A first valid frame is accepted, and seeks/reconnections reset the caller's
 * previous timestamp to null.
 */
export function hasAdvancedVideoFrame(previous: number | null, mediaTime: number): boolean {
  if (!Number.isFinite(mediaTime) || mediaTime < 0) return false;
  if (previous === null) return true;
  return mediaTime > previous + 0.001;
}
