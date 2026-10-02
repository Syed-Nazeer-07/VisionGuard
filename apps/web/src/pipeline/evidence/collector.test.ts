import { describe, it, expect } from 'vitest';
import { addEvidenceCandidate, getBestEvidence, removeEvidence, clearEvidenceCollector } from './collector';
import type { EvidenceItem } from './types';

const makeItem = (id: string, score: number): EvidenceItem => ({
  id,
  type: 'snapshot',
  base64Data: 'data:image/png;base64,abc',
  score,
  metadata: {
    track_id: 1,
    timestamp: new Date().toISOString(),
    confidence: score / 100,
  }
});

describe('EvidenceCollector', () => {
  it('stores first candidate', () => {
    clearEvidenceCollector();
    addEvidenceCandidate(1, makeItem('a', 50));
    expect(getBestEvidence(1)?.id).toBe('a');
  });

  it('replaces with higher scoring candidate', () => {
    clearEvidenceCollector();
    addEvidenceCandidate(1, makeItem('low', 30));
    addEvidenceCandidate(1, makeItem('high', 80));
    expect(getBestEvidence(1)?.id).toBe('high');
  });

  it('does not replace with lower scoring candidate', () => {
    clearEvidenceCollector();
    addEvidenceCandidate(1, makeItem('high', 80));
    addEvidenceCandidate(1, makeItem('low', 30));
    expect(getBestEvidence(1)?.id).toBe('high');
  });

  it('handles multiple tracks independently', () => {
    clearEvidenceCollector();
    addEvidenceCandidate(1, makeItem('track1', 60));
    addEvidenceCandidate(2, makeItem('track2', 40));
    expect(getBestEvidence(1)?.id).toBe('track1');
    expect(getBestEvidence(2)?.id).toBe('track2');
  });

  it('returns undefined for unknown track', () => {
    clearEvidenceCollector();
    expect(getBestEvidence(999)).toBeUndefined();
  });

  it('removeEvidence deletes track', () => {
    clearEvidenceCollector();
    addEvidenceCandidate(1, makeItem('a', 50));
    removeEvidence(1);
    expect(getBestEvidence(1)).toBeUndefined();
  });

  it('clearEvidenceCollector removes all tracks', () => {
    clearEvidenceCollector();
    addEvidenceCandidate(1, makeItem('a', 50));
    addEvidenceCandidate(2, makeItem('b', 60));
    clearEvidenceCollector();
    expect(getBestEvidence(1)).toBeUndefined();
    expect(getBestEvidence(2)).toBeUndefined();
  });
});
