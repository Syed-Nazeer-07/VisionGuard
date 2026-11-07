/** Count actual YOLO detections rather than analyzed/video frames.
 *
 * Fast mode includes interpolated frames whose detection_count must remain zero.
 * For newly generated backend artifacts, prefer the authoritative summary field.
 * For older saved artifacts, derive the count from per-frame records.
 */
export function countBackendDetections(
  frames: ReadonlyArray<{ detection_count?: number; boxes?: readonly unknown[] }>,
  reportedCount?: number | null
): number {
  if (typeof reportedCount === 'number' && Number.isSafeInteger(reportedCount) && reportedCount >= 0) {
    return reportedCount;
  }
  return frames.reduce((total, frame) => {
    const count = frame.detection_count;
    if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) {
      return total + count;
    }
    return total + (frame.boxes?.length ?? 0);
  }, 0);
}

/** Highest visible optical speed estimate. Prediction-only boxes are not
 * measurements, and out-of-range values must never enter the live summary. */
export function fastestVisibleEstimate(
  tracks: ReadonlyArray<{ speedKmh: number | null; isPredicted?: boolean }>
): number | null {
  let fastest: number | null = null;
  for (const track of tracks) {
    const speed = track.speedKmh;
    if (track.isPredicted || speed === null || !Number.isFinite(speed) ||
        speed < 0 || speed > 160) continue;
    fastest = fastest === null ? speed : Math.max(fastest, speed);
  }
  return fastest;
}
