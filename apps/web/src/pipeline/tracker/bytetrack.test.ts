import { describe, it, expect } from 'vitest';
import { ByteTracker } from './bytetrack';
import type { BoundingBox } from '../types';

describe('ByteTracker', () => {
  const makeBox = (_id: number, x: number, y: number, className: string = 'car', classId: number = 2, prob: number = 0.9): BoundingBox => ({
    x,
    y,
    w: 50,
    h: 50,
    prob,
    classId,
    className
  });

  it('shows a car only after 3 real observations and uses the exact last box', () => {
    const tracker = new ByteTracker();
    tracker.reset();
    expect(tracker.update([makeBox(1, 100, 200, 'car', 2, .92)])).toEqual([]);
    expect(tracker.update([makeBox(1, 105, 202, 'car', 2, .95)])).toEqual([]);
    const tracks = tracker.update([makeBox(1, 110, 204, 'car', 2, .96)]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      trackId: 1, state: 'Confirmed', className: 'car',
      x: 110, y: 204, prob: .96, hitCount: 3
    });
  });

  it('keeps a two-wheeler after 2 consecutive observations with lower confidence', () => {
    const tracker = new ByteTracker();
    tracker.reset();
    tracker.trackThreshold = .40;
    expect(tracker.update([makeBox(1, 100, 200, 'motorcycle', 3, .31)])).toEqual([]);
    const tracks = tracker.update([makeBox(1, 103, 201, 'motorcycle', 3, .33)]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].className).toBe('motorcycle');
  });

  it('recovers lost tracks when vehicle is redetected instead of fragmenting into new track ID', () => {
    const tracker = new ByteTracker();
    tracker.reset();
    // Frame 1 & 2: establish confirmed track
    tracker.update([makeBox(1, 100, 100)]);
    const initialId = tracker.tracks[0].trackId;
    tracker.update([makeBox(1, 102, 101)]);

    // Frame 3: missed detection (occlusion) -> track becomes Lost
    const tracksMissed = tracker.update([]);
    expect(tracksMissed.length).toBe(0); // Lost track is not exported to avoid floating over empty road

    // Frame 4: vehicle reappears near previous position
    const tracksReappeared = tracker.update([makeBox(1, 106, 103)]);
    expect(tracksReappeared.length).toBe(1);
    // Track should be recovered with initialId, NOT a new track ID
    expect(tracksReappeared[0].trackId).toBe(initialId);
    expect(tracksReappeared[0].state).toBe('Confirmed');
    expect(tracksReappeared[0].x).toBe(106);
  });

  it('expires lost tracks permanently after maxTimeLost', () => {
    const tracker = new ByteTracker();
    tracker.maxTimeLost = 3; // short expiry for test
    tracker.update([makeBox(1, 100, 100)]);
    tracker.update([makeBox(1, 102, 100)]);

    // Disappear for 4 frames (> maxTimeLost)
    tracker.update([]);
    tracker.update([]);
    tracker.update([]);
    tracker.update([]);

    expect(tracker.tracks.length).toBe(0); // Track removed completely
  });

  it('prevents cross-class track matching (class gating)', () => {
    const tracker = new ByteTracker();
    // Track 1 is a car
    tracker.update([makeBox(1, 100, 100, 'car', 2)]);
    tracker.update([makeBox(1, 100, 100, 'car', 2)]);

    // Next frame: at the exact same location, a person is detected
    const personDet = makeBox(2, 100, 100, 'person', 0, 0.9);
    tracker.update([personDet]);
    tracker.update([personDet]);
    const tracks = tracker.update([personDet]);

    // The person detection must NOT take over car track #1
    const personTrack = tracks.find(t => t.className === 'person');
    expect(personTrack).toBeDefined();
    expect(personTrack!.trackId).not.toBe(1); // Spawns new track #2
  });

  it('preserves track ID across car and truck flip and votes class stably', () => {
    const tracker = new ByteTracker();
    // 3 confident car frames
    tracker.update([makeBox(1, 100, 100, 'car', 2, 0.95)]);
    const initialId = tracker.tracks[0].trackId;
    tracker.update([makeBox(1, 102, 101, 'car', 2, 0.95)]);
    tracker.update([makeBox(1, 104, 102, 'car', 2, 0.95)]);

    // 1 frame misclassified as truck
    const tracksWithTruck = tracker.update([makeBox(1, 106, 103, 'truck', 7, 0.85)]);
    expect(tracksWithTruck.length).toBe(1);
    expect(tracksWithTruck[0].trackId).toBe(initialId); // Same track ID!
    expect(tracksWithTruck[0].className).toBe('car'); // Stabilized by voting
  });

  it('matches track under larger frame displacement with 0.2 threshold', () => {
    const tracker = new ByteTracker();
    tracker.update([makeBox(1, 100, 100, 'car', 2, 0.9)]);
    const initialId = tracker.tracks[0].trackId;
    tracker.update([makeBox(1, 100, 100, 'car', 2, 0.9)]);

    // Move by 30 pixels out of 50px width (IOU is around 0.25)
    // Under 0.2 threshold, it matches and keeps track ID
    const displaced = tracker.update([makeBox(1, 130, 100, 'car', 2, 0.9)]);
    expect(displaced.length).toBe(1);
    expect(displaced[0].trackId).toBe(initialId);
  });
});

