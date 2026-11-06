import type { BoundingBox } from '../types';
import { LABELS } from './labels';

export function iou(box1: BoundingBox, box2: BoundingBox): number {
  const x1 = Math.max(box1.x - box1.w / 2, box2.x - box2.w / 2);
  const y1 = Math.max(box1.y - box1.h / 2, box2.y - box2.h / 2);
  const x2 = Math.min(box1.x + box1.w / 2, box2.x + box2.w / 2);
  const y2 = Math.min(box1.y + box1.h / 2, box2.y + box2.h / 2);

  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);

  const intersection = w * h;
  const area1 = box1.w * box1.h;
  const area2 = box2.w * box2.h;

  return intersection / Math.max(1e-6, area1 + area2 - intersection);
}

export function iom(box1: BoundingBox, box2: BoundingBox): number {
  const x1 = Math.max(box1.x - box1.w / 2, box2.x - box2.w / 2);
  const y1 = Math.max(box1.y - box1.h / 2, box2.y - box2.h / 2);
  const x2 = Math.min(box1.x + box1.w / 2, box2.x + box2.w / 2);
  const y2 = Math.min(box1.y + box1.h / 2, box2.y + box2.h / 2);

  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const intersection = w * h;
  const minArea = Math.min(box1.w * box1.h, box2.w * box2.h);
  return minArea > 0 ? intersection / minArea : 0;
}

/**
 * Score-sorted, vehicle-aware NMS. Suppress same-class duplicates.
 * Also suppress near-identical four-wheeler boxes (car/truck/bus class
 * instability), but preserve bicycle vs motorcycle and rider vs bike.
 * Never use broad sub-box containment that suppresses true road users.
 */
export function nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
  const ordered = [...boxes].sort((a, b) => b.prob - a.prob);
  const selected: BoundingBox[] = [];
  const fourWheeler = (id: number) => id === 2 || id === 5 || id === 7;
  for (const box of ordered) {
    const duplicate = selected.some(other => {
      const overlap = iou(box, other);
      if (other.classId === box.classId) return overlap > iouThreshold;
      // Strong overlap between 4-wheel vehicle classes is usually the same
      // object classified differently; a much stricter gate avoids erasing
      // partially overlapping neighboring cars.
      return fourWheeler(other.classId) && fourWheeler(box.classId) && overlap > Math.max(0.68, iouThreshold);
    });
    if (!duplicate) selected.push(box);
  }
  return selected;
}

export function processOutput(
  outputData: Float32Array,
  confidenceThreshold: number,
  iouThreshold: number,
  ratio: number = 1.0,
  padW: number = 0,
  padH: number = 0,
  origW: number = 640,
  origH: number = 640
): BoundingBox[] {
  const numClasses = 80;
  const numAnchors = 8400;
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(origW) || !Number.isFinite(origH) ||
      origW <= 0 || origH <= 0 || outputData.length < (4 + numClasses) * numAnchors) {
    return [];
  }
  const allowedClasses = [0, 1, 2, 3, 5, 7];
  const boxes: BoundingBox[] = [];

  for (let i = 0; i < numAnchors; i++) {
    let maxProb = 0;
    let maxClassId = -1;

    for (let c = 0; c < numClasses; c++) {
      const prob = outputData[(4 + c) * numAnchors + i];
      if (prob > maxProb) {
        maxProb = prob;
        maxClassId = c;
      }
    }

    // The selected detection profile sets the confidence threshold. The
    // classifier should not silently hard-code a higher threshold for people.
    const minConf = confidenceThreshold;
    if (maxProb >= minConf && allowedClasses.includes(maxClassId)) {
      const cx = outputData[0 * numAnchors + i];
      const cy = outputData[1 * numAnchors + i];
      const w = outputData[2 * numAnchors + i];
      const h = outputData[3 * numAnchors + i];

      // Reject center coordinates outside model image boundary
      if (cx < 0 || cx > 640 || cy < 0 || cy > 640) {
        continue;
      }

      // Unletterbox the *corners*, then clip the rectangle to the visible
      // video. Clamping only the centre independently from width/height
      // caused boxes to extend outside the source frame near the edges.
      const left = Math.max(0, Math.min(origW, ((cx - w / 2) - padW) / ratio));
      const top = Math.max(0, Math.min(origH, ((cy - h / 2) - padH) / ratio));
      const right = Math.max(0, Math.min(origW, ((cx + w / 2) - padW) / ratio));
      const bottom = Math.max(0, Math.min(origH, ((cy + h / 2) - padH) / ratio));

      // Keep small/distant motorcycles; reject only invalid or degenerate
      // geometry, not arbitrary road position, class, or aspect-ratio rules.
      if (![left, top, right, bottom].every(Number.isFinite) ||
          right - left < 3 || bottom - top < 3) {
        continue;
      }

      boxes.push({
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        w: right - left,
        h: bottom - top,
        prob: maxProb,
        classId: maxClassId,
        className: LABELS[maxClassId],
      });
    }
  }

  return nonMaxSuppression(boxes, iouThreshold);
}
