import type { BoundingBox } from '../types';
import { LABELS } from './labels';

export const VEHICLE_CLASS_IDS = new Set([1, 2, 3, 5, 6, 7]);
const NUM_CLASSES = 80;
const ANCHORS = 8400;
// Do not change thresholds for cars, buses or trucks while recovering tiny bikes.
const MOTORCYCLE_CONFIDENCE = 0.28;
const BICYCLE_CONFIDENCE = 0.33;

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
    let best = -Infinity;
    let topClass = -1;
    let topScore = -Infinity;
    // Motorcycle and bicycle only: permit lower-confidence two-wheelers.
    // This preserves the original car, bus and truck confidence behaviour.
    for (let c = 0; c < NUM_CLASSES; c++) {
      const confidence = data[(4 + c) * ANCHORS + i];
      if (!Number.isFinite(confidence)) continue;
      if (confidence > topScore) { topScore = confidence; topClass = c; }
      if (VEHICLE_CLASS_IDS.has(c) && confidence > best) {
        best = confidence;
        bestClass = c;
      }
    }
    if (bestClass < 0) continue;
    const required = bestClass === 3 ? MOTORCYCLE_CONFIDENCE :
      bestClass === 1 ? BICYCLE_CONFIDENCE : minimumConfidence;
    if (best < required) continue;
    // Don't turn pedestrians into motorcycles. Permit ambiguity with a rider
    // only when the two-wheeler score closely competes with the person score.
    if (topClass !== bestClass) {
      const riderOverlap = (bestClass === 3 || bestClass === 1) && topClass === 0 &&
        topScore <= best * 1.12 && best >= 0.37;
      if (!riderOverlap) continue;
    }
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
    const isTwoWheeler = bestClass === 1 || bestClass === 3;
    const minimumSize = isTwoWheeler ? 5 : 9;
    if (w < minimumSize || h < minimumSize || w > originalWidth * 0.93 ||
        h > originalHeight * 0.93) continue;
    const aspect = w / h;
    if (aspect < (isTwoWheeler ? 0.12 : 0.18) ||
        aspect > (isTwoWheeler ? 9 : 7)) continue;

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

/**
 * Narrow visual safeguard for a long tractor/trailer wrongly classified BUS.
 * A truck with a bright neutral cargo box and a distinctly coloured/darker
 * short cab has a strong discontinuity along its length. This operates ONLY
 * on detections already labeled BUS and leaves motorcycles, cars and genuine
 * buses without that evidence unchanged.
 *
 * This is a conservative appearance heuristic, not a second classifier.
 * Don't convert an ambiguous vehicle just because it looks elongated.
 */
export function correctClearFreightTrailer(
  detections: BoundingBox[],
  chw: Float32Array,
  ratio: number,
  padW: number,
  padH: number,
): BoundingBox[] {
  const side = 640;
  const area = side * side;
  if (chw.length !== area * 3 || ratio <= 0) return detections;
  function region(
    box: BoundingBox, start: number, end: number, vertical: boolean
  ): { brightness: number; chroma: number } | null {
    let sumBrightness = 0, sumChroma = 0, count = 0;
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        const along = start + (end - start) * (i + .5) / 7;
        const across = .30 + .40 * (j + .5) / 7;
        const srcX = vertical ? box.x - box.w / 2 + across * box.w :
          box.x - box.w / 2 + along * box.w;
        const srcY = vertical ? box.y - box.h / 2 + along * box.h :
          box.y - box.h / 2 + across * box.h;
        const x = Math.round(srcX * ratio + padW);
        const y = Math.round(srcY * ratio + padH);
        if (x < 0 || x >= side || y < 0 || y >= side) return null;
        const pixel = y * side + x;
        const red = chw[pixel], green = chw[area + pixel], blue = chw[2 * area + pixel];
        sumBrightness += (red + green + blue) / 3;
        sumChroma += Math.max(red, green, blue) - Math.min(red, green, blue);
        count++;
      }
    }
    return { brightness: sumBrightness / count, chroma: sumChroma / count };
  }

  return detections.map(box => {
    if (box.classId !== 5) return box;
    const portrait = box.h >= box.w * 1.6;
    const landscape = box.w >= box.h * 1.6;
    if (!portrait && !landscape) return box;
    if (Math.max(box.w, box.h) * ratio < 70) return box;
    const near = region(box, .12, .38, portrait);
    const far = region(box, .59, .87, portrait);
    if (!near || !far) return box;
    const separated = (cargo: typeof near, cab: typeof far) =>
      cargo.brightness > .68 && cargo.chroma < .13 &&
      cab.brightness < cargo.brightness - .19 && cab.chroma > .18;
    if (!separated(near, far) && !separated(far, near)) return box;
    return { ...box, classId: 7, className: 'truck' };
  });
}
