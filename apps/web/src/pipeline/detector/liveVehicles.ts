import type { BoundingBox } from '../types';
import { LABELS } from './labels';

const VEHICLE_CLASSES = [1, 2, 3, 5, 6, 7];
export const VEHICLE_CLASS_IDS = new Set(VEHICLE_CLASSES);
const NUM_CLASSES = 80;
const ANCHORS = 8400;
// Do not change thresholds for cars, buses or trucks while recovering tiny bikes.
const MOTORCYCLE_CONFIDENCE = 0.28;
const BICYCLE_CONFIDENCE = 0.33;

export const YOLO_INPUT_SIZE = 640;
export const YOLO_INPUT_SHAPE = [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE] as const;
export const YOLO_OUTPUT_SHAPE = [1, 4 + NUM_CLASSES, ANCHORS] as const;

type TensorMetadata = {
  isTensor: boolean;
  type?: string;
  shape?: readonly (number | string)[];
};

export function matchesYoloTensor(metadata: TensorMetadata, expected: readonly number[]): boolean {
  const shape = metadata.shape;
  return metadata.isTensor && metadata.type === 'float32' &&
    shape?.length === expected.length && expected.every((size, index) => shape[index] === size);
}

export function trafficLetterbox(sourceWidth: number, sourceHeight: number) {
  if (![sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Expected positive source video dimensions.');
  }
  const ratio = YOLO_INPUT_SIZE / Math.max(sourceWidth, sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * ratio));
  const height = Math.max(1, Math.round(sourceHeight * ratio));
  return {
    width, height, sourceWidth, sourceHeight,
    scaleX: width / sourceWidth, scaleY: height / sourceHeight,
    left: Math.floor((YOLO_INPUT_SIZE - width) / 2),
    top: Math.floor((YOLO_INPUT_SIZE - height) / 2)
  };
}

function isTwoWheeler(classId: number) {
  return classId === 1 || classId === 3;
}

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
  transform: ReturnType<typeof trafficLetterbox>,
): BoundingBox[] {
  if (data.length !== YOLO_OUTPUT_SHAPE[1] * ANCHORS) {
    throw new Error('Expected YOLO11 COCO output [1,84,8400].');
  }
  const { sourceWidth, sourceHeight, scaleX, scaleY, left, top } = transform;
  const candidates: BoundingBox[] = [];
  for (let i = 0; i < ANCHORS; i++) {
    let bestClass = -1;
    let best = -Infinity;
    // Reject anchors below all vehicle thresholds before reading the other
    // 74 class planes. A passing anchor keeps the original all-class veto.
    for (const c of VEHICLE_CLASSES) {
      const confidence = data[(4 + c) * ANCHORS + i];
      if (Number.isFinite(confidence) && confidence > best) {
        best = confidence;
        bestClass = c;
      }
    }
    if (bestClass < 0) continue;
    const required = bestClass === 3 ? MOTORCYCLE_CONFIDENCE :
      bestClass === 1 ? BICYCLE_CONFIDENCE : 0.43;
    if (best < required) continue;
    let topClass = bestClass;
    let topScore = best;
    for (let c = 0; c < NUM_CLASSES; c++) {
      const confidence = data[(4 + c) * ANCHORS + i];
      if (Number.isFinite(confidence) &&
          (confidence > topScore || confidence === topScore && c < topClass)) {
        topScore = confidence;
        topClass = c;
      }
    }
    // Don't turn pedestrians into motorcycles. Permit ambiguity with a rider
    // only when the two-wheeler score closely competes with the person score.
    if (topClass !== bestClass) {
      // Riders can score higher as PERSON than as MOTORCYCLE.
      // Never accept a very weak two-wheeler logit on a clear pedestrian.
      const riderOverlap = (bestClass === 3 || bestClass === 1) && topClass === 0 &&
        best >= 0.36 && best >= topScore * 0.48;
      if (!riderOverlap) continue;
    }
    const centerX = data[i];
    const centerY = data[ANCHORS + i];
    const width = data[2 * ANCHORS + i];
    const height = data[3 * ANCHORS + i];
    if (![centerX, centerY, width, height].every(Number.isFinite)) continue;
    if (width <= 0 || height <= 0) continue;
    // Undo the EXACT letterbox transform and clip to the physical video image.
    const x1 = Math.max(0, (centerX - width / 2 - left) / scaleX);
    const y1 = Math.max(0, (centerY - height / 2 - top) / scaleY);
    const x2 = Math.min(sourceWidth, (centerX + width / 2 - left) / scaleX);
    const y2 = Math.min(sourceHeight, (centerY + height / 2 - top) / scaleY);
    const w = x2 - x1;
    const h = y2 - y1;
    const smallVehicle = isTwoWheeler(bestClass);
    const minimumSize = smallVehicle ? 5 : 9;
    if (w < minimumSize || h < minimumSize || w > sourceWidth * 0.93 ||
        h > sourceHeight * 0.93) continue;
    const aspect = w / h;
    if (aspect < (smallVehicle ? 0.12 : 0.18) ||
        aspect > (smallVehicle ? 9 : 7)) continue;

    candidates.push({
      x: (x1 + x2) / 2, y: (y1 + y2) / 2,
      w, h, prob: best, classId: bestClass, className: LABELS[bestClass],
      classScores: (bestClass === 5 || bestClass === 7)
        ? { bus: data[(4 + 5) * ANCHORS + i], truck: data[(4 + 7) * ANCHORS + i] }
        : undefined
    });
  }
  // Most anchors around large vehicles overlap. A global top-200 cutoff
  // can spend its entire budget on repeated car boxes before NMS even sees
  // smaller motorcycles. Preserve the original top-200 vehicle budget, but
  // also consider the strongest 80 two-wheelers without lowering thresholds.
  candidates.sort((a, b) => b.prob - a.prob);
  const selected: BoundingBox[] = [];
  let rankedTwoWheelers = 0;
  for (const [index, candidate] of candidates.entries()) {
    const inTwoWheelerBudget = isTwoWheeler(candidate.classId) && ++rankedTwoWheelers <= 80;
    if (index >= 200 && !inTwoWheelerBudget) continue;
    if (selected.some(existing => {
      const sameGroup = groupOf(existing.classId) === groupOf(candidate.classId);
      const competingTwoWheelers = isTwoWheeler(existing.classId) && isTwoWheeler(candidate.classId);
      if (!sameGroup && !competingTwoWheelers) return false;
      const o = overlap(candidate, existing);
      // Distinct bicycles and motorcycles often overlap in traffic. Suppress
      // cross-class duplicates only when the two geometries closely agree.
      return sameGroup ? o.iou >= 0.43 || o.containment >= 0.82 : o.iou >= 0.72;
    })) continue;
    selected.push(candidate);
    if (selected.length >= 80) break;
  }
  return selected;
}
