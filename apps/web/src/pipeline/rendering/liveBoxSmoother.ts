import { MAX_TRACK_AGE_SEC, type LiveTrack } from '../tracker/liveProjection';

type Box = Pick<LiveTrack, 'x' | 'y' | 'w' | 'h'>;

type BoxSample = {
  box: Box;
  time: number;
  vx: number;
  vy: number;
};

const CORRECTION_SECONDS = 0.12;

function smoothCenter(
  previous: number, target: number, previousVelocity: number, velocity: number,
  size: number, elapsed: number, remainingCorrection: number
): number {
  const offset = target - previous;
  const direction = Math.sign(offset);
  // Follow motion supported by both samples. Ease the remaining correction
  // from detector re-centering or noisy optical matches.
  const motion = Math.max(0, Math.min(Math.abs(offset),
    direction * previousVelocity * elapsed, direction * velocity * elapsed));
  const residual = (Math.abs(offset) - motion) * remainingCorrection;
  return target - direction * Math.min(residual, size * 0.10);
}

/** Smooths only the geometry of tracks that already qualify for display. */
export class LiveBoxSmoother {
  private previous = new Map<number, BoxSample>();

  clear(): void {
    this.previous.clear();
  }

  update<T extends LiveTrack>(tracks: readonly T[], mediaTime: number): T[] {
    const next = new Map<number, BoxSample>();
    const displayed = tracks.map(track => {
      const previous = this.previous.get(track.id);
      const elapsed = previous ? mediaTime - previous.time : Infinity;
      if (!previous || elapsed < 0 || elapsed > MAX_TRACK_AGE_SEC) {
        next.set(track.id, { box: track, time: mediaTime, vx: track.vx, vy: track.vy });
        return track;
      }
      if (elapsed === 0) {
        next.set(track.id, previous);
        const { x, y, w, h } = previous.box;
        return { ...track, x, y, w, h };
      }
      const remainingCorrection = Math.exp(-elapsed / CORRECTION_SECONDS);
      const box: Box = {
        x: smoothCenter(previous.box.x, track.x, previous.vx, track.vx, track.w, elapsed, remainingCorrection),
        y: smoothCenter(previous.box.y, track.y, previous.vy, track.vy, track.h, elapsed, remainingCorrection),
        w: track.w + (previous.box.w - track.w) * remainingCorrection,
        h: track.h + (previous.box.h - track.h) * remainingCorrection
      };
      next.set(track.id, { box, time: mediaTime, vx: track.vx, vy: track.vy });
      return { ...track, ...box };
    });
    this.previous = next;
    return displayed;
  }
}
