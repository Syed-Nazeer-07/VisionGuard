import { placeLiveLabel } from './liveLabelPlacement';
import { vehicleOverlayLabels } from './vehicleOverlayLabels';
import type { PersistentTrack } from '../tracker/stableVehicles';

export type LiveLabelAnchor = { slot: number; variant: number; lastSeenMs: number };

export function paintLiveOverlay(
  context: CanvasRenderingContext2D,
  tracks: readonly PersistentTrack[],
  frame: { width: number; height: number },
  viewport: { width: number; height: number; dpr: number },
  anchors: Map<number, LiveLabelAnchor>,
  time: number,
  options: { boxes: boolean; labels: boolean; candidates?: boolean },
): PersistentTrack[] {
  const fit = Math.min(viewport.width / frame.width, viewport.height / frame.height);
  const bounds = {
    x: (viewport.width - frame.width * fit) / 2,
    y: (viewport.height - frame.height * fit) / 2,
    w: frame.width * fit,
    h: frame.height * fit
  };
  for (const [id, previous] of anchors) {
    if (time - previous.lastSeenMs > 1500) anchors.delete(id);
  }
  if (!Number.isFinite(fit) || fit <= 0) return [];
  const boxes = tracks.map(track => ({
    track, x: bounds.x + (track.x - track.w / 2) * fit,
    y: bounds.y + (track.y - track.h / 2) * fit, w: track.w * fit, h: track.h * fit
  })).filter(box => [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w >= 4 && box.h >= 4);

  if (!options.boxes) return boxes.map(box => box.track);
  context.save();
  context.scale(viewport.dpr, viewport.dpr);
  context.beginPath();
  context.rect(bounds.x, bounds.y, bounds.w, bounds.h);
  context.clip();
  context.lineWidth = 2;
  for (const { track, x, y, w, h } of boxes) {
    context.strokeStyle = track.isPredicted ? '#c0d7cf' : '#51f6b5';
    context.setLineDash(track.isPredicted ? [4, 3] : []);
    context.strokeRect(x, y, w, h);
  }
  if (options.labels) {
    const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
    boxes.sort((a, b) => Number(anchors.has(b.track.id)) - Number(anchors.has(a.track.id)) ||
      (b.w * b.h - a.w * a.h) || (a.track.id - b.track.id));
    context.font = '600 11px system-ui,sans-serif';
    for (const box of boxes) {
      const labels = options.candidates ? [box.track.className] : vehicleOverlayLabels(box.track);
      const widths = labels.map(label => context.measureText(label).width + 12);
      const placement = placeLiveLabel(box, bounds, widths, occupied, anchors.get(box.track.id));
      if (!placement) continue;
      const { rect, slot, variant } = placement;
      anchors.set(box.track.id, { slot, variant, lastSeenMs: time });
      occupied.push(rect);
      context.fillStyle = 'rgba(7,16,34,.90)';
      context.fillRect(rect.x, rect.y, rect.w, rect.h);
      context.fillStyle = '#ccffeb';
      context.fillText(labels[variant], rect.x + 6, rect.y + 13);
    }
  }
  context.restore();
  return boxes.map(box => box.track);
}
