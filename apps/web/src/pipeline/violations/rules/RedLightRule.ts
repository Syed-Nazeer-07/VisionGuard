import type { TrackedObject } from '../../types';
import type { ViolationRule, RuleContext, ViolationCandidate } from '../types';

export class RedLightRule implements ViolationRule {
  readonly id = 'red_light';
  readonly name = 'Red Light Violation';
  public isEnabled = false;

  constructor(enabled: boolean) {
    this.isEnabled = enabled;
  }

  evaluate(_track: TrackedObject, _context: RuleContext): ViolationCandidate | null {
    // Framework only, no detection yet
    return null;
  }

  reset(_trackId?: number) {}
}
