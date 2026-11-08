/** Vehicle-attached labels; anchor choices are stable for the lifetime of an ID.
 * The label is never placed at an unrelated screen coordinate. Existing IDs
 * keep their position relative to their bounding box even in crowded traffic.
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
  // Anchored to the same top-left corner of the vehicle each frame. The
  // only horizontal adjustment is at the actual video boundary.
  const x = Math.max(bounds.x + 1, Math.min(box.x + 2, bounds.x + bounds.w - width - 1));
  const y = slot === 0 ? box.y - HEIGHT - 2 : // above, only for tiny boxes
    slot === 1 ? box.y + 2 :                 // inside top, preferred for cars
    slot === 2 ? box.y + box.h + 2 :        // below, crowding fallback
    box.y + box.h - HEIGHT - 2;            // inside bottom
  return { x, y, w: width, h: HEIGHT };
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

  // Never move a known vehicle's label to another edge to avoid a neighbor.
  // The box (not some cached screen coordinate) determines every pixel.
  if (previous && Number.isInteger(previous.slot) && previous.slot >= 0 &&
      previous.slot < 4 && allowed(previous.variant)) {
    const rect = candidate(box, bounds, widths[previous.variant], previous.slot);
    if (fits(rect, bounds)) return { rect, variant: previous.variant, slot: previous.slot };
  }

  // Readability first: keep labels inside normal vehicle boxes. Tiny distant
  // vehicles use an above-box tag to avoid covering their few image pixels.
  const primarySlot = box.h >= HEIGHT + 4 ? 1 : 0;
  const slots = primarySlot === 1 ? [1, 3, 0, 2] : [0, 1, 2, 3];
  const compactFirst = widths.length > 1 && allowed(1) &&
    (!allowed(0) || box.w < widths[0] * .9);
  const variants = compactFirst ? [1, 0] : [0, 1];
  for (const variant of variants) {
    if (!allowed(variant)) continue;
    for (const slot of slots) {
      const rect = candidate(box, bounds, widths[variant], slot);
      if (fits(rect, bounds) && !occupied.some(other => overlaps(rect, other))) {
        return { rect, variant, slot };
      }
    }
  }
  // Crowded frame: keep the tag attached instead of making it disappear.
  for (const variant of variants) {
    if (!allowed(variant)) continue;
    for (const slot of slots) {
      const rect = candidate(box, bounds, widths[variant], slot);
      if (fits(rect, bounds)) return { rect, variant, slot };
    }
  }
  return null;
}
