import { describe, it, expect } from 'vitest';
import { RuleEngine } from './RuleEngine';
import type { ViolationRule, RuleContext, ViolationCandidate } from './types';
import type { TrackedObject } from '../types';

// Minimal mock rule that always fires for Confirmed tracks
class AlwaysFiringRule implements ViolationRule {
  readonly id = 'always';
  readonly name = 'Always Fires';
  isEnabled = true;

  evaluate(track: TrackedObject, _context: RuleContext): ViolationCandidate | null {
    if (track.state !== 'Confirmed') return null;
    return {
      type: 'overspeed',
      severity: 'high',
      timestamp: new Date().toISOString(),
      status: 'pending_review',
      metadata: { track_id: track.trackId, speed: 100, speed_limit: 60 }
    };
  }

  reset(_trackId?: number) {}
}

// Rule that never fires
class NeverFiringRule implements ViolationRule {
  readonly id = 'never';
  readonly name = 'Never Fires';
  isEnabled = true;

  evaluate(_track: TrackedObject, _context: RuleContext): ViolationCandidate | null {
    return null;
  }
  reset(_trackId?: number) {}
}

const CONFIRMED_TRACK: TrackedObject = {
  trackId: 1,
  x: 0.5, y: 0.5, w: 0.1, h: 0.1,
  state: 'Confirmed',
  className: 'car',
  classId: 2,
  prob: 0.9,
  age: 5,
  speed: 100,
  isOverspeed: true
};

const PENDING_TRACK: TrackedObject = {
  ...CONFIRMED_TRACK,
  trackId: 2,
  state: 'Tentative'
};

const CONTEXT: RuleContext = {
  mediaTime: 10.5,
  fps: 30,
  calibration: { speedLimit: 60, tolerance: 5, referenceWidth: 3.5, referenceHeight: 5, calibrationArea: [] }
};

describe('RuleEngine', () => {
  it('fires for confirmed track with enabled rule', () => {
    const engine = new RuleEngine();
    engine.register(new AlwaysFiringRule());
    const results = engine.evaluate([CONFIRMED_TRACK], CONTEXT);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('overspeed');
  });

  it('does not fire for tentative/lost tracks', () => {
    const engine = new RuleEngine();
    engine.register(new AlwaysFiringRule());
    const results = engine.evaluate([PENDING_TRACK], CONTEXT);
    expect(results).toHaveLength(0);
  });

  it('does not fire when rule is disabled', () => {
    const engine = new RuleEngine();
    const rule = new AlwaysFiringRule();
    rule.isEnabled = false;
    engine.register(rule);
    const results = engine.evaluate([CONFIRMED_TRACK], CONTEXT);
    expect(results).toHaveLength(0);
  });

  it('does not fire the same track+rule twice (dedup)', () => {
    const engine = new RuleEngine();
    engine.register(new AlwaysFiringRule());
    engine.evaluate([CONFIRMED_TRACK], CONTEXT);
    const second = engine.evaluate([CONFIRMED_TRACK], CONTEXT);
    expect(second).toHaveLength(0); // deduplicated
  });

  it('fires again after reset()', () => {
    const engine = new RuleEngine();
    engine.register(new AlwaysFiringRule());
    engine.evaluate([CONFIRMED_TRACK], CONTEXT);
    engine.reset();
    const results = engine.evaluate([CONFIRMED_TRACK], CONTEXT);
    expect(results).toHaveLength(1);
  });

  it('fires again after reset(trackId) for that track', () => {
    const engine = new RuleEngine();
    engine.register(new AlwaysFiringRule());
    engine.evaluate([CONFIRMED_TRACK], CONTEXT);
    engine.reset(1);
    const results = engine.evaluate([CONFIRMED_TRACK], CONTEXT);
    expect(results).toHaveLength(1);
  });

  it('returns empty results with never-firing rule', () => {
    const engine = new RuleEngine();
    engine.register(new NeverFiringRule());
    const results = engine.evaluate([CONFIRMED_TRACK], CONTEXT);
    expect(results).toHaveLength(0);
  });

  it('handles empty track list', () => {
    const engine = new RuleEngine();
    engine.register(new AlwaysFiringRule());
    const results = engine.evaluate([], CONTEXT);
    expect(results).toHaveLength(0);
  });

  it('handles multiple rules, multiple tracks', () => {
    const engine = new RuleEngine();
    engine.register(new AlwaysFiringRule());
    engine.register(new NeverFiringRule());
    const track2: TrackedObject = { ...CONFIRMED_TRACK, trackId: 99 };
    const results = engine.evaluate([CONFIRMED_TRACK, track2], CONTEXT);
    expect(results).toHaveLength(2); // one per confirmed track from AlwaysFiringRule
  });

  it('skips Lost and Removed tracks', () => {
    const engine = new RuleEngine();
    engine.register(new AlwaysFiringRule());
    const lost: TrackedObject = { ...CONFIRMED_TRACK, state: 'Lost' };
    const removed: TrackedObject = { ...CONFIRMED_TRACK, trackId: 5, state: 'Removed' };
    const results = engine.evaluate([lost, removed], CONTEXT);
    expect(results).toHaveLength(0);
  });
});
