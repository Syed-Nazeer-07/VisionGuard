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

  return intersection / (area1 + area2 - intersection);
}

export function nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
  boxes.sort((a, b) => b.prob - a.prob);

  const selected: BoundingBox[] = [];

  for (const box of boxes) {
    let shouldSelect = true;
    for (const selectedBox of selected) {
      // Class-aware suppression: only suppress if from the same class or 4-wheeler vehicle group (car, bus, truck)
      // Two-wheelers (bicycle, motorcycle) and persons must NOT suppress each other or vehicles
      const sameGroup = box.classId === selectedBox.classId ||
        ((box.classId === 2 || box.classId === 5 || box.classId === 7) &&
         (selectedBox.classId === 2 || selectedBox.classId === 5 || selectedBox.classId === 7));
      if (sameGroup && iou(box, selectedBox) > iouThreshold) {
        shouldSelect = false;
        break;
      }
    }
    if (shouldSelect) {
      selected.push(box);
    }
  }

  return selected;
}

export function processOutput(
  outputData: Float32Array,
  confidenceThreshold: number,
  iouThreshold: number
): BoundingBox[] {
  const numClasses = 80;
  const numAnchors = 8400;
  let boxes: BoundingBox[] = [];

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

    if (maxProb > confidenceThreshold) {
      const cx = outputData[0 * numAnchors + i];
      const cy = outputData[1 * numAnchors + i];
      const w = outputData[2 * numAnchors + i];
      const h = outputData[3 * numAnchors + i];

      // Conservative geometric plausibility check for class 0 ('person'):
      // Reject stationary vertical roadside poles, bollards, and signposts misclassified as people.
      // Real pedestrians have an aspect ratio (h/w) between 1.2 and ~3.2.
      if (maxClassId === 0) {
        const aspect = h / Math.max(1, w);
        if (aspect > 3.5 || (w < 12 && aspect > 2.8) || (aspect > 3.1 && maxProb < 0.50)) {
          continue;
        }
      }

      boxes.push({
        x: cx,
        y: cy,
        w: w,
        h: h,
        prob: maxProb,
        classId: maxClassId,
        className: LABELS[maxClassId],
      });
    }
  }

  return nonMaxSuppression(boxes, iouThreshold);
}
