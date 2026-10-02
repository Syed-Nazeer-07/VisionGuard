import type { TrackedObject } from '../types';

export function drawBoundingBoxes(
  ctx: CanvasRenderingContext2D,
  tracks: TrackedObject[],
  canvasWidth: number,
  canvasHeight: number,
  videoWidth: number,
  videoHeight: number
) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const scaleX = canvasWidth / videoWidth;
  const scaleY = canvasHeight / videoHeight;

  for (const track of tracks) {
    const x = (track.x - track.w / 2) * scaleX;
    const y = (track.y - track.h / 2) * scaleY;
    const w = track.w * scaleX;
    const h = track.h * scaleY;

    const isConfirmed = track.state === 'Confirmed';
    let color = isConfirmed ? '#00ff00' : '#ffff00'; // Green for confirmed, Yellow for tentative
    if (isConfirmed && track.isOverspeed) {
      color = '#ff0000'; // Red for overspeed
    }
    const boxStyle = isConfirmed ? [] : [5, 5]; // Dashed for tentative

    // Box stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = isConfirmed ? 2 : 1.5;
    if (track.isOverspeed) ctx.lineWidth = 3;
    ctx.setLineDash(boxStyle);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]); // Reset dash

    // Label background
    let label = `ID:${track.trackId} ${track.className} ${(track.prob * 100).toFixed(0)}% Age:${track.age}`;
    if (track.speed !== undefined) {
      label += ` | ${Math.round(track.speed)} km/h`;
    }
    ctx.font = isConfirmed ? 'bold 14px sans-serif' : '12px sans-serif';
    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;
    const textHeight = 14;
    
    ctx.fillStyle = isConfirmed ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(x, y > 20 ? y - textHeight - 4 : y, textWidth + 8, textHeight + 4);

    // Label text
    ctx.fillStyle = color;
    ctx.fillText(label, x + 4, y > 20 ? y - 4 : y + textHeight);
  }
}
