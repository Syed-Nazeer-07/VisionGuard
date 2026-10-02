import type { TrackedObject } from '../types';
import type { ViolationRule, RuleContext, ViolationCandidate } from './types';

export class RuleEngine {
  private rules: Map<string, ViolationRule> = new Map();
  // Set of strings like: `${trackId}_${ruleId}`
  private notifiedViolations: Set<string> = new Set();

  register(rule: ViolationRule) {
    this.rules.set(rule.id, rule);
  }

  evaluate(tracks: TrackedObject[], context: RuleContext): ViolationCandidate[] {
    const candidates: ViolationCandidate[] = [];

    for (const track of tracks) {
      if (track.state === 'Lost' || track.state === 'Removed') continue;

      for (const rule of this.rules.values()) {
        if (!rule.isEnabled) continue;

        const eventKey = `${track.trackId}_${rule.id}`;
        
        // If we already flagged this track for this specific violation, don't flag again
        if (this.notifiedViolations.has(eventKey)) continue;

        const candidate = rule.evaluate(track, context);
        if (candidate) {
          this.notifiedViolations.add(eventKey);
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  reset(trackId?: number) {
    if (trackId !== undefined) {
      // Remove specific track from notified set
      for (const rule of this.rules.values()) {
        const eventKey = `${trackId}_${rule.id}`;
        this.notifiedViolations.delete(eventKey);
        rule.reset(trackId);
      }
    } else {
      this.notifiedViolations.clear();
      for (const rule of this.rules.values()) {
        rule.reset();
      }
    }
  }
}
