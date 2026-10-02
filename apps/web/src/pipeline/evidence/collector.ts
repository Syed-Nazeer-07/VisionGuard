import type { EvidenceItem } from './types';

// Map of trackId -> EvidenceItem for rolling candidates
const evidenceMap = new Map<number, EvidenceItem>();

export function addEvidenceCandidate(trackId: number, item: EvidenceItem) {
  const existing = evidenceMap.get(trackId);
  if (!existing || item.score > existing.score) {
    evidenceMap.set(trackId, item);
  }
}

export function getBestEvidence(trackId: number): EvidenceItem | undefined {
  return evidenceMap.get(trackId);
}

export function removeEvidence(trackId: number) {
  evidenceMap.delete(trackId);
}

export function clearEvidenceCollector() {
  evidenceMap.clear();
}
