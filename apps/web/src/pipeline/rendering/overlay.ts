import type { TrackedObject } from '../types';
import { isOverlayAgeFresh } from '../worker/frameSync';
import { computeVideoTransform, sourceCenterBoxToDisplay } from './transform';

interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function checkCollision(r1: LabelRect, r2: LabelRect): boolean {
  return (
    r1.x < r2.x + r2.w &&
    r1.x + r1.w > r2.x &&
    r1.y < r2.y + r2.h &&
    r1.y + r1.h > r2.y
  );
}

export interface OverlayOptions {
  demoSpeed?: boolean;
}

export function drawBoundingBoxes(
  ctx: CanvasRenderingContext2D,
  tracks: TrackedObject[],
  canvasWidth: number,
  canvasHeight: number,
  videoWidth: number,
  videoHeight: number,
  isCover: boolean = false,
  timeDelta: number = 0,
  _options?: OverlayOptions
): { rendered: number, stale: number } {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  let rendered = 0;
  let stale = 0;

  if (!isOverlayAgeFresh(timeDelta)) {
    return { rendered: 0, stale: tracks.length };
  }

  const transform = computeVideoTransform(
    { videoWidth, videoHeight },
    { containerWidth: canvasWidth, containerHeight: canvasHeight },
    isCover ? 'cover' : 'contain'
  );

  const occupiedLabels: LabelRect[] = [];

  // Sort tracks to establish deterministic visual priority:
  // 1. Overspeeding vehicles (critical alerts)
  // 2. Confirmed tracks before tentative
  // 3. Larger vehicles (closer to camera) before distant ones
  // 4. Higher confidence before lower
  const sortedTracks = [...tracks].sort((a, b) => {
    if (a.isOverspeed !== b.isOverspeed) return a.isOverspeed ? -1 : 1;
    if (a.state !== b.state) return a.state === 'Confirmed' ? -1 : 1;
    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    if (Math.abs(areaA - areaB) > 100) return areaB - areaA;
    return b.prob - a.prob;
  });

  for (const track of sortedTracks) {
    // Only render fresh active tracks; avoid stale predictions drifting onto empty pavement
    if (track.timeSinceUpdate !== undefined && track.timeSinceUpdate > 2) {
      stale++;
      continue;
    }

    // Validate track geometry in source video space
    if (!Number.isFinite(track.x) || !Number.isFinite(track.y) || !Number.isFinite(track.w) || !Number.isFinite(track.h)) {
      continue;
    }
    if (track.w < 6 || track.h < 6) {
      continue;
    }
    // Reject implausibly large bounding boxes covering majority of the frame
    if (track.w > videoWidth * 0.85 || track.h > videoHeight * 0.85) {
      continue;
    }

    const rawClass = (track.className || 'vehicle').toLowerCase();
    const isPerson = rawClass === 'person' || rawClass === 'pedestrian';
    const vehicleType = (track.className || 'vehicle').toUpperCase();

    // Geometric plausibility filter: discard road markings, stripes, and pole artifacts
    if (isPerson) {
      const pAspect = track.h / Math.max(1, track.w);
      if (pAspect > 3.4 || pAspect < 1.1) {
        continue;
      }
    } else {
      const vAspect = track.w / Math.max(1, track.h);
      if (vAspect > 4.0 || vAspect < 0.22) {
        continue;
      }
      // Perspective road artifact rejection:
      // Road markings and circular manhole covers in the lower foreground road cannot be smaller than 65px
      if (track.y > videoHeight * 0.60 && track.h < 65 && (track.y + track.h * 0.5 < videoHeight - 15)) {
        continue;
      }
    }

    const { x, y, w, h } = sourceCenterBoxToDisplay(
      { x: track.x, y: track.y, w: track.w, h: track.h },
      transform
    );

    // Validate display coordinates and skip bounding boxes entirely outside the canvas viewport
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
      continue;
    }
    if (w < 4 || h < 4) {
      continue;
    }
    if (x + w < -10 || x > canvasWidth + 10 || y + h < -10 || y > canvasHeight + 10) {
      continue;
    }

    rendered++;

    const isConfirmed = track.state === 'Confirmed';
    let color = isConfirmed ? '#00ff00' : '#ffff00'; // Green for confirmed, Yellow for tentative
    if (isConfirmed && track.isOverspeed) {
      color = '#ff0000'; // Red for overspeed
    }
    let boxStyle: number[] = [];
    if (track.observationType === 'interpolated') {
      boxStyle = [6, 3]; // Subtle dash for motion-interpolated boxes
    } else if (track.observationType === 'predicted') {
      boxStyle = [2, 3]; // Fine dotted dash for motion-predicted boxes
    } else if (!isConfirmed) {
      boxStyle = [5, 5]; // Dashed for tentative
    }

    // Box stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = isConfirmed ? 2 : 1.5;
    if (track.isOverspeed) ctx.lineWidth = 3;
    ctx.setLineDash(boxStyle);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);

    // Format label:
    // Supported vehicles: `#<id> <VEHICLE> · <speed> km/h` when genuinely calibrated, or cleanly `#<id> <VEHICLE>`
    // People/Pedestrians: `#<id> PERSON` (NEVER display speed labels for people/pedestrians)
    const hasCalibratedSpeed = !isPerson && track.speed !== undefined && track.speed !== null;

    let label: string;
    if (isPerson) {
      label = `#${track.trackId} PERSON`;
    } else if (hasCalibratedSpeed) {
      const displaySpeed = Math.max(0, Math.round(Number.isFinite(track.speed) ? track.speed! : 0));
      label = `#${track.trackId} ${vehicleType} · ${displaySpeed} km/h`;
    } else {
      label = `#${track.trackId} ${vehicleType}`;
    }

    ctx.font = isConfirmed ? 'bold 12px sans-serif' : '11px sans-serif';
    const textMetrics = ctx.measureText(label);
    const padding = 4;
    const labelW = textMetrics.width + padding * 2;
    const labelH = 18;

    // Viewport-clamped candidate positions for deterministic collision avoidance:
    // 1. Immediately above the box
    // 2. Inside top of the box
    // 3. Immediately below the box
    // 4. Inside bottom of the box
    // 5. Right-aligned above the box
    // 6. Right-aligned inside top of the box
    const candidates: Array<{ x: number; y: number }> = [
      { x: x, y: y - labelH - 2 },
      { x: x, y: y + 2 },
      { x: x, y: y + h + 2 },
      { x: x, y: y + h - labelH - 2 },
      { x: x + w - labelW, y: y - labelH - 2 },
      { x: x + w - labelW, y: y + 2 }
    ];

    let chosenCandidate: LabelRect | null = null;

    for (const cand of candidates) {
      // Clamp horizontally within the visible canvas viewport
      const clampedX = Math.max(4, Math.min(canvasWidth - labelW - 4, cand.x));
      const candRect: LabelRect = {
        x: clampedX,
        y: cand.y,
        w: labelW,
        h: labelH
      };

      // Check vertical canvas boundary
      if (candRect.y < 2 || candRect.y + candRect.h > canvasHeight - 2) {
        continue;
      }

      // Check collision with already occupied labels
      const hasCollision = occupiedLabels.some(occ => checkCollision(candRect, occ));
      if (!hasCollision) {
        chosenCandidate = candRect;
        break;
      }
    }

    // If all preferred placements collide:
    // Try side placements (right or left of the box), or suppress label pill rather than stacking
    if (!chosenCandidate) {
      const sideCandidates: Array<{ x: number; y: number }> = [
        { x: x + w + 2, y: y },
        { x: x - labelW - 2, y: y }
      ];
      for (const side of sideCandidates) {
        if (side.x >= 4 && side.x + labelW <= canvasWidth - 4 && side.y >= 2 && side.y + labelH <= canvasHeight - 2) {
          const sideRect: LabelRect = { x: side.x, y: side.y, w: labelW, h: labelH };
          if (!occupiedLabels.some(occ => checkCollision(sideRect, occ))) {
            chosenCandidate = sideRect;
            break;
          }
        }
      }

      // If still colliding with an existing label pill, suppress label to prevent overlapping text
      if (!chosenCandidate) {
        continue;
      }
    }

    occupiedLabels.push(chosenCandidate);

    // Label pill background
    ctx.fillStyle = isConfirmed ? 'rgba(0, 0, 0, 0.75)' : 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(chosenCandidate.x, chosenCandidate.y, chosenCandidate.w, chosenCandidate.h);

    // Label text
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, chosenCandidate.x + padding, chosenCandidate.y + labelH / 2);
  }

  return { rendered, stale };
}
