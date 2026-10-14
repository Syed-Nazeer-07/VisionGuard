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

export function nonMaxSuppression(boxes: BoundingBox[], iouThreshold: number): BoundingBox[] {
  boxes.sort((a, b) => b.prob - a.prob);

  const selected: BoundingBox[] = [];

  for (const box of boxes) {
    let shouldSelect = true;
    for (const selectedBox of selected) {
      // 1. Same class or 4-wheeler vehicle group (car, bus, truck) or 2-wheeler group (bicycle, motorcycle)
      const sameGroup = box.classId === selectedBox.classId ||
        ((box.classId === 2 || box.classId === 5 || box.classId === 7) &&
         (selectedBox.classId === 2 || selectedBox.classId === 5 || selectedBox.classId === 7)) ||
        ((box.classId === 1 || box.classId === 3) &&
         (selectedBox.classId === 1 || selectedBox.classId === 3));

      if (sameGroup) {
        // Standard IoU suppression
        if (iou(box, selectedBox) > iouThreshold) {
          shouldSelect = false;
          break;
        }
        // Sub-box containment suppression: if smaller box is largely inside larger vehicle (IoM >= 0.55),
        // suppress the redundant sub-box (e.g. windshield, cab, roof, trailer)
        if (iom(box, selectedBox) >= 0.55) {
          shouldSelect = false;
          break;
        }
      } else if (box.classId === 0 && (selectedBox.classId === 1 || selectedBox.classId === 3)) {
        // Person rider overlapping two-wheeler (motorcycle or bicycle):
        // If person heavily overlaps two-wheeler (IoM >= 0.40 or IoU >= 0.20),
        // suppress the redundant person box so the two-wheeler entity represents vehicle+rider
        if (iom(box, selectedBox) >= 0.40 || iou(box, selectedBox) >= 0.20) {
          shouldSelect = false;
          break;
        }
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
  iouThreshold: number,
  ratio: number = 1.0,
  padW: number = 0,
  padH: number = 0,
  origW: number = 640,
  origH: number = 640
): BoundingBox[] {
  const numClasses = 80;
  const numAnchors = 8400;
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

    // Class-specific confidence: person requires at least 0.38 (rejects roadside bollards, signposts, and shadows)
    const minConf = (maxClassId === 0) ? Math.max(confidenceThreshold, 0.38) : confidenceThreshold;
    if (maxProb >= minConf && allowedClasses.includes(maxClassId)) {
      const cx = outputData[0 * numAnchors + i];
      const cy = outputData[1 * numAnchors + i];
      const w = outputData[2 * numAnchors + i];
      const h = outputData[3 * numAnchors + i];

      // Reject center coordinates outside model image boundary
      if (cx < 0 || cx > 640 || cy < 0 || cy > 640) {
        continue;
      }

      // Convert once from model space to source video pixel coordinates
      const srcCx = Math.max(0, Math.min(origW, (cx - padW) / ratio));
      const srcCy = Math.max(0, Math.min(origH, (cy - padH) / ratio));
      const srcW = Math.max(1, Math.min(origW, w / ratio));
      const srcH = Math.max(1, Math.min(origH, h / ratio));

      // Discard implausibly large bounding boxes covering majority of the frame
      if (srcW > origW * 0.85 || srcH > origH * 0.85) {
        continue;
      }

      // Discard tiny noise artifacts
      if (srcW < 8 || srcH < 8) {
        continue;
      }

      // Conservative geometric plausibility check:
      if (maxClassId === 0) {
        // Pedestrians: reject stationary vertical roadside poles, bollards, and signposts
        const aspect = srcH / Math.max(1, srcW);
        if (aspect > 3.2 || aspect < 1.1 || (srcW < 14 && aspect > 2.5) || (aspect > 2.8 && maxProb < 0.50)) {
          continue;
        }
        if (srcH < 18) {
          continue;
        }
      } else {
        // Vehicles: reject road markings, crosswalk stripes, guardrail lines, and lane dividers
        const aspect = srcW / Math.max(1, srcH);
        if (aspect > 4.0 || aspect < 0.25 || srcW < 12 || srcH < 12) {
          continue;
        }
        // Perspective road artifact rejection:
        // Road markings, lane dashes, and circular manhole covers in the lower road foreground (cy > 0.60 * origH)
        // cannot be smaller than 65px tall in perspective unless clipped at the image edge.
        if (srcCy > origH * 0.60 && srcH < 65 && (srcCy + srcH * 0.5 < origH - 15)) {
          continue;
        }
      }

      boxes.push({
        x: srcCx,
        y: srcCy,
        w: srcW,
        h: srcH,
        prob: maxProb,
        classId: maxClassId,
        className: LABELS[maxClassId],
      });
    }
  }

  return nonMaxSuppression(boxes, iouThreshold);
}
