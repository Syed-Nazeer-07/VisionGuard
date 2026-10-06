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

  const videoRatio = videoWidth / videoHeight;
  const canvasRatio = canvasWidth / canvasHeight;

  let renderWidth = canvasWidth;
  let renderHeight = canvasHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (videoRatio > canvasRatio) {
    renderHeight = canvasWidth / videoRatio;
    offsetY = (canvasHeight - renderHeight) / 2;
  } else {
    renderWidth = canvasHeight * videoRatio;
    offsetX = (canvasWidth - renderWidth) / 2;
  }

  const scaleX = renderWidth / videoWidth;
  const scaleY = renderHeight / videoHeight;

  for (const track of tracks) {
    const x = (track.x - track.w / 2) * scaleX + offsetX;
    const y = (track.y - track.h / 2) * scaleY + offsetY;
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
    const classNameFormatted = track.className.charAt(0).toUpperCase() + track.className.slice(1);
    let label = `${classNameFormatted} #${track.trackId} | Conf: ${(track.prob * 100).toFixed(0)}%`;
    if (track.speed !== undefined) {
      label += ` | ${Math.round(track.speed)} km/h`;
    } else {
      label += ` | Speed unavailable`;
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
