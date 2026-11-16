/** Limit expensive overlays on touch phones without slowing the video itself.
 * Detection and tracking still use decoded video-frame callbacks independently.
 */
export function analysisPaintIntervalMs(viewportWidth: number, coarsePointer: boolean): number {
  return coarsePointer && viewportWidth <= 767 ? 1000 / 30 : 1000 / 60;
}

export function shouldPaintAnalysisFrame(
  nowMs: number,
  previousPaintMs: number,
  intervalMs: number,
): boolean {
  if (!Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(previousPaintMs) || previousPaintMs <= 0 || nowMs < previousPaintMs)
    return true;
  return nowMs - previousPaintMs >= intervalMs - 1;
}
