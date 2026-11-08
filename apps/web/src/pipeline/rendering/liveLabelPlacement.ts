/** Collision-aware placement for Live Analysis' labels. This must never
 * change track geometry, IDs, box rendering or the detection ledger.
 * Labels may be shortened or omitted when traffic is dense; boxes remain.
 */
export interface OverlayRect { x: number; y: number; w: number; h: number }
export interface PlacedLiveLabel { rect: OverlayRect; variant: number }
const GAP = 2;
const LABEL_HEIGHT = 18;

function overlaps(a: OverlayRect, b: OverlayRect): boolean {
  return a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x &&
    a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;
}

export function placeLiveLabel(
  box: OverlayRect, bounds: OverlayRect,
  widths: readonly number[], occupied: readonly OverlayRect[],
): PlacedLiveLabel | null {
  if (![box.x, box.y, box.w, box.h, bounds.x, bounds.y, bounds.w, bounds.h]
    .every(Number.isFinite) || box.w <= 0 || box.h <= 0 ||
    bounds.w <= 0 || bounds.h <= 0) return null;
  const safe = (r: OverlayRect) => r.x >= bounds.x + 1 &&
    r.y >= bounds.y + 1 &&
    r.x + r.w <= bounds.x + bounds.w - 1 &&
    r.y + r.h <= bounds.y + bounds.h - 1;
  // For tiny distant cars an ID/class tag is more readable than a speed
  // estimate which overflows multiple neighboring boxes.
  const preferCompact = widths.length > 2 && box.w < widths[0] * .53;
  const variants = preferCompact ? [1, 0, 2] : widths.map((_, i) => i);
  for (const variant of variants) {
    const width = widths[variant];
    if (!Number.isFinite(width) || width <= 0 || width >= bounds.w - 2) continue;
    const positions = [
      { x: box.x + 2, y: box.y - LABEL_HEIGHT - 2 },   // just above
      { x: box.x + 2, y: box.y + 2 },                   // inside top
      { x: box.x + 2, y: box.y + box.h + 2 },          // just below
      { x: box.x + box.w - width - 2, y: box.y - LABEL_HEIGHT - 2 },
      { x: box.x + box.w - width - 2, y: box.y + 2 },
      { x: box.x + 2, y: box.y + box.h - LABEL_HEIGHT - 2 },
      { x: box.x + box.w + 2, y: box.y },
      { x: box.x - width - 2, y: box.y },
    ];
    for (const pos of positions) {
      const rect = { ...pos, w: width, h: LABEL_HEIGHT };
      if (safe(rect) && !occupied.some(other => overlaps(rect, other))) {
        return { rect, variant };
      }
    }
  }
  return null;
}
