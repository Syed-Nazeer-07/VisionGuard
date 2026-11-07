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

/** A paused local file can legitimately keep its last visible boxes.
 * A browser-tab/camera stream cannot: a muted, stalled or nonadvancing feed
 * otherwise leaves ghosts drawn over a video frame that is no longer live.
 * Timestamps use performance.now() / requestAnimationFrame's common clock.
 */
export const LIVE_OVERLAY_FRESHNESS_MS = 3000;
export function shouldPaintLiveOverlay(
  captureKind: 'tab' | 'camera' | null,
  nowMs: number,
  lastDecodedAtMs: number,
  state: { paused: boolean; ended: boolean; seeking: boolean },
  captureStalled: boolean,
): boolean {
  if (captureKind === null) return true;
  if (captureStalled || state.paused || state.ended || state.seeking) return false;
  return Number.isFinite(nowMs) && Number.isFinite(lastDecodedAtMs) &&
    lastDecodedAtMs > 0 && nowMs >= lastDecodedAtMs &&
    nowMs - lastDecodedAtMs <= LIVE_OVERLAY_FRESHNESS_MS;
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
