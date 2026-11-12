/** Highest visible optical speed estimate. Prediction-only boxes are not
 * measurements, and out-of-range values must never enter the live summary. */
export function fastestVisibleEstimate(
  tracks: ReadonlyArray<{ speedKmh: number | null; isPredicted?: boolean }>
): number | null {
  let fastest: number | null = null;
  for (const track of tracks) {
    const speed = track.speedKmh;
    if (track.isPredicted || speed === null || !Number.isFinite(speed) ||
        speed < 0 || speed > 160) continue;
    fastest = fastest === null ? speed : Math.max(fastest, speed);
  }
  return fastest;
}
