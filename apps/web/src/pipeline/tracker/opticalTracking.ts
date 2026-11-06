import type { LiveTrack } from './liveProjection';

/**
 * Low-resolution grayscale snapshots of the frame actually displayed by the
 * browser. This is inexpensive compared to ONNX inference and doesn't pause
 * or seek the HTML video.
 */
export interface GrayFrame {
  time: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  pixels: Uint8Array;
}

export function takeGrayFrame(
  video: HTMLVideoElement,
  time: number,
  canvas: HTMLCanvasElement
): GrayFrame | null {
  const width = 320;
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(time)) return null;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const pos = i * 4;
    pixels[i] = ((77 * rgba[pos] + 150 * rgba[pos + 1] + 29 * rgba[pos + 2]) >>> 8);
  }
  return { time, width, height, sourceWidth: video.videoWidth, sourceHeight: video.videoHeight, pixels };
}

function difference(
  oldFrame: GrayFrame, newFrame: GrayFrame,
  x: number, y: number, nx: number, ny: number,
  radiusX: number, radiusY: number
): number {
  let sum = 0;
  let count = 0;
  const dx = Math.max(1, Math.floor(radiusX / 4));
  const dy = Math.max(1, Math.floor(radiusY / 4));
  for (let ry = -radiusY; ry <= radiusY; ry += dy) {
    for (let rx = -radiusX; rx <= radiusX; rx += dx) {
      const ox = x + rx; const oy = y + ry;
      const tx = nx + rx; const ty = ny + ry;
      if (ox < 0 || oy < 0 || ox >= oldFrame.width || oy >= oldFrame.height ||
          tx < 0 || ty < 0 || tx >= newFrame.width || ty >= newFrame.height) return Infinity;
      sum += Math.abs(oldFrame.pixels[oy * oldFrame.width + ox] -
        newFrame.pixels[ty * newFrame.width + tx]);
      count++;
    }
  }
  return count ? sum / count : Infinity;
}

/**
 * Propagate real detection boxes through successive displayed video frames.
 * The small patch-matching tracker maintains alignment while WASM is busy
 * running the next YOLO inference. If the appearance no longer matches, the
 * vehicle disappears immediately instead of leaving a floating ghost.
 */
export function advanceOpticalTracks(
  tracks: readonly LiveTrack[], previous: GrayFrame, current: GrayFrame
): LiveTrack[] {
  const dt = current.time - previous.time;
  if (dt <= 0 || dt > 0.35 ||
      previous.width !== current.width || previous.height !== current.height ||
      previous.sourceWidth !== current.sourceWidth ||
      previous.sourceHeight !== current.sourceHeight) return [];

  const scaleX = previous.width / previous.sourceWidth;
  const scaleY = previous.height / previous.sourceHeight;
  const maxSearch = Math.max(5, Math.min(22, Math.ceil(100 * dt)));
  const output: LiveTrack[] = [];

  for (const track of tracks) {
    const x = Math.round(track.x * scaleX);
    const y = Math.round(track.y * scaleY);
    const radiusX = Math.max(2, Math.min(14, Math.round(track.w * scaleX * .25)));
    const radiusY = Math.max(2, Math.min(12, Math.round(track.h * scaleY * .25)));
    if (x - radiusX < 0 || x + radiusX >= previous.width ||
        y - radiusY < 0 || y + radiusY >= previous.height) continue;

    // Prediction centers the search close to the most recently observed motion.
    const predX = Math.max(-maxSearch, Math.min(maxSearch, Math.round(track.vx * scaleX * dt)));
    const predY = Math.max(-maxSearch, Math.min(maxSearch, Math.round(track.vy * scaleY * dt)));
    let bestScore = Infinity;
    let bestX = x;
    let bestY = y;
    // Search every thumbnail pixel. A two-pixel stride skipped the true
    // translation for odd search radii and latched onto repetitive road
    // textures instead, causing visibly misaligned boxes.
    for (let dy = -maxSearch; dy <= maxSearch; dy += 1) {
      for (let dx = -maxSearch; dx <= maxSearch; dx += 1) {
        const nx = x + predX + dx;
        const ny = y + predY + dy;
        const score = difference(previous, current, x, y, nx, ny, radiusX, radiusY);
        if (score < bestScore) { bestScore = score; bestX = nx; bestY = ny; }
      }
    }
    // Bad/ambiguous template match: safer to hide than to show a wrong box.
    if (bestScore > 34 || !Number.isFinite(bestScore)) continue;
    const nextX = bestX / scaleX;
    const nextY = bestY / scaleY;
    const left = nextX - track.w / 2;
    const right = nextX + track.w / 2;
    const top = nextY - track.h / 2;
    const bottom = nextY + track.h / 2;
    const visWidth = Math.max(0, Math.min(right, current.sourceWidth) - Math.max(0, left));
    const visHeight = Math.max(0, Math.min(bottom, current.sourceHeight) - Math.max(0, top));
    if (visWidth * visHeight < track.w * track.h * .25) continue;

    const observedVx = (nextX - track.x) / dt;
    const observedVy = (nextY - track.y) / dt;
    const vx = .35 * track.vx + .65 * observedVx;
    const vy = .35 * track.vy + .65 * observedVy;
    output.push({
      ...track, x: nextX, y: nextY, vx, vy,
      motionPxPerSec: Math.hypot(vx, vy)
    });
  }
  return output;
}
