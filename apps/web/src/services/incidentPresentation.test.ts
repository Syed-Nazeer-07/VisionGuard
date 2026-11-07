import { describe, expect, it } from 'vitest';
import {
  groupIncidentRecords, incidentLabel, manualIncidentEvidence,
} from './incidentPresentation';
import type { AnalysisRecord, ViolationRecord } from './activityLedger';

function event(id: string, observedAt: number): ViolationRecord {
  return { id, trackId: 1, type: 'speed_estimate_review',
    observedAt, status: 'pending_review', evidenceNote: 'Review required.' };
}
function run(id: string, events: ViolationRecord[]): AnalysisRecord {
  return { id, sourceName: id + '.mp4', sourceType: 'uploaded-video',
    createdAt: 1, updatedAt: 100, analyzedFrames: 5, maximumVisibleVehicles: 1,
    vehicles: {}, violations: events };
}
describe('Incident page automatic-first presentation', () => {
  it('puts automatic detections in their own visible list, newest first', () => {
    const grouped = groupIncidentRecords([
      run('one', [event('auto:speed:1', 10), event('manual-1', 80)]),
      run('two', [event('auto:stop:1', 60), event('manual-2', 20)]),
    ]);
    expect(grouped.automatic.map(item => item.event.id))
      .toEqual(['auto:stop:1', 'auto:speed:1']);
    expect(grouped.manual.map(item => item.event.id))
      .toEqual(['manual-1', 'manual-2']);
  });
  it('returns empty automatic and manual sections before any analysis', () => {
    expect(groupIncidentRecords([])).toEqual({ automatic: [], manual: [] });
  });
  it('uses concise incident names rather than raw detector rule types', () => {
    expect(incidentLabel('speed_estimate_review')).toBe('Possible speeding');
    expect(incidentLabel('stationary_vehicle_review')).toBe('Stationary vehicle');
  });
  it('allows short or empty manual notes; no twelve-character minimum', () => {
    expect(manualIncidentEvidence('observed_event', 'Bus', null)).toBe('Bus');
    expect(manualIncidentEvidence('observed_event', '', null).length).toBeGreaterThan(0);
  });
  it('never treats a manually entered speed estimate as a confirmed offence', () => {
    expect(manualIncidentEvidence('speed_estimate_review', 'Fast', 96))
      .toContain('Unverified speed estimate ≈96 km/h.');
    expect(manualIncidentEvidence('speed_estimate_review', '', null)).toContain('Review required');
  });
});
