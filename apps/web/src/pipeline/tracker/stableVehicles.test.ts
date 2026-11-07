import { describe, expect, it } from 'vitest';
import { reconcileVehicles, recoverBriefOpticalMisses, updateScreenSpeed, type PersistentTrack } from './stableVehicles';
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

  it('does not freeze a box at the edge after the vehicle exits', () => {
    const before: PersistentTrack = {
      ...car(300, 120, 9), id: 9, lastDetectedAt: 2,
      lastOpticalAt: 2, speedKmh: null, speedIsEstimate: true,
      vx: 180, vy: 0
    };
    expect(recoverBriefOpticalMisses([before], [], 2, 2.20, 300, 300)).toEqual([]);
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

});
