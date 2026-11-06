import type { BoundingBox } from '../types';
import { LABELS } from './labels';

export const VEHICLE_CLASS_IDS = new Set([1, 2, 3, 5, 6, 7]);
const NUM_CLASSES = 80;
const ANCHORS = 8400;

function groupOf(classId: number): number {
  return classId === 2 || classId === 5 || classId === 7 ? 2 : classId;
}

function overlap(box: BoundingBox, other: BoundingBox) {
  const ix1 = Math.max(box.x - box.w / 2, other.x - other.w / 2);
  const iy1 = Math.max(box.y - box.h / 2, other.y - other.h / 2);
  const ix2 = Math.min(box.x + box.w / 2, other.x + other.w / 2);
  const iy2 = Math.min(box.y + box.h / 2, other.y + other.h / 2);
  const intersection = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const area1 = box.w * box.h;
  const area2 = other.w * other.h;
  return {
    iou: intersection / Math.max(1, area1 + area2 - intersection),
    containment: intersection / Math.max(1, Math.min(area1, area2))
  };
}

/**
 * YOLO11 COCO detection tensor [1,84,8400] (no objectness column).
 * Geometry is returned in ORIGINAL SOURCE VIDEO PIXELS, not model or display
 * coordinates. This is essential for accurate boxes on resized captures.
 */
export function decodeTrafficVehicles(
  data: Float32Array,
  originalWidth: number,
  originalHeight: number,
  ratio: number,
  padW: number,
  padH: number,
  minimumConfidence = 0.43,
): BoundingBox[] {
  if (data.length !== 84 * ANCHORS || ratio <= 0 ||
      originalWidth <= 0 || originalHeight <= 0) {
    throw new Error('Expected YOLO11 COCO output [1,84,8400] and valid letterbox metadata.');
  }
  const candidates: BoundingBox[] = [];
  for (let i = 0; i < ANCHORS; i++) {
    let bestClass = -1;
    let best = minimumConfidence;
    for (let c = 0; c < NUM_CLASSES; c++) {
      const confidence = data[(4 + c) * ANCHORS + i];
      if (confidence > best) {
        best = confidence;
        bestClass = c;
      }
    }
    if (!VEHICLE_CLASS_IDS.has(bestClass)) continue;
    const centerX = data[i];
    const centerY = data[ANCHORS + i];
    const width = data[2 * ANCHORS + i];
    const height = data[3 * ANCHORS + i];
    if (![centerX, centerY, width, height].every(Number.isFinite)) continue;
    if (width <= 0 || height <= 0) continue;
    // Undo the EXACT letterbox transform and clip to the physical video image.
    const x1 = Math.max(0, (centerX - width / 2 - padW) / ratio);
    const y1 = Math.max(0, (centerY - height / 2 - padH) / ratio);
    const x2 = Math.min(originalWidth, (centerX + width / 2 - padW) / ratio);
    const y2 = Math.min(originalHeight, (centerY + height / 2 - padH) / ratio);
    const w = x2 - x1;
    const h = y2 - y1;
    if (w < 9 || h < 9 || w > originalWidth * 0.93 || h > originalHeight * 0.93) continue;
    const aspect = w / h;
    if (aspect < 0.18 || aspect > 7) continue;

    candidates.push({
      x: (x1 + x2) / 2, y: (y1 + y2) / 2,
      w, h, prob: best, classId: bestClass, className: LABELS[bestClass]
    });
  }
  // Keep strongest candidates and suppress repeated car/bus/truck boxes.
  candidates.sort((a, b) => b.prob - a.prob);
  const selected: BoundingBox[] = [];
  for (const candidate of candidates.slice(0, 200)) {
    if (selected.some(existing => {
      if (groupOf(existing.classId) !== groupOf(candidate.classId)) return false;
      const o = overlap(candidate, existing);
      return o.iou >= 0.43 || o.containment >= 0.82;
    })) continue;
    selected.push(candidate);
    if (selected.length >= 80) break;
  }
  return selected;
}
