import type { PlateDetection } from './types';
import type { TrackedObject } from '../types';

export function detectPlateRegion(track: TrackedObject): PlateDetection | null {
  // Since we don't have a dedicated LPR model loaded in this milestone,
  // we use a heuristic to estimate the plate region within the vehicle bounding box.
  // Assuming the plate is generally in the lower center of the vehicle.
  
  if (track.className !== 'car' && track.className !== 'truck' && track.className !== 'bus' && track.className !== 'motorcycle') {
    return null;
  }

  // Plate width ~ 30% of vehicle width, height ~ 15% of vehicle height
  const pw = track.w * 0.3;
  const ph = track.h * 0.15;
  // track.x and track.y are the CENTER coordinates of the vehicle
  const px = track.x - (pw / 2);
  const py = track.y + (track.h / 2) - ph - (track.h * 0.05); // near the vehicle bottom

  return {
    x: px,
    y: py,
    w: pw,
    h: ph,
    confidence: 0.85 // Heuristic confidence
  };
}
