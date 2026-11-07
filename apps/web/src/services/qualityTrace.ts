import type { LiveTrack } from '../pipeline/tracker/liveProjection';

export const QA_MAX_FRAMES = 1200;
export const QA_MIN_FRAME_INTERVAL_SEC = 0.10;
export type QualityFrame = {
  time: number;
  width: number;
  height: number;
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
): boolean {
  if (frames.length >= QA_MAX_FRAMES ||
      ![time, width, height].every(Number.isFinite) ||
      time < 0 || width <= 0 || height <= 0) return false;
  const previous = frames[frames.length - 1];
  if (previous && time - previous.time < QA_MIN_FRAME_INTERVAL_SEC) return false;
  if (previous && time <= previous.time) return false;
  frames.push({
    time, width, height, groundTruth: null, exitedIds: null,
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
export function serializeQualityTrace(frames: readonly QualityFrame[]): string {
  return JSON.stringify({
    format: 'visionguard-tracking-eval/v1',
    annotationStatus: 'NOT ANNOTATED - fill groundTruth and exitedIds before scoring',
    note: 'Browser-overlay predictions only; no model accuracy is implied',
    frames,
  }, null, 2) + '\n';
}
