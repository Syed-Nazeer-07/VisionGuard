import type { TrackedObject } from '../../types';
import type { ViolationRule, RuleContext, ViolationCandidate } from '../types';

export class HelmetRule implements ViolationRule {
  readonly id = 'helmet';
  readonly name = 'No Helmet Detection';
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
