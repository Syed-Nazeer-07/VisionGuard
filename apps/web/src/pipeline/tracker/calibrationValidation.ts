import type { CalibrationData, Point } from '../types';

/** A four-corner ground-plane reference MUST be surveyed, not guessed. */
export function validateVideoCalibration(data: CalibrationData): string | null {
  if (![data.referenceWidth, data.referenceHeight, data.speedLimit, data.tolerance]
    .every(Number.isFinite)) return 'Calibration dimensions and speed settings must be finite.';
  if (data.referenceWidth <= 0 || data.referenceHeight <= 0 ||
      data.referenceWidth > 1000 || data.referenceHeight > 1000) {
    return 'Enter measured reference width and length in metres (0–1000 m).';
  }
  if (data.speedLimit <= 0 || data.speedLimit > 250 || data.tolerance < 0 || data.tolerance > 100) {
    return 'Enter an appropriate speed limit and non-negative tolerance in km/h.';
  }
  const points = data.calibrationArea;
  if (!Array.isArray(points) || points.length !== 4) return 'Select exactly four corners in the displayed order.';
  if (points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
    p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return 'Ground-plane points must be within the video frame.';
  // A convex quadrilateral in TL→TR→BR→BL order: avoid crossing
  // lines or nearly collinear points that create an unstable homography.
  const turns: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = points[i], b = points[(i + 1) % 4], c = points[(i + 2) % 4];
    turns.push((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
  }
  if (turns.some(t => t <= 0.0001)) return 'Corners must form a non-crossing quadrilateral in top-left → top-right → bottom-right → bottom-left order.';
  const area = Math.abs(points.reduce((a, p, i) => {
    const n = points[(i + 1) % 4];
    return a + p.x * n.y - n.x * p.y;
  }, 0)) / 2;
  if (area < 0.001) return 'Ground-plane area is too small for stable calibration.';
  return null;
}

export function videoPointFromDisplay(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  video: { videoWidth: number; videoHeight: number },
  fit: 'contain' | 'cover' = 'contain'
): Point | null {
  const { videoWidth, videoHeight } = video;
  if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height, videoWidth, videoHeight]
    .every(Number.isFinite) || videoWidth <= 0 || videoHeight <= 0 || rect.width <= 0 || rect.height <= 0) return null;
  const scale = fit === 'cover'
    ? Math.max(rect.width / videoWidth, rect.height / videoHeight)
    : Math.min(rect.width / videoWidth, rect.height / videoHeight);
  const xOffset = (rect.width - videoWidth * scale) / 2;
  const yOffset = (rect.height - videoHeight * scale) / 2;
  const x = (clientX - rect.left - xOffset) / (videoWidth * scale);
  const y = (clientY - rect.top - yOffset) / (videoHeight * scale);
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y };
}

export function videoPointToDisplay(
  point: Point,
  container: { width: number; height: number },
  video: { videoWidth: number; videoHeight: number },
  fit: 'contain' | 'cover' = 'contain'
): { x: number; y: number } {
  const { videoWidth, videoHeight } = video;
  const scale = fit === 'cover'
    ? Math.max(container.width / videoWidth, container.height / videoHeight)
    : Math.min(container.width / videoWidth, container.height / videoHeight);
  const offsetX = (container.width - videoWidth * scale) / 2;
  const offsetY = (container.height - videoHeight * scale) / 2;
  return {
    x: point.x * videoWidth * scale + offsetX,
    y: point.y * videoHeight * scale + offsetY
  };
}
