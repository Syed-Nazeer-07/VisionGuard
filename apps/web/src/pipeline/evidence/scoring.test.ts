import { describe, it, expect } from 'vitest';
import { evaluateEvidence } from './scoring';

describe('evaluateEvidence', () => {
  it('returns higher score with high confidence', () => {
    const high = evaluateEvidence({ detectionConfidence: 0.95, visibleArea: 0.05, hasPlate: false });
    const low  = evaluateEvidence({ detectionConfidence: 0.20, visibleArea: 0.05, hasPlate: false });
    expect(high).toBeGreaterThan(low);
  });

  it('returns higher score when plate is visible', () => {
    const withPlate    = evaluateEvidence({ detectionConfidence: 0.8, visibleArea: 0.1, hasPlate: true });
    const withoutPlate = evaluateEvidence({ detectionConfidence: 0.8, visibleArea: 0.1, hasPlate: false });
    expect(withPlate).toBeGreaterThan(withoutPlate);
  });

  it('returns higher score for larger visible area', () => {
    const large = evaluateEvidence({ detectionConfidence: 0.8, visibleArea: 0.3, hasPlate: false });
    const small = evaluateEvidence({ detectionConfidence: 0.8, visibleArea: 0.01, hasPlate: false });
    expect(large).toBeGreaterThan(small);
  });

  it('area score caps at 30% visible area (max area bonus)', () => {
    const at30  = evaluateEvidence({ detectionConfidence: 0.8, visibleArea: 0.3, hasPlate: false });
    const at100 = evaluateEvidence({ detectionConfidence: 0.8, visibleArea: 1.0, hasPlate: false });
    expect(at30).toBeCloseTo(at100, 5); // capped at same area bonus
  });

  it('blur score increases total score', () => {
    const withBlur    = evaluateEvidence({ detectionConfidence: 0.8, visibleArea: 0.1, hasPlate: false, blurScore: 1.0 });
    const withoutBlur = evaluateEvidence({ detectionConfidence: 0.8, visibleArea: 0.1, hasPlate: false });
    expect(withBlur).toBeGreaterThan(withoutBlur);
  });

  it('score is always non-negative', () => {
    const score = evaluateEvidence({ detectionConfidence: 0, visibleArea: 0, hasPlate: false, blurScore: 0 });
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('maximum possible score does not exceed 100', () => {
    const max = evaluateEvidence({ detectionConfidence: 1.0, visibleArea: 1.0, hasPlate: true, blurScore: 1.0 });
    expect(max).toBeLessThanOrEqual(100);
  });
});
