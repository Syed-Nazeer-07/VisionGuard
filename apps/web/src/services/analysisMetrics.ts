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
