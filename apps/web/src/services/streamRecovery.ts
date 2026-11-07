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
