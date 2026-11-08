import { hasExitedVideoFrame, type LiveTrack } from './liveProjection';

export interface GrayFrame {
  time: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  pixels: Uint8Array;
}

/** Small preview of a decoded video frame. No seeking or file copy. */
export function takeGrayFrame(
  video: HTMLVideoElement,
  time: number,
  canvas: HTMLCanvasElement
): GrayFrame | null {
  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(time)) return null;
  // 448px preserves distant motorcycles that become <7 pixels at 320px.
  const width = 448;
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const j = i * 4;
    pixels[i] = ((77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2]) >>> 8);
  }
  return { time, width, height, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight, pixels };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

type MotionMatch = { dx: number; dy: number; error: number };

function matchFeature(
  previous: GrayFrame,
  current: GrayFrame,
  x: number,
  y: number,
  predictedDx: number,
  predictedDy: number,
  search: number,
  patchRadius: number,
  minTexture = 24,
  maxError = 26,
): MotionMatch | null {
  const width = previous.width;
  const height = previous.height;
  const left = Math.round(x);
  const top = Math.round(y);
  if (left - patchRadius < 0 || top - patchRadius < 0 ||
      left + patchRadius >= width || top + patchRadius >= height) return null;

  // Ignore plain asphalt, blank car roofs and repetitive low-detail regions.
  let min = 255;
  let max = 0;
  for (let py = -patchRadius; py <= patchRadius; py += 2) {
    for (let px = -patchRadius; px <= patchRadius; px += 2) {
      const value = previous.pixels[(top + py) * width + left + px];
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (max - min < minTexture) return null;

  let best = Infinity;
  let bestDx = 0;
  let bestDy = 0;
  const cx = Math.round(predictedDx);
  const cy = Math.round(predictedDy);
  const radius = Math.min(13, search);

  for (let dy = cy - radius; dy <= cy + radius; dy++) {
    const ty = top + dy;
    if (ty - patchRadius < 0 || ty + patchRadius >= height) continue;
    for (let dx = cx - radius; dx <= cx + radius; dx++) {
      const tx = left + dx;
      if (tx - patchRadius < 0 || tx + patchRadius >= width) continue;
      let sum = 0;
      let count = 0;
      for (let py = -patchRadius; py <= patchRadius; py += 2) {
        const rowOld = (top + py) * width;
        const rowNew = (ty + py) * width;
        for (let px = -patchRadius; px <= patchRadius; px += 2) {
          sum += Math.abs(
            previous.pixels[rowOld + left + px] -
            current.pixels[rowNew + tx + px]
          );
          count++;
        }
      }
      const error = sum / count;
      if (error < best) {
        best = error;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  if (best > maxError || !Number.isFinite(best)) return null;
  return { dx: bestDx, dy: bestDy, error: best };
}

/**
 * Conservative feature voting. Matching ONE car-center patch to road texture
 * caused massive box jumps in the recording; require a consensus of several
 * features inside each vehicle instead.
 */
export function advanceOpticalTracks<T extends LiveTrack>(
  tracks: readonly T[],
  previous: GrayFrame,
  current: GrayFrame
): T[] {
  const dt = current.time - previous.time;
  if (dt <= 0 || dt > 0.32 ||
      previous.width !== current.width || previous.height !== current.height ||
      previous.sourceWidth !== current.sourceWidth ||
      previous.sourceHeight !== current.sourceHeight) return [];

  const sx = previous.width / previous.sourceWidth;
  const sy = previous.height / previous.sourceHeight;
  const output: T[] = [];
  const featureOffsets = [
    [0, 0], [-.19, -.19], [.19, -.19], [-.19, .19], [.19, .19],
    [0, -.24], [0, .24]
  ];

  for (const track of tracks) {
    // A predicted-only bridge has no new visual evidence. Matching its box
    // against the following frame can lock onto road texture and create a
    // self-sustaining ghost vehicle. Only fresh YOLO can reacquire it.
    if (track.isPredicted) continue;
    const minConf = track.className === 'motorcycle' ? .28 :
      track.className === 'bicycle' ? .33 : .42;
    if (track.w < 4 || track.h < 4 || track.confidence < minConf) continue;
    const centerX = track.x * sx;
    const centerY = track.y * sy;
    const isSmallTwoWheeler = track.className === 'motorcycle' || track.className === 'bicycle';
    // Higher-resolution thumbnails allow small two-wheelers to remain trackable.
    // Keep strict criteria on ordinary cars and trucks to avoid regressions.
    const smallest = isSmallTwoWheeler ? 4.5 : 6;
    if (track.w * sx < smallest || track.h * sy < smallest) continue;

    const predictX = Math.max(-15, Math.min(15, track.vx * sx * dt));
    const predictY = Math.max(-15, Math.min(15, track.vy * sy * dt));
    const patchRadius = Math.max(2, Math.min(4, Math.floor(Math.min(track.w * sx, track.h * sy) / 5)));
    const search = Math.max(5, Math.min(12, Math.ceil(5 + dt * 45)));
    const features: MotionMatch[] = [];

    for (const [ox, oy] of featureOffsets) {
      const x = centerX + track.w * sx * ox;
      const y = centerY + track.h * sy * oy;
      const match = matchFeature(
        previous, current, x, y, predictX, predictY, search, patchRadius,
        isSmallTwoWheeler ? 16 : 24, isSmallTwoWheeler ? 24 : 26
      );
      if (match) features.push(match);
    }
    if (features.length < 2 && !(isSmallTwoWheeler && features.length === 1 && features[0].error < 8)) continue;
    const dx = median(features.map(f => f.dx));
    const dy = median(features.map(f => f.dy));
    const consistent = features.filter(f => Math.abs(f.dx - dx) <= 2 &&
      Math.abs(f.dy - dy) <= 2 && f.error <= (isSmallTwoWheeler ? 24 : 26));

    // Reject boxes when neighboring features disagree: almost always
    // background slip, occlusion or a car leaving the picture.
    if (consistent.length < 2 && !(isSmallTwoWheeler && consistent.length === 1 && consistent[0].error < 8)) continue;
    if (consistent.length < Math.ceil(features.length * .5)) continue;
    const measuredDx = median(consistent.map(f => f.dx));
    const measuredDy = median(consistent.map(f => f.dy));
    // If a previously moving vehicle suddenly produces motionless patches,
    // those patches commonly belong to the road underneath a drifting box.
    // Accept zero motion for legitimately stationary/slow tracks; only reject
    // the contradiction when the expected image movement is unambiguous.
    const expectedPixels = Math.hypot(predictX, predictY);
    const measuredPixels = Math.hypot(measuredDx, measuredDy);
    if (expectedPixels >= 3.5 && measuredPixels <= 1 &&
        measuredPixels < expectedPixels * .30) continue;
    // A large backwards optical jump against a strong recent trajectory is
    // more likely an accidental nearby texture match than a vehicle reversal.
    if (expectedPixels >= 4 && measuredPixels >= 2 &&
        (measuredDx * predictX + measuredDy * predictY) <
          -.4 * expectedPixels * measuredPixels) continue;
    const moveX = measuredDx / sx;
    const moveY = measuredDy / sy;
    const newX = track.x + moveX;
    const newY = track.y + moveY;

    const x1 = newX - track.w / 2, y1 = newY - track.h / 2;
    const x2 = newX + track.w / 2, y2 = newY + track.h / 2;
    const visibleW = Math.max(0, Math.min(x2, current.sourceWidth) - Math.max(0, x1));
    const visibleH = Math.max(0, Math.min(y2, current.sourceHeight) - Math.max(0, y1));
    // A 30% remnant frequently tracked the road after a vehicle left.
    if (visibleW * visibleH < track.w * track.h * .60) continue;

    const instantaneousX = moveX / dt;
    const instantaneousY = moveY / dt;
    // Avoid huge velocity spikes after one ambiguous motion update.
    const maxPhysical = Math.max(80, Math.max(track.w, track.h) * 10);
    if (Math.hypot(instantaneousX, instantaneousY) > maxPhysical) continue;
    const vx = track.vx * .6 + instantaneousX * .4;
    const vy = track.vy * .6 + instantaneousY * .4;
    const moved = {
      ...track, x: newX, y: newY,
      vx, vy, motionPxPerSec: Math.hypot(vx, vy)
    } as T;
    if (hasExitedVideoFrame(moved, current.sourceWidth, current.sourceHeight)) continue;
    output.push(moved);
  }
  return output;
}
