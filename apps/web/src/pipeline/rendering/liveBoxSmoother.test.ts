import { describe, expect, it } from 'vitest';
import { LiveBoxSmoother } from './liveBoxSmoother';
import { projectLiveTracks, type LiveTrack } from '../tracker/liveProjection';

const car: LiveTrack = {
  id: 1, className: 'car', confidence: 0.95,
  x: 300, y: 180, w: 100, h: 60, vx: 0, vy: 0, motionPxPerSec: 0
};

describe('live box smoothing', () => {
  it('damps alternating corrections without changing tracker measurements', () => {
    const smoother = new LiveBoxSmoother();
    smoother.update([car], 0);
    let maxDeviation = 0;
    for (let frame = 1; frame <= 12; frame++) {
      const direction = frame % 2 === 0 ? 1 : -1;
      const input = { ...car, x: car.x + direction * 4, w: car.w + direction * 6,
        vx: direction * 35, motionPxPerSec: 35 };
      const [displayed] = smoother.update([input], frame / 30);
      maxDeviation = Math.max(maxDeviation, Math.abs(displayed.x - car.x));
      expect(Math.abs(displayed.w - car.w)).toBeLessThan(2);
      expect(displayed).toMatchObject({ id: car.id, vx: input.vx, motionPxPerSec: 35 });
      expect(input.x).toBe(car.x + direction * 4);
    }
    expect(maxDeviation).toBeLessThan(1.2);
  });

  it.each([-180, 180])('follows steady motion at %i px/s without trailing behind', vx => {
    const smoother = new LiveBoxSmoother();
    for (let frame = 0; frame < 12; frame++) {
      const time = frame / 25;
      const x = car.x + vx * time;
      const [displayed] = smoother.update([{ ...car, x, vx }], time);
      expect(displayed.x).toBeCloseTo(x);
    }
  });

  it('limits lag when a vehicle moves abruptly', () => {
    const smoother = new LiveBoxSmoother();
    smoother.update([car], 0);
    const [displayed] = smoother.update([{ ...car, x: 335 }], 1 / 30);
    expect(displayed.x).toBeGreaterThanOrEqual(325);
  });

  it('keeps the box fixed while the same frame is painted again', () => {
    const smoother = new LiveBoxSmoother();
    smoother.update([car], 2);
    const corrected = { ...car, x: 306, w: 108, confidence: 0.98 };
    expect(smoother.update([corrected], 2)).toEqual([{ ...car, confidence: 0.98 }]);
    const [nextFrame] = smoother.update([corrected], 2.04);
    expect(nextFrame.x).toBeGreaterThan(car.x);
    expect(nextFrame.x).toBeLessThan(corrected.x);
  });

  it('drops expired boxes and shows reacquired tracks at their new positions', () => {
    const smoother = new LiveBoxSmoother();
    smoother.update([car], 2);
    expect(smoother.update(projectLiveTracks([car], 2, 2.3, 600, 400), 2.3)).toEqual([]);
    const reacquired = { ...car, x: 380 };
    expect(smoother.update([reacquired], 2.31)).toEqual([reacquired]);
    expect(smoother.update([car], 1)).toEqual([car]);
    expect(smoother.update([reacquired], 2)).toEqual([reacquired]);
    smoother.clear();
    expect(smoother.update([car], 2)).toEqual([car]);
  });
});

it('bounds displayed size error for an approaching or receding vehicle without modifying tracking geometry', () => {
  const smoother = new LiveBoxSmoother();
  smoother.update([car], 0);
  const approaching = { ...car, w: 160, h: 100 };
  const [grown] = smoother.update([approaching], 1 / 30);
  expect(grown.w).toBeGreaterThanOrEqual(144);
  expect(grown.h).toBeGreaterThanOrEqual(90);
  expect(approaching.w).toBe(160);
  const receding = { ...car, w: 70, h: 42 };
  const [shrunk] = smoother.update([receding], 2 / 30);
  expect(shrunk.w).toBeLessThanOrEqual(77);
  expect(shrunk.h).toBeLessThanOrEqual(46.2);
});
