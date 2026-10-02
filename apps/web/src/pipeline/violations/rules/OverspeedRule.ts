import type { TrackedObject } from '../../types';
import type { ViolationRule, RuleContext, ViolationCandidate } from '../types';

export class OverspeedRule implements ViolationRule {
  readonly id = 'overspeed';
  readonly name = 'Overspeed Detection';
  public isEnabled = false;

  constructor(enabled: boolean) {
    this.isEnabled = enabled;
  }

  evaluate(track: TrackedObject, context: RuleContext): ViolationCandidate | null {
    if (track.state !== 'Confirmed') return null;
    if (!context.calibration) return null;
    if (!track.isOverspeed || track.speed === undefined) return null;

    // Track is confirmed and has been continuously overspeeding for required duration (3 samples handled in SpeedEstimator)
    return {
      type: 'overspeed',
      severity: 'high',
      timestamp: new Date().toISOString(),
      status: 'pending_review',
      metadata: {
        track_id: track.trackId,
        speed: track.speed,
        speed_limit: context.calibration.speedLimit,
        evidence_metadata: {
          bbox: { x: track.x, y: track.y, w: track.w, h: track.h },
          prob: track.prob,
          className: track.className
        }
      }
    };
  }

  reset(_trackId?: number) {
    // No internal state to clear for overspeed, relies on track properties
  }
}
