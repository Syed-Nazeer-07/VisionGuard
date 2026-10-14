// @ts-ignore
import munkres from 'munkres-js';
import type { BoundingBox } from '../types';

export function getIOU(box1: {x: number, y: number, w: number, h: number}, box2: {x: number, y: number, w: number, h: number}): number {
  const x1 = Math.max(box1.x - box1.w / 2, box2.x - box2.w / 2);
  const y1 = Math.max(box1.y - box1.h / 2, box2.y - box2.h / 2);
  const x2 = Math.min(box1.x + box1.w / 2, box2.x + box2.w / 2);
  const y2 = Math.min(box1.y + box1.h / 2, box2.y + box2.h / 2);

  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);

  const intersection = w * h;
  const area1 = box1.w * box1.h;
  const area2 = box2.w * box2.h;

  return intersection / (area1 + area2 - intersection + 1e-6);
}

/**
 * COCO classes that detectors routinely confuse frame to frame (car / bus / truck) form one
 * association group. Everything else is its own group, so a person can never take over a car.
 */
export function classGroup(classId: number): number {
  if (classId === 2 || classId === 5 || classId === 7) return 2;
  return classId;
}

export function matchDetectionsToTracks(
  detections: BoundingBox[],
  tracks: { getState: () => { cx: number; cy: number; w: number; h: number }; classId?: number }[],
  iouThreshold: number
): { matches: [number, number][]; unmatchedDetections: number[]; unmatchedTracks: number[] } {
  if (tracks.length === 0) {
    return {
      matches: [],
      unmatchedDetections: detections.map((_, i) => i),
      unmatchedTracks: []
    };
  }

  if (detections.length === 0) {
    return {
      matches: [],
      unmatchedDetections: [],
      unmatchedTracks: tracks.map((_, i) => i)
    };
  }

  const costMatrix: number[][] = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const trackState = track.getState();
    const row: number[] = [];
    for (let j = 0; j < detections.length; j++) {
      const det = detections[j];
      // Class gating by group: tracks cannot associate with detections of a different object kind
      if (track.classId !== undefined && det.classId !== undefined && classGroup(track.classId) !== classGroup(det.classId)) {
        row.push(1.0);
        continue;
      }
      const iou = getIOU(
        { x: trackState.cx, y: trackState.cy, w: trackState.w, h: trackState.h },
        det
      );
      // Cost is 1 - IOU. Munkres minimizes cost.
      row.push(1 - iou);
    }
    costMatrix.push(row);
  }

  const assignments = munkres(costMatrix);
  const matches: [number, number][] = [];
  const unmatchedTracks = new Set(tracks.map((_, i) => i));
  const unmatchedDetections = new Set(detections.map((_, i) => i));

  for (const [trackIdx, detIdx] of assignments) {
    const cost = costMatrix[trackIdx][detIdx];
    const iou = 1 - cost;
    if (iou >= iouThreshold) {
      matches.push([trackIdx, detIdx]);
      unmatchedTracks.delete(trackIdx);
      unmatchedDetections.delete(detIdx);
    }
  }

  return {
    matches,
    unmatchedTracks: Array.from(unmatchedTracks),
    unmatchedDetections: Array.from(unmatchedDetections)
  };
}
