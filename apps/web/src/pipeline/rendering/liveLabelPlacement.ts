/** Stable, vehicle-attached label placement. Previous slot/variant takes
 * priority over reoptimizing crowded labels on every requestAnimationFrame.
 * A new vehicle may use a free alternate slot; an incumbent NEVER jumps to
 * a different slot merely because its neighbors moved.
 *
 * The caller supplies exactly two labels (full + compact); both retain
 * track ID and a speed field. No class-only fallback is permitted.
 */
export interface OverlayRect { x: number; y: number; w: number; h: number }
export interface PlacedLiveLabel { rect: OverlayRect; variant: number; slot: number }
export interface LiveLabelAnchor { slot: number; variant: number }
const GAP = 2;
const HEIGHT = 18;
const overlaps = (a: OverlayRect, b: OverlayRect) =>
  a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x &&
  a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;

function candidate(box: OverlayRect, bounds: OverlayRect, width: number, slot: number): OverlayRect {
  const anchorX = Math.max(bounds.x + 1,
    Math.min(box.x + 2, bounds.x + bounds.w - width - 1));
  const y = slot === 0 ? box.y - HEIGHT - 2 : // above
    slot === 1 ? box.y + 2 :                 // inside top
    slot === 2 ? box.y + box.h + 2 :         // below
    box.y + box.h - HEIGHT - 2;             // inside bottom
  return { x: anchorX, y, w: width, h: HEIGHT };
}
function fits(rect: OverlayRect, bounds: OverlayRect): boolean {
  return rect.x >= bounds.x + 1 && rect.y >= bounds.y + 1 &&
    rect.x + rect.w <= bounds.x + bounds.w - 1 &&
    rect.y + rect.h <= bounds.y + bounds.h - 1;
}

export function placeLiveLabel(
  box: OverlayRect,
  bounds: OverlayRect,
  widths: readonly number[],
  occupied: readonly OverlayRect[],
  previous?: LiveLabelAnchor,
): PlacedLiveLabel | null {
  if (![box.x, box.y, box.w, box.h, bounds.x, bounds.y, bounds.w, bounds.h]
    .every(Number.isFinite) || box.w <= 0 || box.h <= 0 ||
    bounds.w <= 0 || bounds.h <= 0) return null;
  const allowed = (variant: number) => variant >= 0 && variant < widths.length &&
    Number.isFinite(widths[variant]) && widths[variant] > 0 &&
    widths[variant] < bounds.w - 2;
  if (previous && Number.isInteger(previous.slot) && previous.slot >= 0 &&
      previous.slot < 4 && allowed(previous.variant)) {
    const rect = candidate(box, bounds, widths[previous.variant], previous.slot);
    if (fits(rect, bounds)) {
      // Incumbent stability wins over temporarily overlapping a neighbor;
      // otherwise every optical-pixel change makes the tag jump or disappear.
      return { rect, variant: previous.variant, slot: previous.slot };
    }
  }
  const compactFirst = widths.length > 1 && allowed(0) &&
    box.w < widths[0] * .67;
  const variants = compactFirst ? [1, 0] : [0, 1];
  for (const variant of variants) {
    if (!allowed(variant)) continue;
    for (const slot of [0, 1, 2, 3]) {
      const rect = candidate(box, bounds, widths[variant], slot);
      if (fits(rect, bounds) && !occupied.some(other => overlaps(rect, other))) {
        return { rect, variant, slot };
      }
    }
  }
  // Don't hide a vehicle's ID and speed just because all free positions were
  // exhausted. Retain the most natural anchored position as a last resort.
  for (const variant of [1, 0]) {
    if (!allowed(variant)) continue;
    for (const slot of [0, 1, 2, 3]) {
      const rect = candidate(box, bounds, widths[variant], slot);
      if (fits(rect, bounds)) return { rect, variant, slot };
    }
  }
  return null;
}
