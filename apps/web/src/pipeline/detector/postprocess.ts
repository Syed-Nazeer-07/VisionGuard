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
      if (iou(box, selectedBox) > iouThreshold) {
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
