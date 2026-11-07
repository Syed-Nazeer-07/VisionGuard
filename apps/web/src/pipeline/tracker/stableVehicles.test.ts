import { describe, expect, it } from 'vitest';
import { chooseHeavyVehicleLabel, reconcileVehicles, recoverBriefOpticalMisses, updateScreenSpeed, type PersistentTrack } from './stableVehicles';
import type { LiveTrack } from './liveProjection';

function car(x: number, y = 120, id = 0): LiveTrack {
  return {
    id, className: 'car', confidence: .88, x, y, w: 55, h: 35,
    vx: 0, vy: 0, motionPxPerSec: null
  };
}

describe('persistent crowded vehicle tracking', () => {
  it('keeps all 24 cars uniquely identified even if new YOLO IDs are shuffled', () => {
    const initial = Array.from({ length: 24 }, (_, i) =>
      car(40 + (i % 8) * 86, 40 + Math.floor(i / 8) * 95, 300 + i)
    );
    const first = reconcileVehicles([], initial, 2, 1);
    expect(first.tracks).toHaveLength(24);
    expect(new Set(first.tracks.map(t => t.id)).size).toBe(24);
    const secondDetections = initial.map((t, i) =>
      ({ ...t, id: 600 + i, x: t.x + 4 })
    ).reverse();
    const second = reconcileVehicles(first.tracks, secondDetections, 2.9, first.nextId);
    expect(second.tracks).toHaveLength(24);
    expect(new Set(second.tracks.map(t => t.id)).size).toBe(24);
    expect(second.nextId).toBe(first.nextId);
  });

  it('keeps the label identity and size smooth after YOLO correction', () => {
    const old: PersistentTrack = { ...car(100, 120, 9), id: 9, lastDetectedAt: 1,
      speedKmh: 0, speedIsEstimate: true };
    const next = reconcileVehicles([old], [{ ...car(105), w: 60, id: 333 }], 2, 10);
    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0].id).toBe(9);
    expect(next.tracks[0].x).toBeGreaterThan(100);
    expect(next.tracks[0].x).toBeLessThan(105);
    expect(next.tracks[0].w).toBeLessThan(60);
  });

  it('reports exact zero for stationary car after a 0.5s observation window', () => {
    const history = { points: [], smoothedKmh: null };
    const first = updateScreenSpeed(history, car(100), 0);
    const second = updateScreenSpeed(first.history, car(100.2), 0.60);
    expect(second.kmh).toBe(0);
  });

  it('reports an explicitly estimated nonzero km/h for moving car', () => {
    const first = updateScreenSpeed({ points: [], smoothedKmh: null }, car(100), 0);
    const next = updateScreenSpeed(first.history, car(130), .65);
    expect(next.kmh).not.toBeNull();
    expect(next.kmh).toBeGreaterThan(0);
  });

  it('restores an existing ID after optical tracking temporarily loses a vehicle', () => {
    const original = reconcileVehicles([], [car(100, 100, 401)], 1, 1);
    const sourceIds = original.sourceAssignments;
    expect(sourceIds.get(401)).toBe(1);
    const restored = reconcileVehicles([], [car(115, 100, 401)], 2.2, original.nextId, sourceIds);
    expect(restored.tracks).toHaveLength(1);
    expect(restored.tracks[0].id).toBe(1);
    expect(restored.nextId).toBe(original.nextId);
  });

  it('drops tracks after repeated missed detections without creating duplicates', () => {
    const first = reconcileVehicles([], [car(80)], 1, 1);
    const missed = reconcileVehicles(first.tracks, [], 3, first.nextId);
    expect(missed.tracks).toHaveLength(0);
  });
  it('briefly holds a lost car before expiring it, without inventing motion or km/h', () => {
    const before: PersistentTrack = {
      ...car(100, 120, 5), id: 5, lastDetectedAt: 1,
      lastOpticalAt: 1, speedKmh: 0, speedIsEstimate: true, vx: 0, vy: 0
    };
    const brief = recoverBriefOpticalMisses([before], [], 1, 1.12, 300, 300);
    expect(brief).toHaveLength(1);
    expect(brief[0].id).toBe(5);
    expect(brief[0].speedKmh).toBe(0);
    expect(brief[0].isPredicted).toBe(true);
    const gone = recoverBriefOpticalMisses(brief, [], 1.30, 1.45, 300, 300);
    expect(gone).toHaveLength(0);
  });

  it('expires a box after two missing optical samples even if its old location remains in frame', () => {
    const old: PersistentTrack = {
      ...car(100, 120, 13), lastDetectedAt: 2, lastOpticalAt: 2,
      speedKmh: 30, speedIsEstimate: true
    };
    const held = recoverBriefOpticalMisses([old], [], 2, 2.1, 300, 300);
    expect(held).toHaveLength(1);
    expect(recoverBriefOpticalMisses(held, [], 2.1, 2.18, 300, 300)).toEqual([]);
  });
  it('immediately rejects outward-moving boxes before they stick to the border', () => {
    const leaving: PersistentTrack = {
      ...car(272, 120, 18), lastDetectedAt: 3, lastOpticalAt: 3,
      vx: 120, vy: 0, speedKmh: 30, speedIsEstimate: true
    };
    expect(recoverBriefOpticalMisses([leaving], [], 3, 3.01, 300, 300)).toEqual([]);
  });
  it('drops predicted-only boxes when the next YOLO result also misses', () => {
    const ghost: PersistentTrack = {
      ...car(270, 120, 11), id: 11, lastDetectedAt: 2,
      lastOpticalAt: 2, speedKmh: null, speedIsEstimate: true,
      isPredicted: true, vx: 120, vy: 0
    };
    const result = reconcileVehicles([ghost], [], 2.18, 12);
    expect(result.tracks).toEqual([]);
  });

  it('keeps a recently optically confirmed car through a single YOLO miss', () => {
    const real: PersistentTrack = {
      ...car(170, 120, 14), id: 14, lastDetectedAt: 2,
      lastOpticalAt: 2.24, speedKmh: 0, speedIsEstimate: true,
      isPredicted: false, vx: 0, vy: 0
    };
    const result = reconcileVehicles([real], [], 2.30, 15);
    expect(result.tracks.map(t => t.id)).toEqual([14]);
  });

  it('does not freeze a box at the edge after the vehicle exits', () => {
    const before: PersistentTrack = {
      ...car(300, 120, 9), id: 9, lastDetectedAt: 2,
      lastOpticalAt: 2, speedKmh: null, speedIsEstimate: true,
      vx: 180, vy: 0
    };
    expect(recoverBriefOpticalMisses([before], [], 2, 2.20, 300, 300)).toEqual([]);
  });

  it('removes partially exited optical predictions before they linger at the frame edge', () => {
    const leaving: PersistentTrack = {
      ...car(298, 120, 17), id: 17, lastDetectedAt: 3,
      lastOpticalAt: 3, speedKmh: null, speedIsEstimate: true,
      vx: 0, vy: 0
    };
    // 53.6% visible: the old 35% threshold left this ghost in the overlay.
    expect(recoverBriefOpticalMisses([leaving], [], 3, 3.10, 300, 300)).toEqual([]);
    // A mostly visible real road user must still be held for one brief miss.
    expect(recoverBriefOpticalMisses([{ ...leaving, x: 270 }], [], 3, 3.10, 300, 300)).toHaveLength(1);
    expect(recoverBriefOpticalMisses([{ ...leaving, x: 305 }], [], 3, 3.10, 300, 300)).toEqual([]);
  });

  it('limits abrupt bus/truck box size changes during the same persistent track', () => {
    const before: PersistentTrack = {
      ...car(100, 120, 4), id: 4, w: 60, h: 80, lastDetectedAt: 1,
      speedKmh: null, speedIsEstimate: true, className: 'truck'
    };
    const after = { ...before, id: 101, w: 110, h: 145, className: 'bus' };
    const merged = reconcileVehicles([before], [after], 2, 102);
    expect(merged.tracks).toHaveLength(1);
    expect(merged.tracks[0].id).toBe(4);
    expect(merged.tracks[0].w).toBeLessThan(65);
    expect(merged.tracks[0].h).toBeLessThan(88);
  });

  it('distinguishes bus and truck from real detector scores over time', () => {
    expect(chooseHeavyVehicleLabel({ bus: .82, truck: .09 }).label).toBe('bus');
    expect(chooseHeavyVehicleLabel({ bus: .09, truck: .82 }).label).toBe('truck');
    expect(chooseHeavyVehicleLabel({ bus: .51, truck: .46 }).label).toBe('bus/truck');

    let previous: PersistentTrack = {
      ...car(100, 120, 5), id: 5, className: 'bus',
      classVotes: { bus: .9, truck: .2 }, lastDetectedAt: 1,
      speedKmh: null, speedIsEstimate: true
    };
    for (let step = 0; step < 3; step++) {
      const next = reconcileVehicles(
        [previous],
        [{ ...car(100, 120, 88), className: 'truck',
          classScores: { bus: .08, truck: .91 } }],
        2 + step, 6
      );
      expect(next.tracks).toHaveLength(1);
      expect(next.tracks[0].id).toBe(5);
      previous = next.tracks[0];
    }
    expect(previous.className).toBe('truck');
  });

  it('does not force a bus/truck label from weakly differentiated scores', () => {
    const first = reconcileVehicles([], [{
      ...car(100, 120, 100),
      className: 'bus',
      classScores: { bus: .49, truck: .46 }
    }], 1, 1);
    expect(first.tracks[0].className).toBe('bus/truck');
  });

});
