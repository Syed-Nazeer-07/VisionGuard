/**
 * In-browser inference cannot keep up with full-speed video on every device.
 * Rather than presenting stale bounding boxes, optional synced playback
 * slows the *video clock* to the verified inference throughput.
 * Never pretend the detector or display is running at source FPS.
 */
export function recommendedPlaybackRate(roundTripMs: number, sourceFps: number): number {
  if (!Number.isFinite(roundTripMs) || roundTripMs <= 0 ||
      !Number.isFinite(sourceFps) || sourceFps < 5 || sourceFps > 240) return 1;
  // A 10% budget keeps the rendering overlay ahead of the video clock.
  const target = 1000 / (roundTripMs * sourceFps * 1.1);
  return Math.max(0.20, Math.min(1, target));
}

/** Remove jitter from scene frame-rate estimates derived from video frame callbacks. */
export function estimateVideoFrameRate(previous: number, deltaFrames: number, deltaMediaSeconds: number): number {
  if (!Number.isFinite(deltaMediaSeconds) || deltaMediaSeconds <= 0 ||
      !Number.isInteger(deltaFrames) || deltaFrames < 1) return previous;
  const fps = deltaFrames / deltaMediaSeconds;
  if (fps < 12 || fps > 120) return previous;
  return Math.max(12, Math.min(120, previous * 0.8 + fps * 0.2));
}
